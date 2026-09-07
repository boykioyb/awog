// The `Task` subagent tool for the Pi runtime (ADR 0030, extended by ADR 0083).
// Lets the model delegate a focused job to a named AWOG agent, which runs as a
// nested `runAgentLoop` and returns its final text as the tool result.
//
// Why this exists: under OAuth the model is conditioned as Claude Code and emits
// `Task` calls; without this tool the loop returns "Tool Task not found". This
// restores the capability AND maps it onto AWOG's 5-tier agents.
//
// Design (ADR 0030):
//   - subagent_type → AWOG Agent (match by id, then name). Resolved config
//     (systemPrompt + tools + MCP + provider/model/account) via resolveAgentContext.
//   - The subagent honours its AGENT.md provider/model/account when set, else
//     inherits the parent turn's settings.
//   - Depth = 1: the subagent toolset is built WITHOUT a Task tool, so a
//     subagent can never spawn another (matches Claude Code).
//   - Streaming + the permission gate are caller-specific and injected via
//     `makeChildSink` + `beforeToolCall` so chat (run-stream) and tasks (invoke)
//     reuse the same core.
//
// Parity with the Claude SDK branch (ADR 0083). Its `AgentInput` carries four
// call-site controls the Pi branch used to lack; three of them live here:
//   - `model`: a fixed TIER (opus/sonnet/haiku/fable/inherit), never a free-form
//     id — see subagents/model-tier.ts for why.
//   - `run_in_background` + `name`: the subagent runs without blocking the tool
//     call; the model collects it with `TaskOutput` and can follow up with
//     `SendMessage`. Turn-scoped lifetime (subagents/registry.ts) — chat only.
//   - `subagent_type: "fork"`: a general-purpose subagent that also inherits a
//     CAPPED slice of the parent transcript, not just the parent's config.
//   - `isolation: "worktree"`: the subagent gets its own `git worktree` + branch
//     instead of sharing the session's working tree (ADR 0083 §c, shipped in #7c).
//     Chat only, and it ISOLATES ONLY — AWOG never merges that branch back into
//     the user's tree from a chat turn; see subagents/worktree-lease.ts.

import {
  runAgentLoop,
  type AgentContext,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from '@earendil-works/pi-agent-core'
import { Type, type Message } from '@earendil-works/pi-ai'
// pi 0.84: runAgentLoop takes the stream function explicitly (see run-stream.ts).
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { resolveCredential } from '../../credentials/credential-resolver.js'
import { recordCodexUsageFromHeaders } from '../../providers/openai/usage.js'
import { confirmOverageOrStop } from '../overage-guard.js'
import { resolveAgentContext, type ResolvedAgentContext } from '../../tasks/agent-context.js'
import { log } from '../../util/logger.js'
import type { Agent, SessionMessage, SessionSettings } from '../../types/shared.js'
import type { ApiSourcesConfig, McpServersConfig } from '../permission-types.js'
import { resolveModel } from '../model-resolver.js'
import { buildContext } from '../context-builder.js'
import { createRuntimeToolDefinitions } from './index.js'
import { buildMcpUnavailableNote } from './mcp-tools.js'
import {
  ENGINEERING_PROMPT,
  EVIDENCE_PROMPT,
  OUTPUT_SURFACE_PROMPT,
  SCRATCH_DIR_PROMPT,
  TOOL_DISCIPLINE_PROMPT,
  VERIFY_PROMPT,
} from '../prompts.js'
import { buildOneShotContextBlock } from '../../context/environment.js'
import { CO_AUTHOR_INSTRUCTION } from '../../git/co-author.js'
import { toReasoning } from '../thinking.js'
import type { BeforeToolCall } from '../permission.js'
import {
  isSubagentModelTier,
  resolveSubagentModel,
  SUBAGENT_MODEL_TIERS_TEXT,
  type SubagentModelTier,
} from '../subagents/model-tier.js'
import { SubagentRegistry, type SubagentSnapshot } from '../subagents/registry.js'
import { trimForkHistory } from '../subagents/fork-history.js'
import { WorktreeLeases } from '../subagents/worktree-lease.js'
import {
  clearExternalKiller,
  registerExternalBackground,
  setExternalKiller,
  settleExternalBackground,
} from '../../sessions/bg-registry.js'

// Per-turn safety cap on how many subagents a single parent turn may spawn.
// Prevents a runaway loop from fanning out indefinitely (depth is already
// capped at 1; this caps breadth).
const MAX_SUBAGENTS_PER_TURN = 25
// How many BACKGROUND subagents may run at once. Same number as the background
// shell cap (sessions/bg-registry.ts) and the task scheduler cap — one mental
// model for "how wide does AWOG fan out on its own".
const MAX_BACKGROUND_SUBAGENTS = 4
// Wall-clock cap for ONE background subagent. It runs with nobody watching it,
// so it needs a ceiling of its own; the turn budget (withTurnBudget) still caps
// the turn as a whole. Mirrors the task-budget shape (tasks/budget.ts) at a
// smaller scale — a background subagent is a helper, not a batch job.
const BACKGROUND_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000
// `TaskOutput({ block: true })` default + maximum wait. The cap matters: a model
// that asks to block for an hour would otherwise sit on the turn doing nothing.
const TASK_OUTPUT_DEFAULT_WAIT_MS = 120_000
const TASK_OUTPUT_MAX_WAIT_MS = 600_000
// `subagent_type` that means "same job, my context" instead of a named agent.
const FORK_SUBAGENT_TYPE = 'fork'
// `isolation` values we accept. `remote` (Claude SDK) has no meaning in AWOG —
// there is no remote executor — so it is not offered.
const ISOLATION_WORKTREE = 'worktree'
const ISOLATION_NONE = 'none'
// Trần chờ subagent dừng hẳn sau khi lượt cha abort, trước khi nhả worktree của
// nó. Đủ để một vòng lặp bị abort unwind, ngắn để một vòng lặp lì không treo lượt.
const SUBAGENT_DRAIN_TIMEOUT_MS = 10_000

const TaskParams = Type.Object({
  description: Type.String({
    description: 'A short (3-5 word) description of the task for display.',
  }),
  prompt: Type.String({
    description:
      'The full, self-contained task for the subagent. It runs autonomously with no further input, so include every detail it needs; its final message is returned to you as the result.',
  }),
  // Optional on purpose: under OAuth the model is conditioned as Claude Code,
  // where a `general-purpose` default always exists, so it occasionally omits
  // this field. Marking it required makes Pi's schema validator hard-fail before
  // execute() runs (cryptic "must have required properties" error). Keeping it
  // optional lets execute() resolve a sensible target instead: an omitted type
  // runs a general-purpose subagent that inherits this turn's config (mirrors
  // craft `spawn_session`, where omitted fields inherit from the spawning
  // session) — only a *named but unknown* type bounces back for correction.
  subagent_type: Type.Optional(
    Type.String({
      description:
        'The name of the subagent to launch (see the list of available types above). Omit to run a general-purpose subagent that inherits the current agent, tools, and model. Pass "fork" to also inherit the recent conversation.',
    }),
  ),
  // Typed as a plain string (not a union) for the same reason subagent_type is
  // optional: a schema hard-fail happens BEFORE execute() and surfaces as an
  // unactionable validator error, while execute() can bounce back a readable
  // list of valid tiers.
  model: Type.Optional(
    Type.String({
      description: `Optional model tier for this subagent: ${SUBAGENT_MODEL_TIERS_TEXT}. Takes precedence over the agent's own model. Omit to use the agent's model, else the parent's. Ignored for subagent_type "fork" (a fork always runs the parent's model).`,
    }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description:
        'Run the subagent in the background and return immediately with a task_id. Use it when other work can usefully happen while it runs; collect the result with TaskOutput BEFORE you finish your turn — background subagents do not survive the end of the turn.',
    }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        'Optional short name for this subagent. Makes it addressable by name in TaskOutput / TaskStop / SendMessage.',
    }),
  ),
  // Plain string for the same reason as `model`: a union would hard-fail in the
  // schema validator BEFORE execute() runs, surfacing as an unactionable error
  // instead of a readable list of valid values.
  isolation: Type.Optional(
    Type.String({
      description:
        'Set to "worktree" to run this subagent in its own git worktree on its own branch, leaving your working tree untouched. Use it when several subagents edit files at the same time. Default "none" (shares the current working tree).',
    }),
  ),
})

