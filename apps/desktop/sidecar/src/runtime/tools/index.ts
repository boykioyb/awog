// Assemble the AWOG AgentTool set for a Pi agent loop (ADR 0029).
//
// Tool names are the canonical Claude Code names (Read/Write/Edit/Bash/Grep/
// Glob) so step-mapper.ts maps them without changes AND so Pi's OAuth tool-name
// canonicalisation is a no-op (it rewrites to these exact names under OAuth).
// MCP tools follow the `mcp__<serverId>__<tool>` convention (runtime/tools/
// mcp-tools.ts) so trace-mapper + the system-prompt MCP nudge key off them.
//
// Filtering: allowedTools (agent.tools whitelist) intersects the set; then
// disabledTools (session denylist) subtracts. Both compare by tool name and
// apply to built-in AND MCP tools alike.

import type { AgentTool } from '@earendil-works/pi-agent-core'
import type {
  AskUserQuestionFn,
  ApiSourcesConfig,
  CompiledApiEndpoint,
  McpServersConfig,
} from '../permission-types.js'
import { createApiToolDefinitions } from '../../sources/api-tools.js'
import {
  createEditTool,
  createGlobTool,
  createGrepTool,
  createMultiEditTool,
  createReadTool,
  createWriteTool,
} from './fs-tools.js'
import { createNotebookEditTool, createNotebookReadTool } from './notebook-tools.js'
import { createBashTool } from './bash-tool.js'
import { createBashOutputTool } from './bash-output-tool.js'
import { createMcpToolDefinitions, type McpLoadFailure, type McpToolAllowed } from './mcp-tools.js'
import { createExitPlanModeTool } from './plan-tool.js'
import { createAskUserQuestionTool } from './ask-user-question-tool.js'
import { createSourceTools } from './source-tools.js'
import { createWikiTools } from './wiki-tools.js'
import { createMemoryTools } from './memory-tools.js'
import { createTodoWriteTool, createWebSearchTool } from './builtin-stubs.js'
import { getReadRegistry } from './read-registry.js'
import type { TodoSink } from './builtin-stubs.js'
import { createWebFetchTool } from './web-fetch-tool.js'
import { createBrowserTool } from './browser-tool.js'
import { wrapToolsWithHooks, type HookToolContext } from '../../hooks/tool-anchor.js'

export interface ToolFilter {
  // Conversation key for the read-before-write registry (read-registry.ts).
  // Write/Edit refuse to touch an existing file the model has not Read, and the
  // toolset is rebuilt every turn — so the registry has to outlive the toolset or
  // the model would have to re-Read on every single turn. Chat sets this to the
  // session id; tasks to the task id. Absent (one-shot completions) = a fresh
  // per-construction registry, which is stricter, never looser.
  readRegistryKey?: string
  // Agent `tools` whitelist (Claude Code subagent field). When set + non-empty,
  // only tools whose name is in this list survive. Undefined/empty = no filter.
  allowedTools?: string[]
  // Session-scoped denylist. Tools whose name is in this list are removed.
  disabledTools?: string[]
  // Include the ExitPlanMode tool. Only the chat runtime sets this (when the
  // session is in plan mode) so the model can present a plan; tasks never plan.
  includePlanTool?: boolean
  // Include the agent-callable `source_*` tools (ADR 0060 P6: list/create/test/
  // set-credential/oauth-trigger). Only the chat runtime (sessions) sets this so
  // the model can set up Sources conversationally; unattended tasks never do.
  // Filtered by allowedTools/disabledTools like any tool; the mutating ones are
  // gated by the permission hook (runtime/permission.ts).
  includeSourceTools?: boolean
  // MCP server ids whose `mcp__<id>__*` tools bypass the allowedTools whitelist
  // (disabledTools STILL applies). Set by the subagent Task path to the parent's
  // inherited servers: the session/task attached them, not the agent, so an
  // agent's narrower `tools:` list must not strip them (ADR 0030 inheritance).
  // Has no effect on built-in tools (their names never match `mcp__<id>__`).
  bypassAllowlistMcpServerIds?: string[]
  // Per-source Explore scoping (ADR 0060 P4), keyed by source id. When a source id
  // has a non-empty entry, ONLY its tools (mcp__<id>__*) whose full name matches
  // one of these auto-scoped regexes survive — a pure per-source RESTRICTION that
  // never widens access or affects non-source tools. Absent/empty for a source =
  // current behaviour (all its tools exposed). Applied regardless of the
  // allowedTools whitelist / bypass (it is the source's OWN declared scope).
  sourceToolPatterns?: Record<string, RegExp[]>
  // Per-source compiled allowedApiEndpoints (ADR 0060 P4), keyed by source id.
  // Gates NON-GET calls of that source's `mcp__<id>__api_<slug>` tool to a
  // matching rule (GET always allowed). Absent/empty = no api-call gating.
  sourceApiEndpoints?: Record<string, CompiledApiEndpoint[]>
  // Background exec context (ADR 0066): when set, the Bash tool accepts
  // run_in_background and a BashOutput tool is added so the model can poll it.
  // Set ONLY by the chat runtime (sessions) — a session can be woken when a
  // background command exits. Never set for tasks/subagents/one-shot, so
  // run_in_background silently degrades to synchronous there. Not a filter per se,
  // but threaded here alongside the other per-turn tool-assembly options.
  backgroundExec?: { sessionId: string }
  // Wiki tools (ADR 0073). Set ONLY when the wiki actually has a page the LLM may
  // see, so a user who never made a wiki pays zero tokens for its tool schemas.
  // `projectId` scopes the project-tier wiki for the turn.
  includeWikiTools?: {
    projectId?: string | undefined
    // Agent may create/update/delete wiki pages (Settings → Wiki, default off).
    canWrite?: boolean | undefined
  }
  // Memory tools (ADR 0073 D-11). `autoWrite` gates memory_remember/memory_forget
  // (Settings opt-in, default off); `hasBodies` gates memory_read. Absent = no
  // memory tools at all.
  includeMemoryTools?: {
    projectId?: string | undefined
    autoWrite: boolean
    hasBodies: boolean
  }
  // Checklist persistence: when set, TodoWrite also writes its list to the session's
  // Session.todos, which is what lets the user edit the checklist and have the edit
  // survive the model's next TodoWrite (sessions/todo-context.ts). Set ONLY by the
  // chat runtime (sessions); tasks track progress through their own DAG, so there
  // TodoWrite stays a pure ACK.
  todoSink?: TodoSink
}

