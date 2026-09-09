// Per-node execution (ADR 0024 D / execution-model.md). One node-run end to end:
//   gather upstream artifacts → resolve agent+skill+MCP → build prompt →
//   invokeSdk (streaming trace) → write artifact + git auto-commit → terminal
//   status (completed | waiting_approval) or failed.
//
// Working tree (ADR 0081): the node does NOT hard-code `project.path` any more.
// acquireWorkspace gives the first in-flight node of a project the shared tree
// and every concurrent sibling its own `git worktree` + branch, so two parallel
// agents can't overwrite each other's edits or sweep each other's files into an
// auto-commit. The engine merges those branches back when the task drains.
//
// The artifact summary (the assistant's final message) is the run's `output` and
// is also written to ~/.awog/tasks/<id>/artifacts/. The real code changes the
// agent makes via Write/Edit tools live in the PROJECT repo and are captured by
// autoCommitPhase (ADR 0024 D-8 two-tree behaviour).

import { mkdir, writeFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { loadProject } from '../projects/store.js'
import { loadSkillByIdAnyTier } from '../skills/store.js'
import { sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { autoCommitPhase } from '../git/auto-commit.js'
import { sanitizeStderr } from '../git/error-map.js'
import { invokeSdk } from '../sdk/invoke.js'
import { resolveAgentContext } from './agent-context.js'
import {
  traceAgentNode,
  traceFromToolUse,
  traceFromToolResult,
  traceThinkingNode,
  formatDuration,
} from './trace-mapper.js'
import { recordToolCall, taskBudget, taskSpentUsd } from './budget.js'
import { acquireWorkspace, releaseWorkspace } from './worktree.js'
import { loadTask } from './store.js'
import { taskArtifactsDir } from './store.js'
import {
  emitArtifact,
  emitPhaseStatus,
  emitRunDone,
  emitRunOutput,
  emitRunOutputDelta,
  emitRunUsage,
  emitTrace,
  emitWorktree,
} from './emit.js'
import type { IsolatedWorkspace } from './worktree.js'
import type { InvokeToolUse } from '../sdk/invoke.js'
import type {
  SessionSettings,
  Task,
  TaskRunUsage,
  TraceNode,
  Verdict,
  WorkflowNode,
} from '../types/shared.js'

const DEFAULT_MODEL = 'claude-opus-5'
const COMMIT_TEMPLATE = '[{phaseId}] {agentName}: {summary}'

export interface NodeRunContext {
  taskId: string
  version: number
  node: WorkflowNode
  task: Task
  abortController: AbortController
  // Rerun instruction woven into the prompt (and already seeded as a message).
  instruction?: string
}

export type NodeRunOutcome = 'completed' | 'waiting_approval' | 'failed'

// The run's terminal status plus, for gate nodes (ADR 0056), the parsed verdict
// the engine uses to decide loop-back vs escalate. verdict is undefined for
// ordinary nodes and for gate nodes whose output had no parsable verdict block.
export interface NodeRunResult {
  outcome: NodeRunOutcome
  verdict?: Verdict
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  return line.replace(/^#+\s*/, '').trim()
}

// Schema cho verdict của gate node khi chạy bằng structured output (nhánh Claude
// SDK). Ba field: `status` là thứ engine đọc, `summary` một dòng, `report` là bản
// báo cáo markdown vốn là output của node — giữ nó trong schema để bật structured
// output KHÔNG làm mất bản báo cáo mà người dùng vẫn đọc.
export const GATE_VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string', description: 'One line: why it passed, or what failed.' },
    report: { type: 'string', description: 'The full gate report as markdown.' },
  },
  required: ['status', 'summary', 'report'],
  additionalProperties: false,
}

// Đọc verdict + bản báo cáo từ output structured. Trả undefined khi output không
// phải JSON đúng schema — người gọi rơi về đường fenced-block, chứ KHÔNG đoán.
function parseStructuredVerdict(
  output: string,
): { verdict: Verdict; report: string } | undefined {
  const trimmed = output.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const rec = parsed as Record<string, unknown>
    const status = rec.status
    if (status !== 'pass' && status !== 'fail') return undefined
    const report = typeof rec.report === 'string' && rec.report.trim() ? rec.report : ''
    const summary = typeof rec.summary === 'string' ? rec.summary : ''
    return { verdict: status, report: report || summary || trimmed }
  } catch {
    return undefined
  }
}

