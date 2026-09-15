// "Which tools does a chat turn get?" — one answer, two runtimes.
//
// This block used to live inside runtime/run-stream.ts (Pi). When the Codex
// runtime landed (ADR 0087) it needed the SAME answer: the wiki tools appear
// only when the wiki has a page the model may see, memory write tools are opt-in,
// sources are sessions-only, the read-before-write registry is keyed by session
// so a file Read in turn 1 is still writable in turn 5, and so on. Every one of
// those is a rule about AWOG, not about a model provider — so a second copy would
// have been a second place to forget one.
//
// Codex takes the same set and then drops the families its own harness provides
// (see runtime/codex/dynamic-tools.ts); that filter lives there, not here,
// because it is a fact about Codex rather than about a chat turn.

import type { RunNonStreamArgs } from '../sessions/runner.js'
import type { TodoItem } from '../types/shared.js'
import { updateSessionMetadata } from '../sessions/store.js'
import { createRuntimeToolDefinitions, isToolAllowed } from './tools/index.js'
import type { RuntimeToolset } from './tools/index.js'
import { hasWikiContext } from '../wiki/inject.js'
import { hasMemory, hasMemoryBodies } from '../memory/inject.js'
import { listAgents } from '../agents/store.js'
import { listWorkflows } from '../workflows/store.js'
import { listHosts } from '../ssh/store.js'
import { createSubagentTools, type SubagentSink, type SubagentToolset } from './tools/task-tool.js'
import { createRunWorkflowTool, RUN_WORKFLOW_TOOL_NAME } from './tools/run-workflow-tool.js'
import { createInfraTools } from './tools/infra-tools.js'
import { createSshTools } from './tools/ssh-tools.js'
import type { BeforeToolCall } from './permission.js'
import { log } from '../util/logger.js'

export interface ChatToolsetOptions {
  inPlanMode: boolean
  // The turn's permission gate. Subagents reuse the PARENT's gate so a depth-1
  // subagent's writes still prompt the user in ask mode.
  beforeToolCall: BeforeToolCall
  // Per-run event sink for a subagent. Runtime-specific: a subagent always runs
  // its own Pi loop, but where its nested steps are rendered is the caller's.
  makeChildSink: (parentToolCallId: string) => SubagentSink
}

export interface ChatToolset extends RuntimeToolset {
  // Held so the turn can stop every background subagent it spawned (ADR 0083):
  // a subagent may not outlive the turn that started it.
  subagents?: SubagentToolset
}