interface TaskDetails {
  subagentType: string
  description: string
  // Address of the spawned subagent within this turn (ADR 0083) — also what the
  // UI chip is keyed by for a background one.
  taskId?: string
  background?: boolean
  // Model the subagent actually ran on (after tier resolution).
  model?: string
  // Branch of the isolated worktree it ran in (ADR 0083 §c), when isolated.
  branch?: string
  isError?: true
}

// Caller-injected sink for a single subagent run: receives the nested Pi event
// stream (already tagged with the parent Task call's id by the adapter) and can
// hand back the subagent's accumulated final text once the loop settles.
export interface SubagentSink {
  emit: (event: AgentEvent) => void
  text: () => string
}

export interface TaskToolDeps {
  // Agents in scope for this turn (user tiers + the project's tiers). Drives the
  // tool description (the menu the model picks from) AND subagent_type matching.
  agents: Agent[]
  // Workspace root for the subagent's fs/bash tools (same root as the parent).
  cwd: string
  // The parent turn's settings — the subagent inherits level/mode and falls back
  // to the parent's provider/model/account when its AGENT.md doesn't specify one.
  parentSettings: SessionSettings
  // The parent turn's base system prompt + tool whitelist. Used to build the
  // general-purpose subagent when the model omits `subagent_type` (craft-style
  // inherit-from-parent): it runs with the parent's prompt/tools/model instead
  // of an AGENT.md.
  parentSystemPrompt?: string
  parentAllowedTools?: string[]
  // Session-scoped tool denylist, applied to the subagent toolset too.
  disabledTools?: string[]
  // Task source connection unioned into the subagent's MCP set (tasks only).
  connectionId?: string
  // The parent turn's ALREADY-RESOLVED MCP servers (session/task whitelist ∩
  // enabled + secrets expanded). Unioned into the subagent's own AGENT.md-resolved
  // set so a subagent can always reach every MCP server its parent could — "what
  // the session can use, the subagent it spawns can use too". Without this a
  // subagent with its own narrower `mcpServerIds` whitelist silently loses the
  // session's servers (e.g. fails `mcp__<id>__*` with "not found").
  parentMcpServers?: McpServersConfig
  // The parent turn's enabled api sources (ADR 0060 P3), unioned into the
  // subagent's own AGENT.md-resolved set (own wins on a duplicate id) so the
  // subagent reaches every api tool its parent could — same guarantee as
  // parentMcpServers.
  parentApiSources?: ApiSourcesConfig
  // Permission gate for the subagent's tool calls. Chat reuses the parent gate
  // (so writes still prompt); tasks pass an always-allow gate (bypass).
  beforeToolCall: BeforeToolCall
  // Git `commitCoAuthor` setting inherited from the parent turn. When on (default),
  // append the AWOG co-author instruction to the subagent prompt (Pi has no
  // built-in commit attribution). Omitted → on.
  commitCoAuthor?: boolean
  // Build the per-run event sink. `parentToolCallId` is the Task call's id so the
  // sink can tag every nested step/trace with it for UI nesting.
  makeChildSink: (parentToolCallId: string) => SubagentSink
  // ── ADR 0083 ────────────────────────────────────────────────────────────
  // May a subagent run in the background (and therefore may TaskOutput /
  // TaskStop / SendMessage be offered)? Chat only. A task node is a one-shot:
  // nothing of it survives its end, so a background subagent there is a result
  // that can never be collected — the Claude SDK branch forces tasks synchronous
  // for exactly this reason (runtime/claude-sdk/shared.ts).
  allowBackground?: boolean
  // Session id. Two uses, both chat-only: mirroring background subagents as UI
  // chips via the shared background registry (same list the Claude SDK branch
  // feeds), and being the OWNER id of an isolated worktree (tasks/worktree.ts).
  // Absent → no chips and no isolation.
  sessionId?: string
  // May a subagent ask for `isolation: "worktree"`? Chat only. A task node already
  // runs in its own worktree and its branch is merged back at the drain point
  // (ADR 0081); nesting a second, never-merged worktree inside it would silently
  // drop the subagent's edits from the node's commit.
  allowIsolation?: boolean
  // The parent session transcript, used by `subagent_type: "fork"`. A capped tail
  // is replayed into the fork's context; absent → a fork degrades to a plain
  // general-purpose subagent.
  parentHistory?: SessionMessage[]
}