// Whether a tool name survives the filter: allowedTools (intersect when set) +
// disabledTools (subtract). Exported so the top-level Task tool (added outside
// this module, ADR 0030) can honour the same allowedTools/disabledTools rules.
export function isToolAllowed(name: string, filter: ToolFilter): boolean {
  const allow =
    filter.allowedTools && filter.allowedTools.length > 0 ? new Set(filter.allowedTools) : null
  const deny =
    filter.disabledTools && filter.disabledTools.length > 0 ? new Set(filter.disabledTools) : null
  if (allow && !allow.has(name)) return false
  if (deny && deny.has(name)) return false
  return true
}

// Apply allowedTools (intersect when set) + disabledTools (subtract) by name.
// When allowedTools is unset, every tool is included by default; when set, a
// tool survives only if its name is in the whitelist — applied uniformly to
// built-in tools AND mcp__<serverId>__<tool> names (an agent's `tools` whitelist
// gates MCP tool names too).
function applyFilter(tools: AgentTool[], filter: ToolFilter): AgentTool[] {
  return tools.filter((t) => isToolAllowed(t.name, filter))
}

// Build the MCP allow predicate handed to createMcpToolDefinitions: a (serverId,
// toolName) passes the agent allowedTools (intersect) + session disabledTools
// (subtract), EXCEPT servers in bypassAllowlistMcpServerIds skip the allowedTools
// whitelist (they were attached at the session/turn level, not by the agent —
// ADR 0030 inheritance); disabledTools still applies. The MCP bridge uses this
// for BOTH the direct path (which tools to synthesize) and the proxy path (which
// to list in the catalog + accept in mcp_call) — ADR 0051.
function buildMcpAllowed(filter: ToolFilter): McpToolAllowed {
  const bypass =
    filter.bypassAllowlistMcpServerIds && filter.bypassAllowlistMcpServerIds.length > 0
      ? new Set(filter.bypassAllowlistMcpServerIds)
      : null
  const sourcePatterns = filter.sourceToolPatterns
  return (serverId, toolName) => {
    const name = `mcp__${serverId}__${toolName}`
    // Per-source Explore scoping (ADR 0060 P4): when THIS source declared
    // allowedMcpPatterns, only its tools matching one survive. A pure restriction
    // applied FIRST + independent of the allowedTools whitelist / bypass — it is
    // the source's OWN scope, not the agent's whitelist. No entry → no effect.
    const scoped = sourcePatterns?.[serverId]
    if (scoped && scoped.length > 0 && !scoped.some((re) => re.test(name))) return false
    if (bypass && bypass.has(serverId)) {
      // Bypass allowedTools for this server; still honour the session denylist.
      return isToolAllowed(name, filter.disabledTools ? { disabledTools: filter.disabledTools } : {})
    }
    return isToolAllowed(name, filter)
  }
}