export async function buildChatToolset(
  args: RunNonStreamArgs,
  opts: ChatToolsetOptions,
): Promise<ChatToolset> {
  const { inPlanMode } = opts
  // Captured in a const so TS narrows it inside the todoSink closure below.
  const todoSessionId = args.sessionId
  // Wiki (ADR 0073): offer wiki_search/wiki_read only when the wiki actually has a
  // page the LLM may see AND Settings has not turned the wiki off. No wiki → no
  // tool schema → no token cost.
  const ctxCfg = args.contextConfig
  const wikiAvailable = ctxCfg?.wikiEnabled !== false && (await hasWikiContext(args.projectId))
  // Memory (ADR 0073 part B): the WRITE tools are opt-in (Settings, default off);
  // memory_read appears only when some fact carries detail past its one-liner.
  const memoryOn = ctxCfg?.memoryEnabled !== false && (await hasMemory(args.projectId))
  const memoryAutoWrite = ctxCfg?.memoryAutoWrite === true
  const memoryBodies = memoryOn && (await hasMemoryBodies(args.projectId))
  const built = await createRuntimeToolDefinitions(
    args.cwd ?? process.cwd(),
    args.mcpServers,
    // Enabled api sources → one mcp__<id>__api_<slug> tool each (ADR 0060 P3).
    args.apiSources,
    {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
      // Read-before-write registry keyed by session (read-registry.ts): a file
      // Read in turn 1 stays writable in turn 5, even though the toolset itself
      // is rebuilt every turn.
      ...(args.sessionId ? { readRegistryKey: `session:${args.sessionId}` } : {}),
      // Plan mode: expose ExitPlanMode so the model can present a plan for
      // approval (permission.ts still blocks all writes/exec meanwhile).
      ...(inPlanMode ? { includePlanTool: true } : {}),
      // Source setup tools (ADR 0060 P6): sessions only. Lets the model add/test/
      // authenticate Sources conversationally. Never wired into tasks (invoke.ts).
      includeSourceTools: true,
      // Wiki lookup (ADR 0073) — the user's own docs, reachable on EVERY runtime.
      ...(wikiAvailable
        ? {
            includeWikiTools: {
              ...(args.projectId ? { projectId: args.projectId } : {}),
              // Agent wiki editing (Settings → Wiki, default off). Still gated per
              // call by permission.ts.
              canWrite: ctxCfg?.wikiAutoWrite === true,
            },
          }
        : {}),
      // Memory write/read tools (ADR 0073 D-11). Omitted entirely when the user has
      // not opted into agent writes and no fact has extra detail to read.
      ...(memoryAutoWrite || memoryBodies
        ? {
            includeMemoryTools: {
              ...(args.projectId ? { projectId: args.projectId } : {}),
              autoWrite: memoryAutoWrite,
              hasBodies: memoryBodies,
            },
          }
        : {}),
      // Per-source Explore scoping (ADR 0060 P4): restrict a source to its own
      // allowedMcpPatterns tools + gate its non-GET api calls. No-op when unset.
      ...(args.sourceToolPatterns ? { sourceToolPatterns: args.sourceToolPatterns } : {}),
      ...(args.sourceApiEndpoints ? { sourceApiEndpoints: args.sourceApiEndpoints } : {}),
      // Ngữ cảnh hạ tầng đã ghim → env của `Bash` (ADR 0088 §6). Không có dòng này
      // thì `aws …` trong shell rơi về profile `default` trong khi thẻ duyệt nói
      // phiên đã ghim tài khoản nào đó — tức chip nói một đằng, lệnh chạy một nẻo.
      ...(args.settings.infra ? { bashInfra: args.settings.infra } : {}),
      // Background exec (ADR 0066): sessions only. Bash gains run_in_background +
      // a BashOutput tool; a background command outlives the turn and the session
      // is woken when it exits. Not in plan mode (Bash is read-only-blocked there).
      ...(!inPlanMode && args.sessionId
        ? { backgroundExec: { sessionId: args.sessionId } }
        : {}),
      // "This turn belongs to a chat session" — plan mode included. Carries the
      // read-only terminal tool, which background exec's gate would wrongly drop.
      ...(args.sessionId ? { chatSession: { sessionId: args.sessionId } } : {}),
      // Editable checklist: persist every TodoWrite as the session's current
      // checklist so a user edit in the UI has something authoritative to write to
      // and the next turn re-injects it (sessions/todo-context.ts). Sessions only.
      // Allowed in plan mode too — planning is exactly when the checklist forms.
      ...(todoSessionId
        ? { todoSink: (todos: TodoItem[]) => updateSessionMetadata(todoSessionId, { todos }) }
        : {}),
    },
    args.abortController?.signal,
    // Wire the interactive AskUserQuestion handler (chat only). The tool parks
    // on it mid-turn and the answer comes back via the answerQuestion RPC.
    args.askUserQuestion,
    // Hook anchor (ADR 0032): fire tool.* / artifact.* around each tool call.
    {
      surface: 'session',
      workspace: args.cwd ?? process.cwd(),
      ...(args.projectId ? { projectId: args.projectId } : {}),
    },
    // Session MCP pool key: reuse one child per attached server across this
    // session's turns so stateful servers (Playwright) keep their browser open
    // between tool calls instead of reopening/closing each call.
    args.sessionId,
  )
  const tools = built.tools

  // Task subagent tool (ADR 0030). Added at the TOP LEVEL only — never to a
  // subagent's toolset (so depth = 1). Skipped in plan mode (read-only) and when
  // allowedTools/disabledTools exclude 'Task'. Added otherwise even with zero
  // agents, so a stray Task call gets a graceful result instead of the
  // "Tool Task not found" error. Pushed BEFORE buildContext so it lands in
  // context.tools.
  // Held so the turn can stop every background subagent it spawned (ADR 0083):
  // a subagent may not outlive the turn that started it.
  let subagents: SubagentToolset | undefined
  const taskAllowed =
    !inPlanMode &&
    isToolAllowed('Task', {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    })
  if (taskAllowed) {
    const projectIds = args.projectId ? [args.projectId] : []
    let agents: Awaited<ReturnType<typeof listAgents>>['agents'] = []
    try {
      agents = (await listAgents(projectIds)).agents
    } catch (err) {
      log.warn('failed to list agents for Task tool', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    subagents = createSubagentTools({
      agents,
      cwd: args.cwd ?? process.cwd(),
      parentSettings: args.settings,
      // Inherited by a general-purpose subagent when the model omits
      // subagent_type (craft-style): parent base prompt + tool whitelist.
      ...(args.systemPrompt ? { parentSystemPrompt: args.systemPrompt } : {}),
      ...(args.allowedTools ? { parentAllowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
      // Subagent inherits this turn's resolved MCP servers (session whitelist +
      // secrets already applied) so it can reach the same servers the session can.
      ...(args.mcpServers ? { parentMcpServers: args.mcpServers } : {}),
      // Same for the session's api sources (ADR 0060 P3): the subagent reaches
      // every api tool the session can.
      ...(args.apiSources ? { parentApiSources: args.apiSources } : {}),
      // Chat subagents reuse the parent permission gate: in 'ask' mode their
      // writes/exec still prompt the user (depth-1 subagent, same session).
      beforeToolCall: opts.beforeToolCall,
      // Inherit the session's co-author setting for subagent-made commits.
      ...(args.commitCoAuthor === false ? { commitCoAuthor: false } : {}),
      // ADR 0083: chat (and only chat) may run a subagent in the background —
      // the turn stays open while the model does other work and collects it with
      // TaskOutput. Scoped to this turn: disposeAll() in the finally below stops
      // anything still running, so a session never carries a live subagent into
      // its next turn (one turn at a time stays true).
      allowBackground: true,
      // ADR 0083 §c: a chat subagent may ask for `isolation: "worktree"` — its own
      // checkout + branch, so parallel subagents can't overwrite each other. It
      // ISOLATES ONLY: nothing is merged back into the user's tree from a chat
      // turn (subagents/worktree-lease.ts explains why). Needs the session id —
      // that is the owner key the boot sweeper scans.
      allowIsolation: true,
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      // `subagent_type: "fork"` replays a capped tail of this transcript into the
      // subagent (task-tool.ts trims it).
      parentHistory: args.history,
      makeChildSink: opts.makeChildSink,
    })
    tools.push(...subagents.tools)
  }

  // RunWorkflow tool (ADR 0055): lets the model spawn a background Task from this
  // session. TOP LEVEL only (depth = 1 — never in a subagent toolset). Requires a
  // project (a Task is project-scoped) + a sessionId (the origin link); skipped in
  // plan mode and when allowedTools/disabledTools exclude it. Mutating per
  // permission.ts → prompts in ask/accept-edits, runs only in execute.
  const runWorkflowAllowed =
    !inPlanMode &&
    !!args.projectId &&
    !!args.sessionId &&
    isToolAllowed(RUN_WORKFLOW_TOOL_NAME, {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    })
  if (runWorkflowAllowed && args.projectId) {
    let workflows: Awaited<ReturnType<typeof listWorkflows>> = []
    try {
      workflows = await listWorkflows([args.projectId])
    } catch (err) {
      log.warn('failed to list workflows for RunWorkflow tool', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    tools.push(
      createRunWorkflowTool({
        sessionId: args.sessionId,
        projectId: args.projectId,
        workflows,
      }),
    )
  }

  // SSH tools (ADR 0064): unified MCP-style model — available in ANY session that has
  // SSH hosts configured (host is a per-call param via ssh_list_hosts). ssh_exec /
  // ssh_write_file (mutating) + ssh_read_file / ssh_list_dir (read) are gated via
  // permission.ts + settings.sshApprovalMode; 'auto' runs without a prompt, plan mode
  // blocks the mutating ones. The co-pilot dock also gets ssh_terminal_run bound to
  // the watched shell (args.sshTerminalConnId). TOP LEVEL only. Honour
  // allowedTools/disabledTools like any tool.
  if ((await listHosts()).some((h) => h.agentEnabled !== false)) {
    const filter = {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    }
    const sshTools = createSshTools({
      sessionId: args.sessionId,
      ...(args.sshTerminalConnId ? { terminalConnId: args.sshTerminalConnId } : {}),
    }).filter((t) => isToolAllowed(t.name, filter))
    tools.push(...sshTools)
  }

  // Tool hạ tầng (ADR 0088 §4): CHỈ có mặt khi phiên đã ghim ngữ cảnh — không ghim
  // thì "ngữ cảnh được chỉ định" không tồn tại, và một tool chạy lệnh AWS mà không
  // biết mình ở tài khoản nào là đúng thứ cả thiết kế này sinh ra để chặn.
  // Mọi lời gọi đi qua `runInfra()` (chèn cờ ngữ cảnh, từ chối cờ ghi đè, ghi nhật
  // ký) và qua ma trận quyền ở `permission.ts`.
  if (args.settings.infra && Object.keys(args.settings.infra).length > 0) {
    const filter = {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
    }
    const infraTools = createInfraTools({
      context: args.settings.infra,
      // Phiên chat có `makeBeforeToolCall` park lượt và hỏi người dùng ⇒ lớp `ask`
      // đến được tool nghĩa là đã có người duyệt. Task node KHÔNG có cổng đó, nên
      // nó không được truyền cờ này (audit #1 F4).
      gated: true,
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    }).filter((t) => isToolAllowed(t.name, filter))
    tools.push(...infraTools)
  }

  return { ...built, tools, ...(subagents ? { subagents } : {}) }
}