// Match a model-supplied `subagent_type` to a concrete agent: exact id, then
// case-insensitive name, then slugified name (spaces → dashes).
function matchAgent(agents: Agent[], subagentType: string): Agent | undefined {
  const needle = subagentType.trim().toLowerCase()
  return (
    agents.find((a) => a.id === subagentType) ??
    agents.find((a) => a.name.toLowerCase() === needle) ??
    agents.find((a) => a.name.toLowerCase().replace(/\s+/g, '-') === needle)
  )
}

// Render the available-subagents menu into the tool description so the model
// picks a valid `subagent_type`. Empty list → a note that none are configured.
function describeTool(agents: Agent[], allowBackground: boolean, allowIsolation: boolean): string {
  const intro =
    'Launch a specialized AWOG subagent to handle a focused, multi-step task autonomously. ' +
    'The subagent runs with its own system prompt, tools, and MCP servers, then returns its final message as the result. ' +
    'It cannot launch further subagents. Provide a short `description` and a detailed self-contained `prompt`. ' +
    'Pass `subagent_type` to pick one of the agents below; omit it to run a general-purpose subagent that inherits the current agent, tools, and model; pass "fork" to run a general-purpose subagent that ALSO inherits the recent conversation (use it when the job only makes sense with what we just discussed).'
  const background = allowBackground
    ? '\n\nSet `run_in_background: true` to keep working while it runs — then collect its result with `TaskOutput` before you finish your turn (background subagents are stopped when the turn ends). Give it a `name` to address it later with `TaskOutput`, `TaskStop` or `SendMessage`.'
    : ''
  const isolation = allowIsolation
    ? '\n\nSet `isolation: "worktree"` when a subagent will EDIT files while other work is happening at the same time: it then gets its own checkout on its own branch, so nothing it writes can collide with yours or another subagent\'s. Its changes stay on that branch — the working tree is not modified and nothing is merged for you; report the branch name so the user can merge it. Leave it out for read-only or one-at-a-time work: a fresh checkout has no node_modules, no .env and no build cache.'
    : ''
  if (agents.length === 0) {
    return `${intro}${background}${isolation}\n\n(No named subagents are configured in this workspace — calling this runs a general-purpose subagent that inherits the current agent, tools, and model.)`
  }
  const menu = agents
    .map(
      (a) => `- ${a.name}: ${a.description?.split('\n')[0]?.trim() || a.role || 'general-purpose'}`,
    )
    .join('\n')
  return `${intro}${background}${isolation}\n\nAvailable subagent_type values:\n${menu}`
}

// Union the parent turn's resolved MCP servers with the subagent's own. Returns
// undefined when neither side has servers (so createRuntimeToolDefinitions skips
// the MCP round-trip). On a duplicate server id the subagent's own entry wins;
// both maps are already secrets-expanded so the entries are equivalent anyway.
function mergeMcpServers(
  parent: McpServersConfig | undefined,
  own: McpServersConfig | undefined,
): McpServersConfig | undefined {
  if (!parent && !own) return undefined
  return { ...(parent ?? {}), ...(own ?? {}) }
}

// Union the parent turn's api sources with the subagent's own (ADR 0060 P3).
// Deduped by source id — the subagent's own entry wins on a collision. Returns
// undefined when neither side has any (so createRuntimeToolDefinitions skips it).
function mergeApiSources(
  parent: ApiSourcesConfig | undefined,
  own: ApiSourcesConfig | undefined,
): ApiSourcesConfig | undefined {
  if (!parent && !own) return undefined
  const byId = new Map<string, ApiSourcesConfig[number]>()
  for (const s of parent ?? []) byId.set(s.id, s)
  for (const s of own ?? []) byId.set(s.id, s)
  return [...byId.values()]
}