// Parse the LAST ```verdict``` fenced block in a gate node's output (ADR 0056).
// Output is L1 (model response) → defensive: any miss returns undefined so the
// engine escalates to a human rather than guessing pass/fail.
function parseVerdict(output: string): Verdict | undefined {
  const re = /```verdict\s*([\s\S]*?)```/gi
  let last: string | undefined
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) !== null) last = m[1]
  if (last === undefined) return undefined
  const status = /status\s*:\s*(pass|fail)/i.exec(last)
  if (!status) return undefined
  return status[1]?.toLowerCase() === 'pass' ? 'pass' : 'fail'
}

function sourceLine(task: Task): string {
  const s = task.source
  if (s.type === 'github') return `Source: GitHub issue ${s.repo}#${s.issueNumber} (${s.url})`
  if (s.type === 'jira') return `Source: Jira ${s.key}`
  return 'Source: manual'
}

// The connection (mcpServerId) the task uses to reach its source — unioned into
// every node's MCP set by the engine (ADR 0025). undefined for manual sources.
function sourceConnectionId(task: Task): string | undefined {
  const s = task.source
  if (s.type === 'github' || s.type === 'jira') return s.connectionId
  return undefined
}

async function gatherUpstream(taskId: string, node: WorkflowNode, task: Task): Promise<string> {
  const fresh = (await loadTask(taskId)) ?? task
  const wf = fresh.workflowSnapshot ?? task.workflowSnapshot
  if (!wf) return ''
  const upstreamIds = wf.edges.filter((e) => e.to === node.id).map((e) => e.from)
  const blocks: string[] = []
  for (const uid of upstreamIds) {
    const phase = fresh.phases[uid]
    if (!phase) continue
    // Latest non-superseded completed run is the authoritative upstream output.
    const done = [...phase.runs].reverse().find((r) => r.status === 'completed')
    if (done?.output) blocks.push(`## ${phase.skillName}\n\n${done.output}`)
  }
  return blocks.length > 0 ? `# Upstream artifacts\n\n${blocks.join('\n\n')}\n` : ''
}

