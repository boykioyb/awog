// Per-node execution (ADR 0024 D / execution-model.md). One node-run end to end:
//   gather upstream artifacts → resolve agent+skill+MCP → build prompt →
//   invokeSdk (streaming trace) → write artifact + git auto-commit → terminal
//   status (completed | waiting_approval) or failed.
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
import { invokeSdk } from '../sdk/invoke.js'
import { resolveAgentContext } from './agent-context.js'
import {
  traceAgentNode,
  traceFromToolUse,
  traceFromToolResult,
  traceThinkingNode,
  formatDuration,
} from './trace-mapper.js'
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
} from './emit.js'
import type { InvokeToolUse } from '../sdk/invoke.js'
import type {
  SessionSettings,
  Task,
  TaskRunUsage,
  TraceNode,
  Verdict,
  WorkflowNode,
} from '../types/shared.js'

const DEFAULT_MODEL = 'claude-opus-4-8'
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

  try {
    const project = await loadProject(task.projectId)
    if (!project?.path) {
      throw new Error(`Task project has no path: ${task.projectId}`)
    }
    const cwd = project.path
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
    const gateBlock = node.gate
      ? [
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
        abortController: ctx.abortController,
      },
      {
        onText: (delta) => {
          emitRunOutputDelta(taskId, node.id, version, delta)
        },
        onToolUse: (use) => {
          if (!toolStarts.has(use.id)) toolStarts.set(use.id, { use, ms: Date.now() })
          void emitTrace(taskId, node.id, version, traceFromToolUse(use), use.parentId ?? rootId)
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
    const text = result.text || '(no output produced)'

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
    const verdict = node.gate ? parseVerdict(text) : undefined
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
  }
}