// Merge the resolved agent context onto the parent settings: the agent's
// provider/model/account win when present, the rest inherits the parent turn.
function subagentSettings(
  parent: SessionSettings,
  ctx: { provider?: SessionSettings['provider']; model?: string; accountId?: string },
): SessionSettings {
  const settings: SessionSettings = {
    provider: ctx.provider ?? parent.provider,
    modelId: ctx.model || parent.modelId,
    level: parent.level,
    mode: parent.mode,
  }
  const accountId = ctx.accountId ?? parent.accountId
  if (accountId !== undefined) settings.accountId = accountId
  return settings
}

// One prepared subagent: its config is resolved and its toolset built, but no
// LLM call has happened yet. `run` can be called more than once — the Pi context
// accumulates, so a follow-up (SendMessage) continues the same conversation
// instead of starting a stranger with the same name.
interface PreparedSubagent {
  label: string
  modelId: string
  // Set when a requested model tier could not be honoured (see model-tier.ts).
  note?: string
  run: (prompt: string, signal?: AbortSignal) => Promise<string>
}

interface PrepareOptions {
  tier?: SubagentModelTier
  fork: boolean
  // Working tree for this subagent: the session/task cwd, or an isolated worktree
  // leased for this one run (ADR 0083 §c). Drives BOTH its fs/bash sandbox root
  // and its orientation block, so it never reads one tree and writes another.
  cwd: string
}

// Resolve a subagent's config + credential + model and build its Task-free
// toolset. Throws on credential/model failure — execute() maps it.
async function prepareSubagent(
  deps: TaskToolDeps,
  parentToolCallId: string,
  agent: Agent | null,
  opts: PrepareOptions,
  setupSignal?: AbortSignal,
): Promise<PreparedSubagent> {
  // A named agent resolves its AGENT.md context. A null agent (the model omitted
  // `subagent_type`, or asked for a fork) builds a general-purpose context that
  // inherits the parent turn: no provider/model/account (so subagentSettings
  // falls back to the parent) and no own MCP whitelist (the parent's servers
  // arrive via parentMcpServers below).
  const label = agent ? agent.name : opts.fork ? FORK_SUBAGENT_TYPE : 'general-purpose'
  const agentCtx: ResolvedAgentContext = agent
    ? await resolveAgentContext(
        {
          id: agent.id,
          source: agent.source,
          ...(agent.projectId ? { projectId: agent.projectId } : {}),
        },
        undefined,
        deps.connectionId,
      )
    : {
        ...(deps.parentSystemPrompt ? { systemPrompt: deps.parentSystemPrompt } : {}),
        ...(deps.parentAllowedTools ? { allowedTools: deps.parentAllowedTools } : {}),
      }

  const inherited = subagentSettings(deps.parentSettings, agentCtx)
  const { account } = await resolveCredential(inherited.provider, inherited.accountId)
  // Call-site model tier (ADR 0083 §a). Resolved against THIS account so the tier
  // can only ever land on a model the account really runs; an unhonourable tier
  // keeps the inherited model and says so in the result.
  const tiered = opts.tier
    ? resolveSubagentModel(opts.tier, inherited.modelId, inherited.provider, account)
    : undefined
  const settings: SessionSettings = tiered ? { ...inherited, modelId: tiered.modelId } : inherited
  const { model, getApiKey } = resolveModel(settings, account)

  // MCP set = the parent turn's resolved servers ∪ the subagent's own
  // AGENT.md-resolved servers (own wins on a duplicate id — both maps are already
  // secrets-expanded so identical entries are equivalent). Guarantees the subagent
  // inherits every server the parent could reach, regardless of its own whitelist.
  const mcpServers = mergeMcpServers(deps.parentMcpServers, agentCtx.mcpServers)
  // Same union for api sources (ADR 0060 P3) — the subagent reaches every api
  // tool its parent could, plus its own AGENT.md-resolved ones.
  const apiSources = mergeApiSources(deps.parentApiSources, agentCtx.apiSources)

  // Parent-inherited servers'/sources' `mcp__<id>__*` tools must bypass the
  // agent's `tools:` whitelist — the session/task attached them, not the agent,
  // so a narrow allowedTools list (e.g. just Read/Write/Bash) must not silently
  // strip them (the merge comments above promise the subagent reaches every
  // parent server/source). The agent's OWN AGENT.md servers/sources still respect
  // allowedTools. The bypass is keyed by source id (the `mcp__<id>__` segment).
  const parentMcpIds = deps.parentMcpServers ? Object.keys(deps.parentMcpServers) : []
  const parentApiIds = (deps.parentApiSources ?? []).map((s) => s.id)
  const bypassIds = [...parentMcpIds, ...parentApiIds]

  // Subagent toolset: built-in + the merged MCP + api tools, filtered by the
  // agent's allowedTools and the session denylist. NO Task tool (depth = 1) and
  // NO plan.
  const { tools, failures: mcpFailures, mcpCatalog } = await createRuntimeToolDefinitions(
    opts.cwd,
    mcpServers,
    apiSources,
    {
      ...(agentCtx.allowedTools ? { allowedTools: agentCtx.allowedTools } : {}),
      ...(deps.disabledTools ? { disabledTools: deps.disabledTools } : {}),
      ...(bypassIds.length > 0 ? { bypassAllowlistMcpServerIds: bypassIds } : {}),
      // Per-source Explore scoping (ADR 0060 P4) for the subagent's OWN
      // AGENT.md-resolved sources. Parent-inherited sources arrive already scoped
      // by the parent turn; their patterns aren't re-applied here (they bypass the
      // agent whitelist too, see bypassIds above).
      ...(agentCtx.sourceToolPatterns ? { sourceToolPatterns: agentCtx.sourceToolPatterns } : {}),
      ...(agentCtx.sourceApiEndpoints ? { sourceApiEndpoints: agentCtx.sourceApiEndpoints } : {}),
    },
    setupSignal,
  )

  // Surface attached-but-failed MCP servers to the subagent too, so a delegated
  // review/fetch can't silently fabricate when its server is unreachable. The MCP
  // catalog (ADR 0051) rides along when the inherited toolset is in proxy mode.
  const mcpUnavailable = buildMcpUnavailableNote(mcpFailures)
  // Orientation + engineering scaffolding (ADR 0071). A subagent starts with no
  // conversation to infer context from, so being blind to the OS, the cwd and the
  // state of the tree hurts it more than it hurts the parent. COMMUNICATION_PROMPT
  // is deliberately omitted: its output contract targets the human reader, and a
  // subagent's report is consumed by the parent model. EVIDENCE_PROMPT matters
  // most here — the parent has to be able to trust and re-check what it gets back.
  // OUTPUT_SURFACE_PROMPT IS included even though COMMUNICATION_PROMPT is not
  // (ADR 0077 §5): it is not a rule about tone or audience but about whether the
  // text survives being reused. A subagent asked for a PR body or a release note
  // gets quoted verbatim by the parent, so hard-wrapped prose lands straight in the
  // final message — and nested subagent steps render in the transcript anyway.
  const subContextBlock = await buildOneShotContextBlock(opts.cwd)
  const subAppend =
    [
      subContextBlock,
      agentCtx.systemPromptAppend,
      ENGINEERING_PROMPT,
      EVIDENCE_PROMPT,
      OUTPUT_SURFACE_PROMPT,
      TOOL_DISCIPLINE_PROMPT,
      // Scratch-space convention: a subagent writes working files even more
      // readily than the parent (it dumps intermediate findings), and it has no
      // conversation to pick up the habit from.
      SCRATCH_DIR_PROMPT,
      VERIFY_PROMPT,
      // Inherit the parent turn's co-author setting (Pi has no built-in attribution).
      deps.commitCoAuthor === false ? undefined : CO_AUTHOR_INSTRUCTION,
      mcpUnavailable,
      mcpCatalog,
    ]
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .join('\n\n') || undefined

  // A fork replays a capped tail of the parent transcript; every other subagent
  // starts from an empty history (its prompt is self-contained by contract).
  const history = opts.fork ? trimForkHistory(deps.parentHistory ?? []) : []
  const reasoning = toReasoning(settings.level, model)

  // Built lazily on the first run and REUSED afterwards: pi appends every message
  // to `context.messages`, so a follow-up prompt continues the same conversation.
  let context: AgentContext | undefined

  const run = async (prompt: string, signal?: AbortSignal): Promise<string> => {
    let promptMsg: AgentMessage
    if (context) {
      promptMsg = { role: 'user', content: prompt, timestamp: Date.now() }
    } else {
      const built = buildContext(history, prompt, agentCtx.systemPrompt, subAppend, tools)
      context = built.context
      promptMsg = built.prompt
    }
    const sink = deps.makeChildSink(parentToolCallId)
    const initialKey = await getApiKey(settings.provider)

    log.info('subagent run (pi)', {
      subagent: label,
      parentToolCallId,
      model: settings.modelId,
      account: account.id,
      tools: tools.length,
      forkedMessages: history.length,
    })

    await runAgentLoop(
      [promptMsg],
      context,
      {
        model,
        ...(initialKey ? { apiKey: initialKey } : {}),
        getApiKey,
        convertToLlm: (messages) => messages as Message[],
        ...(reasoning ? { reasoning } : {}),
        beforeToolCall: deps.beforeToolCall,
        // Capture Codex usage, then fail closed on Anthropic extra-usage: a subagent
        // is headless (no askUser) so it STOPS rather than silently bill overage.
        onResponse: async (resp) => {
          recordCodexUsageFromHeaders(account.id, resp.headers)
          if (settings.provider === 'anthropic') {
            await confirmOverageOrStop(resp.headers, 'subagent', undefined, signal, undefined)
          }
        },
        toolExecution: 'sequential',
      },
      sink.emit,
      signal,
      streamSimple,
    )

    return sink.text()
  }

  return {
    label,
    modelId: settings.modelId,
    ...(tiered?.note ? { note: tiered.note } : {}),
    run,
  }
}