async function writeArtifact(taskId: string, name: string, content: string): Promise<number> {
  const safe = sanitizeChild(name)
  const dir = taskArtifactsDir(taskId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const abs = join(dir, safe)
  const tmp = `${abs}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, abs)
  return Buffer.byteLength(content, 'utf8')
}

export async function runNode(ctx: NodeRunContext): Promise<NodeRunResult> {
  const { taskId, version, node, task } = ctx
  const startedMs = Date.now()
  const rootId = `tr-${node.id}-v${version}`
  let workspace: IsolatedWorkspace | null = null

  try {
    const project = await loadProject(task.projectId)
    if (!project?.path) {
      throw new Error(`Task project has no path: ${task.projectId}`)
    }
    // Cây làm việc của node — cây gốc (node đầu tiên) hoặc worktree riêng. Cùng
    // một cwd đi vào cả agent lẫn auto-commit, nên commit của node luôn nằm đúng
    // cây mà node đó đã sửa. Worktree chỉ có nghĩa khi node THẬT SỰ commit kết
    // quả (đó là thứ duy nhất mang thay đổi quay về nhánh chính): tắt auto-commit
    // per-phase, hoặc scope 'artifacts-only' ⇒ dùng chung cây gốc như trước.
    const commitsPerPhase =
      task.autoCommitPerPhase !== false && (task.autoCommitScope ?? 'workspace') === 'workspace'
    workspace = await acquireWorkspace({
      owner: { kind: 'task', id: taskId },
      slug: `${node.id}-v${version}`,
      projectPath: project.path,
      // Tắt auto-commit per-phase ⇒ node không commit ⇒ không có gì mang về nhánh
      // chính, giữ hành vi cũ (dùng chung cây gốc).
      policy: commitsPerPhase ? 'first-claim' : 'shared',
    })
    const cwd = workspace.cwd
    if (workspace.isolated && workspace.branch) {
      await emitWorktree(taskId, 'allocated', workspace.branch, { nodeId: node.id, version })
    }
    const connectionId = sourceConnectionId(task)

    // Resolve agent + skills + MCP. The task's connection (if any) is unioned
    // into the node's MCP set regardless of the agent's per-agent whitelist.
    const agentCtx = await resolveAgentContext(
      {
        id: node.agentId,
        ...(node.agentSource ? { source: node.agentSource } : {}),
        ...(node.agentProjectId ? { projectId: node.agentProjectId } : {}),
      },
      undefined,
      connectionId,
    )
    const agentName = agentCtx.agentName ?? node.agentId

    // The node's skill body is the task template for this step. Project-tier
    // skills resolve only within the task's working project and the agent's own
    // project — never across unrelated projects.
    const skillProjectIds = [
      ...new Set(
        [task.projectId, node.agentProjectId].filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ),
      ),
    ]
    const skill = await loadSkillByIdAnyTier(node.skillId, skillProjectIds)
    const skillBlock = skill
      ? `# Apply the "${skill.name}" skill\n\n${skill.body}\n`
      : `# Skill\n\n(skill "${node.skillId}" not found — proceed with your best judgment)\n`

    const upstream = await gatherUpstream(taskId, node, task)
    const outputs = node.outputs.length > 0 ? node.outputs : ['output.md']

    // Gate verdict instruction (ADR 0056) — injected engine-side so ANY skill
    // works as a gate without being edited. node-runner parses the block back.
    // Nhánh Claude SDK ép ĐÚNG hình dạng bằng `outputFormat` (JSON Schema) thay vì
    // xin model tự gói trong fence: cách cũ có nhánh "verdict không parse được →
    // escalate cho người", tức là một lần model quên fence là một lần gọi người.
    // Provider khác vẫn dùng fence vì Pi không có structured output.
    const gateStructured = !!node.gate && (agentCtx.provider ?? 'anthropic') === 'anthropic'
    const gateBlock = node.gate
      ? gateStructured
        ? [
            '# Quality gate verdict (required)',
            'This node is a quality gate. Answer as a JSON object with exactly these fields:',
            '- `status`: "pass" or "fail" — use "fail" if ANY required criterion is unmet (the upstream work must be redone).',
            '- `summary`: one line — why it passed, or what failed.',
            '- `report`: your full gate report as markdown. This is what the user reads, so do not shorten it.',
            '',
            'The orchestrator reads `status` to decide whether to loop back for fixes.',
          ].join('\n')
        : [
            '# Quality gate verdict (required)',
            'This node is a quality gate. End your response with a fenced verdict block:',
            '',
            '```verdict',
            'status: pass',
            'summary: <one line — why it passed, or what failed>',
            '```',
            '',
            'Use `status: fail` if ANY required criterion is unmet (the upstream work must be redone); otherwise `status: pass`. The orchestrator reads this block to decide whether to loop back for fixes.',
          ].join('\n')
      : ''

    const prompt = [
      `# Task: ${task.title}`,
      task.description,
      sourceLine(task),
      upstream,
      skillBlock,
      ctx.instruction ? `# Rerun instruction\n\n${ctx.instruction}\n` : '',
      `# Deliverable\n\nProduce the artifact(s): ${outputs.join(', ')}. Write your deliverable as your final message. Apply any code changes to the repository using the Write/Edit tools.`,
      gateBlock,
    ]
      .filter((s) => s && s.trim().length > 0)
      .join('\n\n')

    const settings: SessionSettings = {
      provider: agentCtx.provider ?? 'anthropic',
      modelId: agentCtx.model || DEFAULT_MODEL,
      level: 'medium',
      mode: 'execute',
      ...(agentCtx.accountId ? { accountId: agentCtx.accountId } : {}),
    }

    // Emit the root agent trace node (children nest under it).
    await emitTrace(taskId, node.id, version, traceAgentNode(rootId, agentName, node.agentId), null)

    // Trần tiền còn lại cho node này. Model không có trong bảng giá ⇒ taskSpentUsd
    // đóng góp 0, đúng như hàng rào cũ: lúc đó toolCalls/wallclock là lưới an toàn.
    const remainingUsd = Math.max(0, taskBudget().maxCostUsd - (await taskSpentUsd(task)))

    const toolStarts = new Map<string, { use: InvokeToolUse; ms: number }>()
    const thinking = new Map<string, string>()
    let capturedModel = ''

    const result = await invokeSdk(
      {
        prompt,
        settings,
        ...(agentCtx.systemPrompt ? { systemPrompt: agentCtx.systemPrompt } : {}),
        ...(agentCtx.systemPromptAppend ? { systemPromptAppend: agentCtx.systemPromptAppend } : {}),
        ...(agentCtx.allowedTools ? { allowedTools: agentCtx.allowedTools } : {}),
        ...(agentCtx.mcpServers ? { mcpServers: agentCtx.mcpServers } : {}),
        // Enabled api sources (ADR 0060 P3) → mcp__<id>__api_<slug> tools (Pi).
        ...(agentCtx.apiSources ? { apiSources: agentCtx.apiSources } : {}),
        // Per-source Explore scoping (ADR 0060 P4): restrict a source to its own
        // tools/endpoints. trust:'prompt' is not enforced in unattended tasks.
        ...(agentCtx.sourceToolPatterns ? { sourceToolPatterns: agentCtx.sourceToolPatterns } : {}),
        ...(agentCtx.sourceApiEndpoints ? { sourceApiEndpoints: agentCtx.sourceApiEndpoints } : {}),
        cwd,
        // Task subagent menu scope (ADR 0030): the task project + the node
        // agent's project. The task's source connection is unioned into a
        // subagent's MCP set, same as the node's own agent.
        ...(skillProjectIds.length > 0 ? { projectIds: skillProjectIds } : {}),
        ...(connectionId ? { connectionId } : {}),
        // Co-author trailer on model-made commits inside the node — matches the
        // task's per-phase auto-commit trailer (autoCommitPhase below).
        commitCoAuthor: task.commitCoAuthor ?? true,
        // USD CÒN LẠI của task. Trần USD xưa nay chỉ được kiểm giữa các node
        // (checkTaskBudget), nên một node đơn lẻ vẫn có thể tiêu vượt trần rồi mới bị
        // phát hiện. Con số này đi thẳng vào `maxBudgetUsd` của SDK (dừng ngay trong
        // node) và vào cổng tool của Pi. ≤0 ⇒ bỏ qua: đã cán trần thì checkTaskBudget
        // chặn từ trước, và 0 với SDK nghĩa là "hết sạch" chứ không phải "không trần".
        ...(remainingUsd > 0 ? { maxCostUsd: remainingUsd } : {}),
        // Gate node trên nhánh Claude SDK: ép output đúng schema verdict.
        ...(gateStructured ? { outputSchema: GATE_VERDICT_SCHEMA } : {}),
        abortController: ctx.abortController,
      },
      {
        onText: (delta) => {
          emitRunOutputDelta(taskId, node.id, version, delta)
        },
        onToolUse: (use) => {
          if (!toolStarts.has(use.id)) toolStarts.set(use.id, { use, ms: Date.now() })
          void emitTrace(taskId, node.id, version, traceFromToolUse(use), use.parentId ?? rootId)
          // Ngân sách cấp task (ADR 0081 phần B): mọi tool call của mọi node đổ
          // vào cùng một bộ đếm. Chạm trần ⇒ cắt lượt ngay tại đây; engine đọc
          // cờ breach để dừng task có trật tự (phase về pending, task 'paused').
          const breach = recordToolCall(taskId)
          if (breach) {
            log.warn('task budget exceeded — aborting the node turn', {
              taskId,
              nodeId: node.id,
              dimension: breach.dimension,
            })
            ctx.abortController.abort()
          }
        },
        onToolResult: (res) => {
          const start = toolStarts.get(res.id)
          const elapsed = start ? Date.now() - start.ms : 0
          // res.input is the fully-parsed tool input; the use captured in toolStarts at
          // streaming content_block_start time may still hold empty input ({}), so build
          // the result node from res so the trace shows the tool's actual arguments.
          const use = { id: res.id, name: res.name, input: res.input }
          void emitTrace(
            taskId,
            node.id,
            version,
            traceFromToolResult(use, res, elapsed),
            res.parentId ?? rootId,
          )
        },
        onThinking: (id, delta, parentId) => {
          const acc = (thinking.get(id) ?? '') + delta
          thinking.set(id, acc)
          void emitTrace(taskId, node.id, version, traceThinkingNode(id, acc), parentId ?? rootId)
        },
        onAssistantMeta: (model, _usage, parentId) => {
          if (!parentId && model) capturedModel = model
        },
      },
    )

    const elapsed = Date.now() - startedMs
    const rawText = result.text || '(no output produced)'
    // Gate node chạy structured output trả về JSON — bản báo cáo người dùng đọc nằm
    // trong `report`. Bóc ra NGAY ở đây để mọi thứ hạ nguồn (artifact, trace, output
    // file) thấy đúng markdown như trước, không phải một cục JSON.
    const structuredGate = node.gate ? parseStructuredVerdict(rawText) : undefined
    const text = structuredGate?.report ?? rawText

    // Finalise the root agent trace node (running → done, with model + duration).
    const rootDone: TraceNode = {
      id: rootId,
      type: 'agent',
      name: agentName,
      agentName,
      agentId: node.agentId,
      duration: formatDuration(elapsed),
    }
    const finalModel = capturedModel || agentCtx.model
    if (finalModel) rootDone.model = finalModel
    await emitTrace(taskId, node.id, version, rootDone, null)

    // Persist the artifact body + write the artifact file(s).
    await emitRunOutput(taskId, node.id, version, text)

    // Persist token usage for the Activity cost rollup (ADR 0054). Model = the
    // model the run actually resolved to (capturedModel) or the agent default;
    // provider/account come from the run settings. accountId is id-only (no
    // secret). Skip when the turn produced no tokens (e.g. immediate failure).
    const runUsage: TaskRunUsage = {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadTokens: result.usage.cache_read_tokens,
      cacheWriteTokens: result.usage.cache_creation_tokens,
      model: finalModel || settings.modelId,
      provider: settings.provider,
      ...(settings.accountId ? { accountId: settings.accountId } : {}),
    }
    if (
      runUsage.inputTokens +
        runUsage.outputTokens +
        runUsage.cacheReadTokens +
        runUsage.cacheWriteTokens >
      0
    ) {
      await emitRunUsage(taskId, node.id, version, runUsage)
    }

    // Git auto-commit the project repo (captures code the agent wrote). All
    // settings are snapshotted on the task at creation (the renderer owns them):
    //   autoCommitPerPhase === false  → skip the per-node commit entirely
    //   autoCommitScope               → 'workspace' (v1) | 'artifacts-only'
    //   autoCommitMessageTemplate     → message template (token-substituted)
    //   commitCoAuthor                → append the Co-Authored-By trailer
    // Each is undefined for legacy tasks → defaults match the UI defaults.
    let commitSha: string | undefined
    if (task.autoCommitPerPhase === false) {
      log.info('task auto-commit disabled by setting — skipping', { taskId, nodeId: node.id })
    } else {
      try {
        const commit = await autoCommitPhase({
          workspaceRoot: cwd,
          taskId,
          phaseId: node.id,
          agentName,
          skillName: node.skillId,
          taskTitle: task.title,
          summary: firstLine(text) || node.skillId,
          template: task.autoCommitMessageTemplate || COMMIT_TEMPLATE,
          scope: task.autoCommitScope ?? 'workspace',
          // Snapshotted on the task at creation; undefined (legacy) → enabled.
          coAuthor: task.commitCoAuthor ?? true,
        })
        if (commit.committed) commitSha = commit.sha
      } catch (err) {
        log.warn('task auto-commit failed (non-fatal)', {
          taskId,
          nodeId: node.id,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }

    for (let i = 0; i < outputs.length; i += 1) {
      const name = outputs[i] as string
      try {
        // eslint-disable-next-line no-await-in-loop
        const bytes = await writeArtifact(taskId, name, text)
        // eslint-disable-next-line no-await-in-loop
        await emitArtifact(
          taskId,
          node.id,
          version,
          `artifacts/${name}`,
          bytes,
          i === 0 ? commitSha : undefined,
        )
      } catch (err) {
        log.warn('artifact write failed', {
          taskId,
          nodeId: node.id,
          name,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Gate verdict (ADR 0056): parse only for gate nodes; the run itself still
    // COMPLETED regardless of pass/fail. The engine post-processes the verdict
    // (loop-back vs escalate) — node-runner just records it.
    // Verdict: structured output (nhánh Claude SDK) trước, fenced block sau — cả
    // hai cùng trả undefined thì engine escalate cho người, như cũ.
    const verdict = structuredGate?.verdict ?? (node.gate ? parseVerdict(text) : undefined)
    const outcome: NodeRunOutcome = node.approval ? 'waiting_approval' : 'completed'
    await emitRunDone(taskId, node.id, version, outcome, formatDuration(elapsed), undefined, verdict)
    await emitPhaseStatus(taskId, node.id, outcome)
    return verdict !== undefined ? { outcome, verdict } : { outcome }
  } catch (err) {
    const elapsed = Date.now() - startedMs
    const message = err instanceof Error ? err.message : String(err)
    log.warn('node run failed', { taskId, nodeId: node.id, version, err: message })
    // Surface the failure in the trace so the user sees why.
    await emitTrace(
      taskId,
      node.id,
      version,
      { id: `${rootId}-err`, type: 'tool', tool: 'error', result: message, duration: null },
      rootId,
    )
    await emitRunDone(taskId, node.id, version, 'failed', formatDuration(elapsed))
    await emitPhaseStatus(taskId, node.id, 'failed')
    return { outcome: 'failed' }
  } finally {
    // Nhả cây làm việc dù thành công hay hỏng: checkout worktree bị xoá ngay,
    // branch giữ lại cho engine merge về ở điểm task ráo. Node hỏng giữa chừng
    // thường để lại thay đổi chưa commit — release commit WIP hộ; cứu không được
    // thì checkout còn nguyên trên đĩa và phải nói cho người dùng biết nó ở đâu,
    // đừng để chuyện mất-hay-không-mất chìm trong log.
    if (workspace) {
      const released = await releaseWorkspace({ kind: 'task', id: taskId }, workspace)
      if (released.status === 'retained' && released.branch) {
        // Path đi lên UI cũng đi qua sanitizer như stderr: home thành `~`,
        // vẫn cd được mà không rải path tuyệt đối vào event log.
        const detail = sanitizeStderr([released.detail, released.path].filter(Boolean).join(' — '))
        await emitWorktree(taskId, 'conflict', released.branch, {
          nodeId: node.id,
          version,
          ...(detail ? { detail } : {}),
        }).catch((err: unknown) => {
          log.warn('emitting retained-worktree event failed', {
            taskId,
            nodeId: node.id,
            err: err instanceof Error ? err.message : String(err),
          })
        })
      }
    }
  }
}
