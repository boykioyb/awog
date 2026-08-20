// Pi-SDK streaming chat runner (ADR 0029). sessions/runner.ts's runStream
// delegates here for every provider (OAuth + apikey + custom endpoint):
//   - streams assistant text via cb.onChunk
//   - emits tool steps (running → done/error) via cb.onStep
//   - honours the 4 permission modes (ask/accept-edits/plan/execute)
//   - resume = rebuild Context from args.history (no opaque session id)
//   - `/compact` = one-shot summarize over the rebuilt history (a graceful
//     fallback ships here).

import {
  runAgentLoop,
  generateSummary,
  DEFAULT_COMPACTION_SETTINGS,
  type AgentEvent,
  type AgentMessage,
} from '@earendil-works/pi-agent-core'
import type { Api, AssistantMessage, Message, Model, Models } from '@earendil-works/pi-ai'
// pi 0.84: the agent loop no longer owns a default stream function — the caller
// passes it. `streamSimple` (compat) is the same dispatcher the loop used
// internally before, so behaviour is unchanged.
import { completeSimple, streamSimple } from '@earendil-works/pi-ai/compat'
import { resolveCredential } from '../credentials/credential-resolver.js'
import { recordCodexUsageFromHeaders } from '../providers/openai/usage.js'
import { confirmOverageOrStop } from './overage-guard.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type { RunNonStreamArgs, RunStreamResult, StreamCallbacks } from '../sessions/runner.js'
import { updateSessionMetadata } from '../sessions/store.js'
import type { TodoItem } from '../types/shared.js'
import { listAgents } from '../agents/store.js'
import { resolveModel } from './model-resolver.js'
import { buildContext, historyToAgentMessages } from './context-builder.js'
import {
  buildCurrentStateBlock,
  buildEnvironmentBlock,
  collectWorkspaceSnapshot,
} from '../context/environment.js'
import { computeCutPoint } from './compaction.js'
import { createRuntimeToolDefinitions, isToolAllowed } from './tools/index.js'
import { buildMcpUnavailableNote } from './tools/mcp-tools.js'
import {
  BACKGROUND_EXEC_PROMPT,
  COMMUNICATION_PROMPT,
  ENGINEERING_PROMPT,
  EVIDENCE_PROMPT,
  fileRefPrompt,
  TODO_USAGE_PROMPT,
  TOOL_DISCIPLINE_PROMPT,
  VERIFY_PROMPT,
} from './prompts.js'
import { makeConfabulationFollowUp } from './confabulation-guard.js'
import { createTaskTool } from './tools/task-tool.js'
import { createRunWorkflowTool, RUN_WORKFLOW_TOOL_NAME } from './tools/run-workflow-tool.js'
import { createSshTools } from './tools/ssh-tools.js'
import { listHosts } from '../ssh/store.js'
import { listWorkflows } from '../workflows/store.js'
import { makeBeforeToolCall, withTurnBudget } from './permission.js'
import { toReasoning } from './thinking.js'
import { createEventAdapter } from './event-adapter.js'
import { buildRulesPrompt, extractTurnPaths } from '../rules/inject.js'
import { hasWikiContext } from '../wiki/inject.js'
import { hasMemory, hasMemoryBodies } from '../memory/inject.js'
import { buildStylePrompt } from '../style/styles.js'
import { CO_AUTHOR_INSTRUCTION } from '../git/co-author.js'

// Plan-mode system-prompt nudge. The model is read-only here (permission.ts
// blocks Write/Edit/Bash); it should investigate, then present a concrete plan
// via the ExitPlanMode tool — never attempt edits.
const PLAN_MODE_PROMPT = `<plan-mode>
You are in PLAN MODE. You may ONLY use read-only tools (Read, Grep, Glob) to investigate the task — every write or shell command is blocked.

When you have understood the task and formed a concrete approach, call the \`ExitPlanMode\` tool with your plan as markdown: a short rationale followed by a numbered or bulleted list of the steps you intend to take. Do not write code or describe a final plan in plain text — present it through \`ExitPlanMode\` so the user can approve it. Once you call \`ExitPlanMode\`, stop and wait for approval.
</plan-mode>`