function textResult<D>(
  text: string,
  details: D,
): { content: [{ type: 'text'; text: string }]; details: D } {
  return { content: [{ type: 'text', text }], details }
}

// Join the subagent's own output with any operator-level notes (tier fallback,
// forced-synchronous…). Notes come last so they never displace the answer.
function withNotes(text: string, notes: string[]): string {
  if (notes.length === 0) return text
  return `${text}\n\n(${notes.join(' ')})`
}

// Build the `Task` AgentTool for one parent turn. The returned tool is added at
// the top level only (run-stream / invoke) — never to a subagent's toolset.
//
// `registry` and `leases` are optional so the task path (runtime/invoke.ts) keeps
// its existing one-argument call: it gets a registry that allows no background run
// and no worktree leases, which is exactly what a one-shot node needs.
export function createTaskTool(
  deps: TaskToolDeps,
  registry: SubagentRegistry = new SubagentRegistry({
    maxBackground: 0,
    backgroundTimeoutMs: 0,
  }),
  leases?: WorktreeLeases,
): AgentTool<typeof TaskParams, TaskDetails> {
  let spawned = 0
  const canBackground = deps.allowBackground === true && registry.maxBackground > 0
  const canIsolate = leases !== undefined

  return {
    name: 'Task',
    label: 'Task',
    description: describeTool(deps.agents, canBackground, canIsolate),
    parameters: TaskParams,
    // Intentionally NOT marked sequential: when the model spawns several Task
    // calls in one turn they fan out in parallel (the parent loop runs with
    // toolExecution: 'parallel', and every other tool is marked sequential so
    // only a pure-Task batch parallelises — ADR 0030). Each subagent streams
    // under its own parentId, so nested steps stay grouped per Task card.
    async execute(toolCallId, params, signal) {
      const requested = params.subagent_type?.trim()
      const isFork = requested?.toLowerCase() === FORK_SUBAGENT_TYPE
      const details: TaskDetails = {
        subagentType: requested || 'general-purpose',
        description: params.description,
      }

      // Call-site model tier. A bad value bounces (the model can retry with a
      // valid tier) instead of silently running the wrong model.
      let tier: SubagentModelTier | undefined
      const rawTier = params.model?.trim().toLowerCase()
      if (rawTier) {
        if (!isSubagentModelTier(rawTier)) {
          return textResult(
            `Unknown model "${params.model}". Valid values: ${SUBAGENT_MODEL_TIERS_TEXT}. Omit it to use the subagent's own model.`,
            { ...details, isError: true as const },
          )
        }
        // 'inherit' is the default behaviour — no override to apply.
        if (rawTier !== 'inherit') tier = rawTier
      }
      // A fork is the parent, continued: running it on a different model would
      // make it a different agent. Same rule as the Claude SDK branch.
      if (isFork) tier = undefined

      // Isolation is a REQUEST too. A bad value bounces so the model can retry;
      // an unavailable one degrades to the shared tree with a note (the work still
      // has to happen), exactly like run_in_background.
      const rawIsolation = params.isolation?.trim().toLowerCase()
      if (rawIsolation && rawIsolation !== ISOLATION_WORKTREE && rawIsolation !== ISOLATION_NONE) {
        return textResult(
          `Unknown isolation "${params.isolation}". Valid values: "${ISOLATION_WORKTREE}", "${ISOLATION_NONE}". Omit it to share the current working tree.`,
          { ...details, isError: true as const },
        )
      }
      const wantsWorktree = rawIsolation === ISOLATION_WORKTREE

      // Resolve the target. A *named* type must match an in-scope agent, else we
      // bounce so the model can fix a typo'd name. An *omitted* type is not an
      // error: `agent` stays null and prepareSubagent runs a general-purpose
      // subagent inheriting this turn's config (craft `spawn_session` semantics).
      let agent: Agent | null = null
      if (requested && !isFork && deps.agents.length > 0) {
        const matched = matchAgent(deps.agents, requested)
        if (!matched) {
          const names = deps.agents.map((a) => a.name).join(', ')
          return textResult(
            `Unknown subagent_type "${requested}". Available subagents: ${names}. Retry with one of these, or omit subagent_type to run a general-purpose subagent.`,
            details,
          )
        }
        agent = matched
      }
      details.subagentType = isFork ? FORK_SUBAGENT_TYPE : agent ? agent.name : 'general-purpose'

      // A name is an ADDRESS: reusing one would silently redirect a later
      // SendMessage to the wrong subagent.
      const name = params.name?.trim()
      if (name && registry.has(name)) {
        return textResult(
          `The name "${name}" is already taken by another subagent in this turn. Pick a different name.`,
          { ...details, isError: true as const },
        )
      }

      if (spawned >= MAX_SUBAGENTS_PER_TURN) {
        return textResult(
          `Subagent limit reached (${MAX_SUBAGENTS_PER_TURN} per turn). Complete the remaining work yourself instead of delegating further.`,
          details,
        )
      }
      spawned += 1

      // Background is a REQUEST, not a guarantee: a task node has no way to
      // collect the result, and the concurrency cap is a real ceiling. Degrade to
      // synchronous (the work still happens) and say why.
      const notes: string[] = []
      let background = params.run_in_background === true
      if (background && !canBackground) {
        background = false
        notes.push('Background subagents are not available here, so this one ran synchronously.')
      }
      if (background && registry.countRunningBackground() >= registry.maxBackground) {
        background = false
        notes.push(
          `The background subagent limit (${registry.maxBackground}) was already reached, so this one ran synchronously.`,
        )
      }

      // Worktree lease. Acquired BEFORE prepareSubagent because the checkout is
      // the subagent's fs/bash sandbox root — building its toolset against the
      // shared tree and then moving it would let it read one tree and write
      // another. Released at the end of the parent turn (disposeAll), never here:
      // a SendMessage follow-up keeps running in the same checkout.
      let cwd = deps.cwd
      let branch: string | undefined
      if (wantsWorktree) {
        if (!canIsolate || !leases) {
          notes.push(
            'Worktree isolation is not available here, so this subagent ran in the shared working tree.',
          )
        } else {
          const lease = await leases.acquire(toolCallId)
          cwd = lease.cwd
          branch = lease.branch
          if (lease.note) notes.push(lease.note)
        }
      }
      if (branch) {
        details.branch = branch
        notes.push(
          `It ran in an isolated worktree on branch "${branch}"; the working tree was not touched and nothing was merged. Any files it changed are committed to that branch when this turn ends — report the branch name so the user can \`git merge ${branch}\` if they want the changes.`,
        )
      }

      try {
        const prepared = await prepareSubagent(
          deps,
          toolCallId,
          agent,
          { ...(tier ? { tier } : {}), fork: isFork, cwd },
          signal,
        )
        if (prepared.note) notes.push(prepared.note)
        details.model = prepared.modelId

        const snap = registry.start({
          label: prepared.label,
          description: params.description,
          ...(name ? { name } : {}),
          prompt: params.prompt,
          run: prepared.run,
          background,
          // Pi hands `execute` the TURN's signal, so cancelling the turn kills a
          // background subagent immediately instead of waiting for disposeAll().
          ...(signal ? { parentSignal: signal } : {}),
        })
        details.taskId = snap.id

        if (background) {
          details.background = true
          const address = name ? `"${snap.id}" (name: "${name}")` : `"${snap.id}"`
          return textResult(
            withNotes(
              `Started subagent "${prepared.label}" in the background as task_id ${address}. ` +
                `Keep working; collect its result with TaskOutput({ task_id: "${snap.id}", block: true }) before you finish this turn — background subagents are stopped when the turn ends.`,
              notes,
            ),
            details,
          )
        }

        const final = await registry.settle(snap.id)
        if (!final || final.status !== 'done') {
          const why = final?.error ?? 'unknown error'
          // Surface as a non-fatal tool error so the parent can recover (re-plan
          // or do the work itself) rather than aborting the whole turn. Flagged per
          // tool-error.ts so it still RENDERS as an error: a dead subagent must not
          // look like a completed delegation.
          return textResult(`Subagent "${prepared.label}" failed: ${why}`, {
            ...details,
            isError: true as const,
          })
        }
        const followUp = canBackground
          ? `\n\n(subagent id: ${snap.id} — reply to it with SendMessage({ to: "${snap.id}", message: "…" }) if you need a follow-up)`
          : ''
        return textResult(
          `${withNotes(final.text || '(subagent produced no output)', notes)}${followUp}`,
          details,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const who = agent ? agent.name : details.subagentType
        log.warn('subagent spawn failed', { subagent: who, err: message })
        return textResult(`Subagent "${who}" failed: ${message}`, {
          ...details,
          isError: true as const,
        })
      }
    },
  }
}

// ─── Control tools for background subagents (ADR 0083 §b + §e) ─────────────

const TaskOutputParams = Type.Object({
  task_id: Type.String({
    description: 'The task_id (or name) returned when the subagent was started.',
  }),
  block: Type.Optional(
    Type.Boolean({ description: 'Wait for the subagent to finish (default true).' }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: `Max wait in milliseconds when blocking (default ${TASK_OUTPUT_DEFAULT_WAIT_MS}, max ${TASK_OUTPUT_MAX_WAIT_MS}).`,
    }),
  ),
})

