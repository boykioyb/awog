// The `Task` subagent tool for the Pi runtime (ADR 0030). Lets the model
// delegate a focused job to a named AWOG agent, which runs as a nested
// `runAgentLoop` to completion and returns its final text as the tool result.
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

import { runAgentLoop, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type Message } from '@earendil-works/pi-ai'
import { resolveCredential } from '../../credentials/credential-resolver.js'
import { recordCodexUsageFromHeaders } from '../../providers/openai/usage.js'
import { resolveAgentContext } from '../../tasks/agent-context.js'
import { log } from '../../util/logger.js'
import type { Agent, SessionSettings } from '../../types/shared.js'
import type { McpServersConfig } from '../permission-types.js'
import { resolveModel } from '../model-resolver.js'
import { buildContext } from '../context-builder.js'
import { createRuntimeToolDefinitions } from './index.js'
import { toReasoning } from '../thinking.js'
import type { BeforeToolCall } from '../permission.js'

// Per-turn safety cap on how many subagents a single parent turn may spawn.
// Prevents a runaway loop from fanning out indefinitely (depth is already
// capped at 1; this caps breadth).
const MAX_SUBAGENTS_PER_TURN = 25

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
  // optional lets execute() recover gracefully — same path as an unknown name.
  subagent_type: Type.Optional(
    Type.String({
      description: 'The name of the subagent to launch (see the list of available types above).',
    }),
  ),
})

interface TaskDetails {
  subagentType: string
  description: string
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
  // Permission gate for the subagent's tool calls. Chat reuses the parent gate
  // (so writes still prompt); tasks pass an always-allow gate (bypass).
  beforeToolCall: BeforeToolCall
  // Build the per-run event sink. `parentToolCallId` is the Task call's id so the
  // sink can tag every nested step/trace with it for UI nesting.
  makeChildSink: (parentToolCallId: string) => SubagentSink
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
function describeTool(agents: Agent[]): string {
  const intro =
    'Launch a specialized AWOG subagent to handle a focused, multi-step task autonomously. ' +
    'The subagent runs to completion with its own system prompt, tools, and MCP servers, then returns its final message as the result. ' +
    'It cannot launch further subagents. Provide a short `description`, the agent name as `subagent_type`, and a detailed self-contained `prompt`.'
  if (agents.length === 0) {
    return `${intro}\n\n(No subagents are currently configured in this workspace — if you call this, you will be told to complete the task yourself.)`
  }
  const menu = agents
    .map((a) => `- ${a.name}: ${a.description?.split('\n')[0]?.trim() || a.role || 'general-purpose'}`)
    .join('\n')
  return `${intro}\n\nAvailable subagent_type values:\n${menu}`
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

// Run one subagent end to end: resolve its config + credential + model, build a
// Task-free toolset, run a nested agent loop streaming through the sink, and
// return its final text. Throws on credential/model failure — execute() maps it.
async function spawnSubagent(
  deps: TaskToolDeps,
  parentToolCallId: string,
  agent: Agent,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const agentCtx = await resolveAgentContext(
    { id: agent.id, source: agent.source, ...(agent.projectId ? { projectId: agent.projectId } : {}) },
    undefined,
    deps.connectionId,
  )

  const settings = subagentSettings(deps.parentSettings, agentCtx)
  const { account } = await resolveCredential(settings.provider, settings.accountId)
  const { model, getApiKey } = resolveModel(settings, account)

  // MCP set = the parent turn's resolved servers ∪ the subagent's own
  // AGENT.md-resolved servers (own wins on a duplicate id — both maps are already
  // secrets-expanded so identical entries are equivalent). Guarantees the subagent
  // inherits every server the parent could reach, regardless of its own whitelist.
  const mcpServers = mergeMcpServers(deps.parentMcpServers, agentCtx.mcpServers)

  // Subagent toolset: built-in + the merged MCP tools, filtered by the agent's
  // allowedTools and the session denylist. NO Task tool (depth = 1) and NO plan.
  const tools = await createRuntimeToolDefinitions(
    deps.cwd,
    mcpServers,
    {
      ...(agentCtx.allowedTools ? { allowedTools: agentCtx.allowedTools } : {}),
      ...(deps.disabledTools ? { disabledTools: deps.disabledTools } : {}),
    },
    signal,
  )

  const { context, prompt: promptMsg } = buildContext(
    [],
    prompt,
    agentCtx.systemPrompt,
    agentCtx.systemPromptAppend,
    tools,
  )

  const reasoning = toReasoning(settings.level, model)
  const sink = deps.makeChildSink(parentToolCallId)
  const initialKey = await getApiKey(settings.provider)

  log.info('subagent spawn (pi)', {
    subagent: agent.name,
    parentToolCallId,
    model: settings.modelId,
    account: account.id,
    tools: tools.length,
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
      onResponse: (resp) => recordCodexUsageFromHeaders(account.id, resp.headers),
      toolExecution: 'sequential',
    },
    sink.emit,
    signal,
  )

  return sink.text()
}

// Build the `Task` AgentTool for one parent turn. The returned tool is added at
// the top level only (run-stream / invoke) — never to a subagent's toolset.
export function createTaskTool(deps: TaskToolDeps): AgentTool<typeof TaskParams, TaskDetails> {
  let spawned = 0

  return {
    name: 'Task',
    label: 'Task',
    description: describeTool(deps.agents),
    parameters: TaskParams,
    // Never run concurrently with other tools — keeps nested step ordering and
    // permission prompts deterministic.
    executionMode: 'sequential',
    async execute(toolCallId, params, signal) {
      const requested = params.subagent_type?.trim()
      const details: TaskDetails = {
        subagentType: requested || '(unspecified)',
        description: params.description,
      }

      if (deps.agents.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No subagents are configured in this workspace, so the Task tool cannot delegate. Complete the task yourself using your available tools.',
            },
          ],
          details,
        }
      }

      // Resolve which agent to run. A missing subagent_type is tolerated: with
      // exactly one agent in scope we pick it (the unambiguous default), else we
      // ask the model to name one — the same recovery path as an unknown name.
      let agent: Agent | undefined
      if (requested) {
        agent = matchAgent(deps.agents, requested)
      } else if (deps.agents.length === 1) {
        agent = deps.agents[0]
      }
      if (!agent) {
        const names = deps.agents.map((a) => a.name).join(', ')
        const reason = requested
          ? `Unknown subagent_type "${requested}".`
          : 'No subagent_type was provided.'
        return {
          content: [
            {
              type: 'text',
              text: `${reason} Available subagents: ${names}. Retry with one of these, or complete the task yourself.`,
            },
          ],
          details,
        }
      }
      details.subagentType = agent.name

      if (spawned >= MAX_SUBAGENTS_PER_TURN) {
        return {
          content: [
            {
              type: 'text',
              text: `Subagent limit reached (${MAX_SUBAGENTS_PER_TURN} per turn). Complete the remaining work yourself instead of delegating further.`,
            },
          ],
          details,
        }
      }
      spawned += 1

      try {
        const text = await spawnSubagent(deps, toolCallId, agent, params.prompt, signal)
        return {
          content: [{ type: 'text', text: text || '(subagent produced no output)' }],
          details,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn('subagent run failed', { subagent: agent.name, err: message })
        // Surface as a non-fatal tool error so the parent can recover (re-plan
        // or do the work itself) rather than aborting the whole turn.
        return {
          content: [{ type: 'text', text: `Subagent "${agent.name}" failed: ${message}` }],
          details,
        }
      }
    },
  }
}