export function createAwogToolDefinitions(
  cwd: string,
  filter: ToolFilter = {},
  // Interactive AskUserQuestion handler. Supplied only by the chat runtime
  // (sessions). When absent (tasks / subagents) the tool falls back to a
  // headless no-op so a stray call never deadlocks. See ask-user-question-tool.
  askUser?: AskUserQuestionFn,
): AgentTool[] {
  // The full built-in set. `as AgentTool[]` widens the per-tool parameter
  // generics to the AgentTool default (TSchema) for a homogeneous array — Pi's
  // runtime validates each tool against its own schema regardless.
  // One registry per conversation, shared by Read (which records) and
  // Write/Edit/MultiEdit (which gate on it).
  const reads = getReadRegistry(filter.readRegistryKey)
  const all: AgentTool[] = [
    createReadTool(cwd, reads),
    createWriteTool(cwd, reads),
    createEditTool(cwd, reads),
    createMultiEditTool(cwd, reads),
    createBashTool(cwd, filter.backgroundExec),
    // BashOutput: poll a background shell (ADR 0066). Sessions only (paired with
    // Bash's run_in_background), and only when backgroundExec is set.
    ...(filter.backgroundExec ? [createBashOutputTool(filter.backgroundExec.sessionId)] : []),
    createGrepTool(cwd),
    createGlobTool(cwd),
    createNotebookReadTool(cwd),
    createNotebookEditTool(cwd),
    // Graceful stubs for Claude Code built-ins the OAuth model emits but AWOG
    // doesn't implement (ADR 0030) — avoids "Tool <name> not found".
    // TodoWrite persists to Session.todos when the chat runtime supplies a sink,
    // otherwise it is a pure ACK (see builtin-stubs).
    createTodoWriteTool(filter.todoSink),
    createWebSearchTool(),
    // Real fetch over the SSRF-guarded HTTP path (ADR 0042).
    createWebFetchTool(),
    // Embedded-Chromium browser, driven via the reverse host channel (ADR 0043).
    createBrowserTool(cwd),
    // AskUserQuestion: interactive in chat (askUser set), graceful no-op
    // elsewhere. Always present so the model can use it and a stray OAuth call
    // never errors out.
    createAskUserQuestionTool(askUser),
    ...(filter.includePlanTool ? [createExitPlanModeTool()] : []),
    // Source setup tools (ADR 0060 P6) — sessions only (includeSourceTools).
    ...(filter.includeSourceTools ? createSourceTools() : []),
    // Wiki lookup (ADR 0073) — present only when the wiki has LLM-visible pages.
    ...(filter.includeWikiTools ? createWikiTools(filter.includeWikiTools) : []),
    // Memory (ADR 0073 part B) — write tools only when the user opted in.
    ...(filter.includeMemoryTools ? createMemoryTools(filter.includeMemoryTools) : []),
  ] as AgentTool[]

  return applyFilter(all, filter)
}

// The assembled turn toolset plus any MCP servers that failed to load. Callers
// turn `failures` into a system-prompt note (buildMcpUnavailableNote) so the
// model never silently calls absent tools or fabricates their results.
export interface RuntimeToolset {
  tools: AgentTool[]
  failures: McpLoadFailure[]
  // Proxy mode only (ADR 0051): the <mcp-tools> catalog block for the system
  // prompt. Callers append it to systemPromptAppend. Undefined in direct mode.
  mcpCatalog?: string
}

