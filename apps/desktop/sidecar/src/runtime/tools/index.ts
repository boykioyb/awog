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
import type { AskUserQuestionFn, McpServersConfig } from '../permission-types.js'
import {
  createEditTool,
  createGlobTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from './fs-tools.js'
import { createBashTool } from './bash-tool.js'
import { createMcpToolDefinitions } from './mcp-tools.js'
import { createExitPlanModeTool } from './plan-tool.js'
import { createAskUserQuestionTool } from './ask-user-question-tool.js'
import { createTodoWriteTool, createWebSearchTool, createWebFetchTool } from './builtin-stubs.js'
import { wrapToolsWithHooks, type HookToolContext } from '../../hooks/tool-anchor.js'

export interface ToolFilter {
  // Agent `tools` whitelist (Claude Code subagent field). When set + non-empty,
  // only tools whose name is in this list survive. Undefined/empty = no filter.
  allowedTools?: string[]
  // Session-scoped denylist. Tools whose name is in this list are removed.
  disabledTools?: string[]
  // Include the ExitPlanMode tool. Only the chat runtime sets this (when the
  // session is in plan mode) so the model can present a plan; tasks never plan.
  includePlanTool?: boolean
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
  const all: AgentTool[] = [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createBashTool(cwd),
    createGrepTool(cwd),
    createGlobTool(cwd),
    // Graceful stubs for Claude Code built-ins the OAuth model emits but AWOG
    // doesn't implement (ADR 0030) — avoids "Tool <name> not found".
    createTodoWriteTool(),
    createWebSearchTool(),
    createWebFetchTool(),
    // AskUserQuestion: interactive in chat (askUser set), graceful no-op
    // elsewhere. Always present so the model can use it and a stray OAuth call
    // never errors out.
    createAskUserQuestionTool(askUser),
    ...(filter.includePlanTool ? [createExitPlanModeTool()] : []),
  ] as AgentTool[]

  return applyFilter(all, filter)
}

// Assemble the COMPLETE tool set for a turn: built-in AWOG tools + the bridged
// MCP tools (mcp__<serverId>__<tool>) from the already-resolved `mcpServers`
// map. allowedTools/disabledTools filter both kinds uniformly. A failing MCP
// server is skipped inside createMcpToolDefinitions (warn + skip), so this never
// throws on MCP connectivity. Async because MCP needs a tools/list round-trip.
export async function createRuntimeToolDefinitions(
  cwd: string,
  mcpServers: McpServersConfig | undefined,
  filter: ToolFilter = {},
  signal?: AbortSignal,
  // Forwarded to the AskUserQuestion tool — set only by the chat runtime.
  askUser?: AskUserQuestionFn,
  // Hook anchor context (ADR 0032). When set, every tool's execute is wrapped so
  // tool.* / artifact.* hooks fire around it (sessions + tasks). Absent → no wrap.
  hookContext?: HookToolContext,
): Promise<AgentTool[]> {
  const builtIn = createAwogToolDefinitions(cwd, filter, askUser)
  const mcp = await createMcpToolDefinitions(mcpServers, signal)
  // Built-in tools are already filtered; filter MCP tools by the same rules.
  const tools = [...builtIn, ...applyFilter(mcp, filter)]
  return hookContext ? wrapToolsWithHooks(tools, hookContext) : tools
}