interface ControlDetails {
  taskId: string
  status?: string
  isError?: true
}

function describeSubagent(snap: SubagentSnapshot): string {
  return snap.name ? `${snap.id} ("${snap.name}", ${snap.label})` : `${snap.id} (${snap.label})`
}

// Format a settled/running subagent for the model. Text first — the report is
// what the parent asked for.
function formatSnapshot(snap: SubagentSnapshot, waitedMs: number): string {
  switch (snap.status) {
    case 'running':
      return `Subagent ${describeSubagent(snap)} is still running after ${Math.round(waitedMs / 1000)}s. Call TaskOutput again to keep waiting, or TaskStop to give up on it.`
    case 'done':
      return snap.text || '(subagent produced no output)'
    case 'stopped':
      return `Subagent ${describeSubagent(snap)} was stopped: ${snap.error ?? 'no reason recorded'}.`
    default:
      return `Subagent ${describeSubagent(snap)} failed: ${snap.error ?? 'unknown error'}.`
  }
}

function unknownSubagent(registry: SubagentRegistry, ref: string): string {
  const known = registry.list().map((s) => describeSubagent(s))
  const list = known.length > 0 ? known.join(', ') : 'none'
  return `No subagent "${ref}" in this turn. Known subagents: ${list}.`
}

function createTaskOutputTool(
  registry: SubagentRegistry,
): AgentTool<typeof TaskOutputParams, ControlDetails> {
  return {
    name: 'TaskOutput',
    label: 'Task output',
    description:
      'Collect the result of a subagent started with Task({ run_in_background: true }). By default it blocks until the subagent finishes. Always collect a background subagent before you end your turn — it is stopped when the turn ends.',
    parameters: TaskOutputParams,
    executionMode: 'sequential',
    async execute(_id, params) {
      const ref = params.task_id.trim()
      if (!registry.has(ref)) {
        return textResult(unknownSubagent(registry, ref), { taskId: ref, isError: true as const })
      }
      const startedAt = Date.now()
      let snap: SubagentSnapshot | undefined
      if (params.block === false) {
        snap = registry.get(ref)
      } else {
        const wait = Math.min(
          Math.max(params.timeout ?? TASK_OUTPUT_DEFAULT_WAIT_MS, 1_000),
          TASK_OUTPUT_MAX_WAIT_MS,
        )
        snap = await registry.waitFor(ref, wait)
      }
      if (!snap) {
        return textResult(unknownSubagent(registry, ref), { taskId: ref, isError: true as const })
      }
      const details: ControlDetails = { taskId: snap.id, status: snap.status }
      const failed = snap.status === 'error' || snap.status === 'stopped'
      return textResult(formatSnapshot(snap, Date.now() - startedAt), {
        ...details,
        ...(failed ? { isError: true as const } : {}),
      })
    },
  }
}