// Assemble the COMPLETE tool set for a turn: built-in AWOG tools + the bridged
// MCP tools (mcp__<serverId>__<tool>) from the already-resolved `mcpServers`
// map. allowedTools/disabledTools filter both kinds uniformly. A failing MCP
// server is skipped inside createMcpToolDefinitions (warn + skip) and reported
// via `failures`, so this never throws on MCP connectivity. Async because MCP
// needs a tools/list round-trip.
export async function createRuntimeToolDefinitions(
  cwd: string,
  mcpServers: McpServersConfig | undefined,
  // Enabled `api` sources (ADR 0060 P3), already whitelist-filtered upstream.
  // Each becomes one in-process `mcp__<id>__api_<slug>` tool; filtered by the
  // SAME allowedTools/disabledTools/bypass predicate as the MCP tools.
  apiSources: ApiSourcesConfig | undefined,
  filter: ToolFilter = {},
  signal?: AbortSignal,
  // Forwarded to the AskUserQuestion tool — set only by the chat runtime.
  askUser?: AskUserQuestionFn,
  // Hook anchor context (ADR 0032). When set, every tool's execute is wrapped so
  // tool.* / artifact.* hooks fire around it (sessions + tasks). Absent → no wrap.
  hookContext?: HookToolContext,
  // Session MCP pool key (sessionId). Forwarded to the MCP bridge so a session's
  // stateful servers (e.g. Playwright) keep one child across turns — the browser
  // stays open between tool calls. Only the chat runtime (sessions) sets it;
  // tasks / subagents / one-shot omit it → per-call spawn (unchanged).
  mcpPoolKey?: string,
): Promise<RuntimeToolset> {
  const builtIn = createAwogToolDefinitions(cwd, filter, askUser)
  // MCP filtering lives inside the bridge now (buildMcpAllowed predicate) so the
  // direct AND proxy paths apply the same allowedTools/disabledTools/bypass rule.
  // Returns direct typed tools under the schema-size threshold, or proxy meta-
  // tools (mcp_describe + mcp_call) + a `catalog` block at/over it (ADR 0051).
  const mcpAllowed = buildMcpAllowed(filter)
  const { tools: mcpTools, failures, catalog } = await createMcpToolDefinitions(
    mcpServers,
    mcpAllowed,
    signal,
    mcpPoolKey,
  )
  // API sources (ADR 0060 P3): one `mcp__<id>__api_<slug>` tool per allowed
  // source, reusing the SAME allow predicate as the MCP tools so the agent
  // allowedTools / session disabledTools / parent-inherited bypass all cover
  // them uniformly. Its credential is read fresh from the keychain per call.
  // Per-source allowedApiEndpoints (ADR 0060 P4) gate non-GET calls at execute.
  const apiTools = createApiToolDefinitions(
    apiSources,
    mcpAllowed,
    signal,
    filter.sourceApiEndpoints,
  )
  const tools = [...builtIn, ...mcpTools, ...apiTools]
  // Force sequential execution for EVERY built-in + MCP tool. Pi decides
  // parallel vs sequential per BATCH: a batch runs parallel only when the loop's
  // toolExecution is 'parallel' AND no tool in it is marked sequential
  // (agent-loop.executeToolCalls). Marking all non-Task tools keeps regular tool
  // batches ordered — deterministic UI steps, no interleaved permission prompts —
  // while letting a pure-`Task` batch fan out in parallel (ADR 0030). The Task
  // tool is added at the TOP LEVEL (run-stream / invoke), never here, so it stays
  // unmarked and parallel-eligible. See those callers' `toolExecution: 'parallel'`.
  for (const tool of tools) tool.executionMode = 'sequential'
  assertNoReservedToolNames(tools)
  return {
    tools: hookContext ? wrapToolsWithHooks(tools, hookContext) : tools,
    failures,
    ...(catalog ? { mcpCatalog: catalog } : {}),
  }
}

// Anthropic reserves the `mcp_<word>` tool-name namespace — lowercase `mcp_`
// followed by a NON-underscore char (e.g. `mcp_call`, `mcp_describe`) — for its
// MCP connector, a metered/paid feature. A custom tool whose name matches is
// billed to the extra-usage bucket: under an OAuth subscription it hard-400s
// "You're out of extra usage" when extra usage is off, and — far worse —
// SILENTLY bills real money on accounts with unlimited extra usage (no error, no
// signal). The double-underscore bridge convention `mcp__<serverId>__<tool>` is
// EXEMPT (4th char is `_`, so it never matches `^mcp_[^_]`) and is how every
// external MCP tool is named here — so this guard can only ever trip on an
// AWOG-authored built-in/proxy name, i.e. a programming bug. We fail fast (the
// turn errors visibly) rather than let a colliding name reach the API and bill
// silently. Empirically mapped 2026-06-22; see ADR 0051 + mcp-tools.ts.
const RESERVED_MCP_TOOL_NAME_RE = /^mcp_[^_]/

function assertNoReservedToolNames(tools: AgentTool[]): void {
  const offending = tools.map((t) => t.name).filter((n) => RESERVED_MCP_TOOL_NAME_RE.test(n))
  if (offending.length > 0) {
    throw new Error(
      `Tool name(s) collide with Anthropic's reserved mcp_ connector namespace ` +
        `(would be billed as extra usage): ${offending.join(', ')}. Rename to a ` +
        `non-"mcp_<word>" form (e.g. mcpCall). The mcp__<server>__<tool> bridge ` +
        `convention is exempt.`,
    )
  }
}