// Map a thrown error to the same RpcError codes the sdk branch uses so the UI
// surfaces identical messages regardless of runtime. Token never logged.
function mapErrorToRpc(err: unknown): RpcError {
  if (err instanceof RpcError) return err
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (name === 'AbortError' || lower.includes('aborted') || lower.includes('cancelled')) {
    return new RpcError(-32023, 'CANCELED')
  }
  // `401` must match as a WHOLE token — a bare substring test also fires on an
  // unrelated 4010/1401 in a request id, byte count or exit line, mislabelling
  // a random failure as an expired login.
  if (lower.includes('unauthor') || /\b401\b/.test(lower) || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RpcError(
      -32022,
      'Rate limited by the provider. Quota exhausted — try a cheaper model or wait a few minutes.',
    )
  }
  return new RpcError(-32021, `chat failed: ${message}`)
}

export async function runStreamPi(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  const { account } = await resolveCredential(args.settings.provider, args.settings.accountId)

  // resolveModel validates the model id per provider (built-in catalog lookup)
  // and trusts user-supplied ids for custom endpoints (account.baseURL).
  const { model, getApiKey } = resolveModel(args.settings, account)

  // `/compact` short-circuit (slashCommand). Reimplement via pi-agent-core's
  // generateSummary over the rebuilt history (ADR 0029 amends ADR 0023). The
  // caller persists the returned text; an empty/failed summary returns a clear
  // notice rather than blocking the turn.
  if (args.slashCommand === 'compact') {
    return runCompact(args, model, getApiKey)
  }

  // Resolve the initial token for AgentLoopConfig.apiKey. getApiKey refreshes it
  // per turn; this is just the first value. Never logged.
  const initialKey = await getApiKey(args.settings.provider)

  // Built-in tools + bridged MCP tools (mcp__<serverId>__<tool>) from the
  // already-resolved args.mcpServers (whitelist intersected + secrets expanded
  // upstream). allowedTools/disabledTools filter both kinds uniformly. A failing
  // MCP server is skipped (warn) so it never blocks the turn.
  const inPlanMode = args.settings.mode === 'plan'
  // Captured in a const so TS narrows it inside the todoSink closure below.
  const todoSessionId = args.sessionId
  // Wiki (ADR 0073): offer wiki_search/wiki_read only when the wiki actually has a
  // page the LLM may see AND Settings has not turned the wiki off. No wiki → no
  // tool schema → no token cost.
  const ctxCfg = args.contextConfig
  const wikiScope = args.wikiSpaces
  const wikiAvailable =
    ctxCfg?.wikiEnabled !== false && (await hasWikiContext(args.projectId, wikiScope))
  // Memory (ADR 0073 part B): the WRITE tools are opt-in (Settings, default off);
  // memory_read appears only when some fact carries detail past its one-liner.
  const memoryOn = ctxCfg?.memoryEnabled !== false && (await hasMemory(args.projectId))
  const memoryAutoWrite = ctxCfg?.memoryAutoWrite === true
  const memoryBodies = memoryOn && (await hasMemoryBodies(args.projectId))
  const { tools, failures: mcpFailures, mcpCatalog } = await createRuntimeToolDefinitions(
    args.cwd ?? process.cwd(),
    args.mcpServers,
    // Enabled api sources → one mcp__<id>__api_<slug> tool each (ADR 0060 P3).
    args.apiSources,
    {
      ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
      // Plan mode: expose ExitPlanMode so the model can present a plan for
      // approval (permission.ts still blocks all writes/exec meanwhile).
      ...(inPlanMode ? { includePlanTool: true } : {}),
      // Source setup tools (ADR 0060 P6): sessions only. Lets the model add/test/
      // authenticate Sources conversationally. Never wired into tasks (invoke.ts).
      includeSourceTools: true,
      // Wiki lookup (ADR 0073) — the user's own docs, reachable on BOTH runtimes.
      ...(wikiAvailable
        ? {
            includeWikiTools: {
              ...(args.projectId ? { projectId: args.projectId } : {}),
              ...(wikiScope ? { spaces: wikiScope } : {}),
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
      // Background exec (ADR 0066): sessions only. Bash gains run_in_background +
      // a BashOutput tool; a background command outlives the turn and the session
      // is woken when it exits. Not in plan mode (Bash is read-only-blocked there).
      ...(!inPlanMode && args.sessionId
        ? { backgroundExec: { sessionId: args.sessionId } }
        : {}),
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

  // Append system-prompt nudges after the agent's own prompt (+ any existing
  // append like the MCP nudge): the TodoWrite usage nudge when the tool is
  // available, then the plan-mode nudge in plan mode. buildContext joins the
  // result onto the system prompt.
  const todoAllowed = isToolAllowed('TodoWrite', {
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disabledTools ? { disabledTools: args.disabledTools } : {}),
  })
  // Workspace rules (ADR 0033): enabled global + session-project rules, appended
  // to (not replacing) the agent's own prompt.
  const rulesPrompt = await buildRulesPrompt(args.projectId, extractTurnPaths(args.pendingText))
  // One git read per turn feeding BOTH orientation blocks (ADR 0071): the stable
  // half goes in the system prompt, the volatile half on the turn prompt.
  // Best-effort — a non-repo or a git failure yields undefined, never an error.
  const workspaceSnapshot = await collectWorkspaceSnapshot(args.cwd)
  // Response style (ADR 0046, sessions only): user-picked tone/format directive,
  // appended after rules (rules outrank style semantically) and before VERIFY.
  const stylePrompt = buildStylePrompt(
    args.settings.responseStyle,
    args.settings.responseStyleNoMarkdown,
  )
  // Tell the model — in-band — about any attached MCP server that failed to
  // load, so it doesn't call its absent tools or fabricate their results.
  const mcpUnavailable = buildMcpUnavailableNote(mcpFailures)
  // Orientation (ADR 0071): OS / shell / cwd / repo root. Leads the append so the
  // model can interpret every path and shell instruction that follows it. Only
  // the STABLE half goes here — the volatile git snapshot rides the turn prompt
  // below, so this block stays byte-identical across a session and the provider's
  // prompt cache keeps hitting.
  const environmentBlock = buildEnvironmentBlock(args.cwd, workspaceSnapshot)
  const appendParts = [
    environmentBlock,
    args.systemPromptAppend,
    rulesPrompt,
    // Senior-engineer scaffolding (ADR 0071). Under OAuth, pi-ai prepends only the
    // one-sentence Claude Code identity — no behavioural body — so unlike the
    // claude_code preset path these have to come from us. Placed after the
    // project's own instructions/rules (which outrank them) and before the
    // response style, so a user-picked voice still lands last on tone.
    ENGINEERING_PROMPT,
    EVIDENCE_PROMPT,
    COMMUNICATION_PROMPT,
    stylePrompt,
    // Act through tools, don't narrate (see prompts.ts). Off in plan mode —
    // PLAN_MODE_PROMPT governs that read-only path.
    inPlanMode ? undefined : TOOL_DISCIPLINE_PROMPT,
    // Background exec guidance (ADR 0066): only when the primitive is actually
    // wired (sessions, not plan mode) — mirrors the backgroundExec filter above.
    !inPlanMode && args.sessionId ? BACKGROUND_EXEC_PROMPT : undefined,
    // Always-on: verify, never fabricate (see prompts.ts). Unconditional.
    VERIFY_PROMPT,
    // Co-author trailer convention (Git `commitCoAuthor`). Pi has no built-in
    // commit attribution (unlike the claude_code preset), so append the AWOG
    // instruction only when the setting is on (default; off omits it entirely).
    args.commitCoAuthor === false ? undefined : CO_AUTHOR_INSTRUCTION,
    // Ask for full absolute file paths so chat file references become clickable
    // preview links (sessions only; undefined when no workspace root).
    fileRefPrompt(args.cwd),
    mcpUnavailable,
    // MCP catalog (ADR 0051): present only when the MCP toolset is in proxy mode.
    mcpCatalog,
    todoAllowed ? TODO_USAGE_PROMPT : undefined,
    // Current checklist (ADR 0069) — rebuilt per turn by send-message. Pi rebuilds
    // the whole system prompt every turn, so the append carries it fine here (the
    // Claude SDK path has to put it on the turn prompt instead — see runner.ts).
    args.sessionChecklist,
    inPlanMode ? PLAN_MODE_PROMPT : undefined,
  ].filter((p): p is string => typeof p === 'string' && p.length > 0)
  const systemPromptAppend = appendParts.length > 0 ? appendParts.join('\n\n') : undefined

  const beforeToolCall = withTurnBudget(
    makeBeforeToolCall(
      args.canUseTool,
      args.settings.mode,
      args.sessionId,
      args.autoApprove ?? false,
      // Per-source P4 gate: trust:'prompt' routes through the ask-gate;
      // allowedMcpPatterns hard-blocks a source tool outside its own scope.
      {
        ...(args.promptSourceIds ? { promptSourceIds: args.promptSourceIds } : {}),
        ...(args.sourceToolPatterns ? { toolPatterns: args.sourceToolPatterns } : {}),
      },
      // Per-session SSH approval mode (ADR 0064): gates the SSH tools independently of
      // `mode`/`autoApprove`. Default 'prompt'. The gate keys the remembered allowance
      // by the per-call `host` arg (unified model).
      args.settings.sshApprovalMode ?? 'prompt',
    ),
    args.budget,
    Date.now(),
  )

  // Task subagent tool (ADR 0030). Added at the TOP LEVEL only — never to a
  // subagent's toolset (so depth = 1). Skipped in plan mode (read-only) and when
  // allowedTools/disabledTools exclude 'Task'. Added otherwise even with zero
  // agents, so a stray Task call gets a graceful result instead of the
  // "Tool Task not found" error. Pushed BEFORE buildContext so it lands in
  // context.tools.
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
    tools.push(
      createTaskTool({
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
        beforeToolCall,
        // Inherit the session's co-author setting for subagent-made commits.
        ...(args.commitCoAuthor === false ? { commitCoAuthor: false } : {}),
        makeChildSink: (parentToolCallId) => {
          const child = createEventAdapter(cb, { parentId: parentToolCallId })
          return { emit: child.handle, text: () => child.result().text }
        },
      }),
    )
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

  // Volatile orientation (date + branch + dirty tree + recent commits) rides the
  // TURN prompt, not the system prompt: it changes as the user works, and pi-ai
  // marks the whole system prompt as ONE cache block, so putting it there would
  // invalidate the session's entire cached prefix on nearly every turn. Only this
  // turn carries it — history is replayed from JSONL (clean user text), so the
  // block never accumulates across turns and never reaches the transcript.
  const turnText = `${buildCurrentStateBlock(workspaceSnapshot)}\n\n${args.pendingText}`

  const { context, prompt } = buildContext(
    args.history,
    turnText,
    args.systemPrompt,
    systemPromptAppend,
    tools,
    args.pendingAttachments,
    // Active compaction checkpoint (ADR 0047): feed the model summary + recent
    // turns instead of the full transcript.
    args.compaction,
    // Re-feed prior-turn images (Settings → Sessions). Default true; false drops
    // prior images from the rebuilt history (current turn's images still sent).
    args.refeedImages ?? true,
  )

  // Context-window breakdown for the UI usage panel: measure each segment's size
  // at build time so the panel can itemise the window the way Claude Code's
  // `/context` does (System prompt / Instructions / System tools / MCP tools /
  // Custom agents / Skills / Memory files / Messages) instead of dumping
  // everything the UI can't see into one opaque "Other" bucket. Char counts (÷4
  // in the UI = the same rough heuristic it already uses); JSON size over-
  // approximates structure but, crucially, captures the tool_use / tool_result /
  // thinking content the visible-text estimate omits.
  //
  // Split the toolset by name prefix: bridged MCP tools are `mcp__<id>__*`,
  // everything else is a built-in/system tool.
  const mcpToolsArr = tools.filter((t) => t.name.startsWith('mcp__'))
  const systemToolsArr = tools.filter((t) => !t.name.startsWith('mcp__'))
  // The itemised bulk-load sections (memory files / custom agents / skills) were
  // folded into args.systemPromptAppend upstream (send-message) and then joined
  // with the runtime's own append nudges (rules / style / VERIFY / plan / MCP)
  // into `systemPromptAppend` above. `instructions` is the REMAINDER of the joined
  // append after subtracting both the base prompt and those itemised sections:
  //   context.systemPrompt = systemPrompt + "\n\n" + systemPromptAppend
  const items = args.contextItems
  const systemPromptLen = (args.systemPrompt ?? '').length
  const memoryFilesLen = items?.memoryFilesChars ?? 0
  const customAgentsLen = items?.customAgentsChars ?? 0
  const skillsLen = items?.skillsChars ?? 0
  const wikiLen = items?.wikiChars ?? 0
  const memoryLen = items?.memoryChars ?? 0
  const instructionsLen = Math.max(
    0,
    (context.systemPrompt ?? '').length -
      systemPromptLen -
      memoryFilesLen -
      customAgentsLen -
      skillsLen -
      wikiLen -
      memoryLen,
  )
  const contextChars = {
    systemPrompt: systemPromptLen,
    instructions: instructionsLen,
    systemTools: JSON.stringify(systemToolsArr).length,
    mcpTools: mcpToolsArr.length > 0 ? JSON.stringify(mcpToolsArr).length : 0,
    customAgents: customAgentsLen,
    skills: skillsLen,
    wiki: wikiLen,
    memory: memoryLen,
    memoryFiles: memoryFilesLen,
    history: JSON.stringify(context.messages).length + JSON.stringify(prompt).length,
    ...(items?.memoryFilesList.length ? { memoryFilesList: items.memoryFilesList } : {}),
    ...(items?.customAgentsList.length ? { customAgentsList: items.customAgentsList } : {}),
    ...(items?.skillsList.length ? { skillsList: items.skillsList } : {}),
    ...(items?.wikiList.length ? { wikiList: items.wikiList } : {}),
    ...(items?.memoryList.length ? { memoryList: items.memoryList } : {}),
  }

  const reasoning = toReasoning(args.settings.level, model)
  const adapter = createEventAdapter(cb)

  // Cumulative count of tool calls started this turn — feeds the confabulation
  // guard (a turn that called no tool but claims work gets one corrective nudge).
  let turnToolCalls = 0

  // Confabulation guard (confabulation-guard.ts): when the model would end its
  // turn having made no tool call yet its reply claims tool-class work
  // (delegated a subagent, ran a command, committed…), inject one reminder so it
  // does the work for real in the same turn. Off in plan mode (read-only;
  // ExitPlanMode governs that path) and when no tools are available.
  const confabulationFollowUp =
    !inPlanMode && tools.length > 0
      ? makeConfabulationFollowUp({
          getReplyText: () => adapter.result().text,
          getTurnToolCalls: () => turnToolCalls,
          toolsAvailable: true,
          sessionId: args.sessionId,
        })
      : undefined

  // Mid-turn steering (Session steering). Pi polls this at each turn boundary
  // (after the current assistant turn's tool calls finish, before the next LLM
  // call). We drain the per-turn steer queue, surface each item as a
  // `kind:'steer'` step so the user sees what they injected in the timeline (it
  // gets stamped + persisted by the caller's onStep), and return them as user
  // messages for the loop to inject. Contract: must not throw — a steer failure
  // should never break the turn, so we swallow and return [].
  const getSteeringMessages = args.getSteeringMessages
    ? async (): Promise<AgentMessage[]> => {
        try {
          const items = await args.getSteeringMessages!()
          if (items.length === 0) return []
          for (const it of items) {
            cb.onStep?.({
              id: it.id,
              kind: 'steer',
              label: 'Steered',
              status: 'done',
              steerText: it.text,
            })
          }
          return items.map(
            (it): AgentMessage => ({ role: 'user', content: it.text, timestamp: Date.now() }),
          )
        } catch (err) {
          log.warn('getSteeringMessages failed', {
            sessionId: args.sessionId,
            err: err instanceof Error ? err.message : String(err),
          })
          return []
        }
      }
    : undefined

  log.info('chat stream request (pi)', {
    runtime: 'pi',
    sessionId: args.sessionId,
    model: args.settings.modelId,
    account: account.id,
    accountLabel: account.label,
    ...(account.account?.email ? { accountEmail: account.account.email } : {}),
    historyTurns: args.history.length,
  })

  const emit = (event: AgentEvent): void => {
    if (event.type === 'tool_execution_start') turnToolCalls += 1
    adapter.handle(event)
  }

  try {
    await runAgentLoop(
      [prompt],
      context,
      {
        model,
        // Initial key; getApiKey is the authoritative per-turn refresh.
        ...(initialKey ? { apiKey: initialKey } : {}),
        getApiKey,
        // convertToLlm: our AgentMessages are already pi Messages (no custom
        // message types), so pass through unchanged. Must not throw.
        convertToLlm: (messages) => messages as Message[],
        ...(reasoning ? { reasoning } : {}),
        beforeToolCall,
        // Mid-turn steering: inject user instructions queued via sessions.steer
        // at each turn boundary (undefined for tasks/subagents → no-op).
        ...(getSteeringMessages ? { getSteeringMessages } : {}),
        // Confabulation guard: polled when the model would otherwise stop (no
        // tool calls, no steering). Re-prompts once if the turn claimed work it
        // never performed (undefined in plan mode / no tools → no-op).
        ...(confabulationFollowUp ? { getFollowUpMessages: confabulationFollowUp } : {}),
        // Capture Codex plan-usage from response headers (no-op for non-Codex),
        // then gate on Anthropic extra-usage (overage): if a response consumed
        // PAID overage, park and ask the user to confirm before continuing — Pi
        // awaits onResponse, so this halts the loop in place (chat only; headless
        // warns). Inert when overage is off (claim never resolves to 'overage').
        onResponse: async (resp) => {
          recordCodexUsageFromHeaders(account.id, resp.headers)
          if (args.settings.provider === 'anthropic') {
            await confirmOverageOrStop(
              resp.headers,
              args.sessionId,
              args.askUserQuestion,
              args.abortController?.signal,
              () => args.abortController?.abort(),
            )
          }
        },
        // Parallel at the batch level so several `Task` subagents spawned in one
        // turn run concurrently (ADR 0030). Every non-Task tool is marked
        // executionMode: 'sequential' (createRuntimeToolDefinitions), so a batch
        // touching any regular tool still executes one-by-one — deterministic UI
        // steps, no interleaved permission prompts. Only a pure-Task batch fans out.
        toolExecution: 'parallel',
        // Plan mode: end the turn the moment the model presents a plan via
        // ExitPlanMode, so the UI's "Streaming…" indicator stops and the turn waits
        // for the user's approve/edit (a NEW turn runs on approval). ExitPlanMode
        // itself returns terminate:true, but Pi only auto-terminates a batch when
        // EVERY call in it terminates — so a model that batched ExitPlanMode with a
        // read-only sibling (Read/Grep) would otherwise keep looping. This stop is
        // turn-scoped: research turns that don't present a plan keep running.
        ...(inPlanMode
          ? {
              shouldStopAfterTurn: ({ message }: { message: AssistantMessage }): boolean =>
                message.content.some((c) => c.type === 'toolCall' && c.name === 'ExitPlanMode'),
            }
          : {}),
      },
      emit,
      args.abortController?.signal,
      streamSimple,
    )
  } catch (err) {
    throw mapErrorToRpc(err)
  }

  // Pi swallows a mid-stream abort into a graceful stopReason 'aborted' instead
  // of throwing (the provider catches the "Request was aborted" error and ends
  // the stream cleanly), so runAgentLoop returns normally. Surface it as a
  // CANCELED RpcError so sessions.send-message routes it through the cancel path
  // (persist the partial reply flagged `canceled`, reject the RPC with -32023)
  // — identical to a thrown abort — instead of persisting it as a normal
  // completion the UI can't tell apart from a finished turn.
  if (args.abortController?.signal.aborted) {
    throw new RpcError(-32023, 'CANCELED')
  }

  const acc = adapter.result()
  const doneMeta = {
    runtime: 'pi',
    sessionId: args.sessionId,
    model: acc.modelUsed,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    stopReason: acc.stopReason,
    // Provider error cause on a graceful `error` stop — without it the log just
    // reads stopReason:error with no clue why (e.g. a 400 "out of extra usage").
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
  }
  // Escalate to warn on a graceful error stop so it surfaces above info noise.
  if (acc.stopReason === 'error') {
    log.warn('chat stream done (pi)', doneMeta)
  } else {
    log.info('chat stream done (pi)', doneMeta)
  }

  // No opaque session id: resume rebuilds Context from JSONL each turn.
  return {
    text: acc.text,
    modelUsed: acc.modelUsed || args.settings.modelId,
    usage: {
      input_tokens: acc.inputTokens,
      output_tokens: acc.outputTokens,
      cache_read_tokens: acc.cacheReadTokens,
      cache_creation_tokens: acc.cacheWriteTokens,
    },
    stopReason: acc.stopReason,
    contextChars,
    // Forward the provider error cause on a graceful `error` stop so the caller
    // can persist + surface it (the run did NOT throw, so this is the only signal).
    ...(acc.errorMessage !== undefined ? { errorMessage: acc.errorMessage } : {}),
  }
}

// pi 0.84 routes the summarization request through a `Models` collection so pi
// can resolve auth itself. AWOG owns credentials (multi-account per provider —
// a shape pi's one-credential-per-provider CredentialStore can't express), so we
// hand generateSummary a minimal collection implementing the ONE method it calls
// (`completeSimple`), delegating to the same dispatcher with our per-turn key +
// the model's headers. Cast at the boundary: the rest of the Models surface is
// never touched on this path.
function summaryModels(apiKey: string, headers: Model<Api>['headers']): Models {
  return {
    completeSimple: (
      model: Model<Api>,
      context: Parameters<Models['completeSimple']>[1],
      options: Parameters<Models['completeSimple']>[2],
    ) => completeSimple(model, context, { ...options, apiKey, ...(headers ? { headers } : {}) }),
  } as unknown as Models
}

// `/compact` (ADR 0047). Re-summarises the older transcript prefix (the JSONL is
// the source of truth — ADR 0029) and returns a compaction checkpoint the caller
// persists; the model context is cut in buildContext on subsequent turns. We
// keep ~`keepRecentTokens` of recent turns verbatim and reserve `reserveTokens`
// for the summary prompt + output — both from Pi's DEFAULT_COMPACTION_SETTINGS.
// Failure / nothing-to-do → a notice with no `compaction` (never blocks).
async function runCompact(
  args: RunNonStreamArgs,
  model: ReturnType<typeof resolveModel>['model'],
  getApiKey: ReturnType<typeof resolveModel>['getApiKey'],
): Promise<RunStreamResult> {
  const notice = (text: string): RunStreamResult => ({
    text,
    modelUsed: args.settings.modelId,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
    stopReason: 'end_turn',
  })

  // Manual /compact passes keepRecentTokens: 0 (keep only the last turn) so it
  // compacts even a short conversation; auto-compact omits it → Pi's 20k default.
  const keepRecentTokens = args.keepRecentTokens ?? DEFAULT_COMPACTION_SETTINGS.keepRecentTokens
  const cut = computeCutPoint(args.history, keepRecentTokens)
  if (!cut) return notice('Nothing to compact yet — the conversation is still short.')
  // Already compacted through this exact point with nothing new to fold → skip
  // (prevents a no-op re-compact when /compact runs twice in a row).
  if (args.compaction && args.compaction.firstKeptMessageId === cut.firstKeptMessageId) {
    return notice('Already compacted — no new messages to summarize.')
  }

  const apiKey = await getApiKey(args.settings.provider)
  if (!apiKey) return notice('Compaction skipped: no credential available.')

  try {
    const summaryMessages = historyToAgentMessages(cut.toSummarize)
    const res = await generateSummary(
      summaryMessages,
      summaryModels(apiKey, model.headers),
      model,
      DEFAULT_COMPACTION_SETTINGS.reserveTokens,
      args.abortController?.signal,
    )
    if (!res.ok) {
      log.warn('runtime /compact: generateSummary failed', {
        sessionId: args.sessionId,
        err: String(res.error),
      })
      return notice('Compaction failed — the conversation is unchanged.')
    }
    // Post-compaction context `history` estimate = [kept turns + summary], measured
    // the SAME way as the per-turn `contextChars.history` above: TEXT-ONLY, via
    // historyToAgentMessages. We must NOT JSON.stringify the raw SessionMessages —
    // their `steps[]`/`parts[]` carry UI-only tool I/O (full file contents, terminal
    // output) that is NEVER replayed to the model, so counting them would inflate the
    // gauge far past what is actually sent and make /compact look like a no-op.
    const cutIdx = args.history.findIndex((m) => m.id === cut.firstKeptMessageId)
    const keptMsgs = cutIdx >= 0 ? args.history.slice(cutIdx) : args.history
    const compactedHistoryChars =
      JSON.stringify(historyToAgentMessages(keptMsgs)).length + res.value.length
    return {
      ...notice('Context compacted.'),
      compaction: {
        summary: res.value,
        firstKeptMessageId: cut.firstKeptMessageId,
        tokensBefore: cut.tokensBefore,
        at: new Date().toISOString(),
      },
      compactedHistoryChars,
    }
  } catch (err) {
    log.warn('runtime /compact failed', {
      sessionId: args.sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
    return notice('Compaction is not available right now.')
  }
}