const TaskStopParams = Type.Object({
  task_id: Type.String({ description: 'The task_id (or name) of the subagent to stop.' }),
})

function createTaskStopTool(
  registry: SubagentRegistry,
): AgentTool<typeof TaskStopParams, ControlDetails> {
  return {
    name: 'TaskStop',
    label: 'Stop subagent',
    description:
      'Stop a background subagent started with Task({ run_in_background: true }). Use it when its work is no longer needed. Stopping an already-finished subagent is harmless.',
    parameters: TaskStopParams,
    executionMode: 'sequential',
    async execute(_id, params) {
      const ref = params.task_id.trim()
      if (!registry.stop(ref)) {
        return textResult(unknownSubagent(registry, ref), { taskId: ref, isError: true as const })
      }
      const snap = registry.get(ref)
      return textResult(`Stopped subagent ${snap ? describeSubagent(snap) : ref}.`, {
        taskId: snap?.id ?? ref,
        status: snap?.status ?? 'stopped',
      })
    },
  }
}

const SendMessageParams = Type.Object({
  to: Type.String({ description: 'The task_id or name of the subagent to message.' }),
  message: Type.String({ description: 'The follow-up instruction or question for that subagent.' }),
})

function createSendMessageTool(
  registry: SubagentRegistry,
): AgentTool<typeof SendMessageParams, ControlDetails> {
  return {
    name: 'SendMessage',
    label: 'Send message',
    description:
      'Send a follow-up message to a subagent you already ran in this turn, keeping everything it saw and did. Use it to ask for a correction or a deeper pass instead of spawning a fresh subagent that has to rediscover the context. It blocks until the subagent answers, and only works once that subagent has finished its current run (collect it with TaskOutput first).',
    parameters: SendMessageParams,
    executionMode: 'sequential',
    async execute(_id, params, signal) {
      const ref = params.to.trim()
      const outcome = await registry.sendMessage(ref, params.message, signal)
      if (!outcome.ok) {
        const reason =
          outcome.reason === 'unknown'
            ? unknownSubagent(registry, ref)
            : outcome.reason === 'running'
              ? `Subagent "${ref}" is still running. Collect it with TaskOutput first, then send your follow-up.`
              : `Subagent "${ref}" ended as "${outcome.reason}" and cannot be resumed. Start a new one with Task.`
        return textResult(reason, { taskId: ref, isError: true as const })
      }
      const snap = outcome.snap
      const details: ControlDetails = { taskId: snap.id, status: snap.status }
      if (snap.status !== 'done') {
        return textResult(formatSnapshot(snap, 0), { ...details, isError: true as const })
      }
      return textResult(snap.text || '(subagent produced no output)', details)
    },
  }
}

export interface SubagentToolset {
  // Task + its control tools, ready to push into the parent toolset.
  tools: AgentTool[]
  // MUST be awaited when the parent turn ends (success, error or cancel): a
  // background subagent may not outlive the turn that spawned it, and every
  // isolated worktree has to be released through the rescue net (uncommitted work
  // is committed as WIP on the subagent's branch) before the turn is reported
  // done. Awaited, not fire-and-forget: the branch a user is told to merge must
  // exist by the time they read the message.
  disposeAll: () => Promise<void>
}

// Build the full subagent toolset for a CHAT turn (ADR 0083): `Task` plus the
// control tools that make a background subagent usable. The task path keeps
// calling createTaskTool directly — a one-shot node has nowhere to collect a
// background result, so it stays synchronous.
export function createSubagentTools(deps: TaskToolDeps): SubagentToolset {
  const sessionId = deps.sessionId
  const registry = new SubagentRegistry({
    maxBackground: deps.allowBackground ? MAX_BACKGROUND_SUBAGENTS : 0,
    backgroundTimeoutMs: BACKGROUND_SUBAGENT_TIMEOUT_MS,
    // Mirror background subagents as UI chips through the SAME registry the
    // background shells and the Claude SDK branch use, so the user sees one list
    // and can stop a runaway subagent from the chip.
    ...(sessionId
      ? {
          onStarted: (snap: SubagentSnapshot): void => {
            if (!snap.background) return
            registerExternalBackground({
              sessionId,
              shellId: snap.id,
              command: `Task: ${snap.description}`,
            })
          },
          onSettled: (snap: SubagentSnapshot): void => {
            if (!snap.background) return
            settleExternalBackground({
              sessionId,
              shellId: snap.id,
              status: snap.status === 'done' ? 'exited' : 'exited-unknown',
              exitCode: snap.status === 'done' ? 0 : null,
              ...(snap.error ? { summary: snap.error } : {}),
            })
          },
        }
      : {}),
  })

  // Worktree leases (ADR 0083 §c). Only chat, and only with a session id: the id
  // is the OWNER key that the boot sweeper scans, so without it a checkout could
  // be orphaned with nobody to clean it up.
  const leases =
    deps.allowIsolation && sessionId
      ? new WorktreeLeases({ kind: 'session', id: sessionId }, deps.cwd)
      : undefined

  const tools: AgentTool[] = [createTaskTool(deps, registry, leases)]
  if (deps.allowBackground) {
    tools.push(createTaskOutputTool(registry), createTaskStopTool(registry))
    tools.push(createSendMessageTool(registry))
    if (sessionId) setExternalKiller(sessionId, (shellId) => void registry.stop(shellId))
  }

  return {
    tools,
    disposeAll: async (): Promise<void> => {
      registry.abortAll()
      if (sessionId && deps.allowBackground) clearExternalKiller(sessionId)
      if (leases) {
        // Abort chỉ phát tín hiệu — đợi vòng lặp dừng hẳn trước khi đụng vào cây
        // của nó, kẻo `git status` chạy đua với một tool call đang ghi dở.
        await registry.drain(SUBAGENT_DRAIN_TIMEOUT_MS)
        await leases.releaseAll()
      }
    },
  }
}
