// Runtime agent/MCP resolution for a workflow node (ADR 0024). Lifted from
// sessions.send-message.ts so chat and task execution resolve identically:
//   - agent.systemPrompt → systemPrompt
//   - agent.tools → allowedTools
//   - agent.mcpServerIds ∩ enabled servers → mcpServers map (secrets expanded)
//   - an MCP-preference nudge when the agent whitelists servers
//
// A node carries the full agent tuple (id + source + projectId). When source is
// absent OR a stale pre-0035 value (`project-claude`, …), fall back to a
// lookup-by-id across all `.awog` tiers (ADR 0035 D-7) so old workflows keep
// resolving after the user imports the agent into `.awog`.

import { loadAgent, listAgents } from '../agents/store.js'
import { listProjects } from '../projects/store.js'
import { listServers as listMcpServers } from '../mcp/store.js'
import { expandSecrets } from '../mcp/secrets.js'
import { log } from '../util/logger.js'
import type { Agent, AgentSource, ProviderName } from '../types/shared.js'
import type { McpServersConfig } from '../runtime/permission-types.js'

export interface AgentRef {
  id: string
  source?: AgentSource
  projectId?: string
}

export interface ResolvedAgentContext {
  agentName?: string
  // The agent's LLM provider + optional account (AGENT.md / ADR 0026). node-runner
  // threads these into SessionSettings so the runtime resolves the right account
  // instead of hardcoding anthropic + active account. Default 'anthropic'.
  provider?: ProviderName
  accountId?: string
  // The agent's preferred model (AGENT.md frontmatter). node-runner uses it as
  // the run's modelId; falls back to a default when absent.
  model?: string
  systemPrompt?: string
  allowedTools?: string[]
  mcpServers?: McpServersConfig
  systemPromptAppend?: string
}

async function allProjectIds(): Promise<string[]> {
  try {
    const projects = await listProjects()
    return projects.map((p) => p.id)
  } catch {
    return []
  }
}

async function loadAgentFlexibly(ref: AgentRef): Promise<Agent | null> {
  // Known `.awog` tier → load directly; if it's missing (e.g. a stale pre-0035
  // ref or not-yet-imported), fall through to the id-match below.
  if (ref.source === 'global' || ref.source === 'project') {
    const direct = await loadAgent(ref.id, ref.source, ref.projectId)
    if (direct) return direct
  }
  // No (or unresolvable) source — find the first agent with this id across tiers.
  try {
    const { agents } = await listAgents(await allProjectIds())
    return agents.find((a) => a.id === ref.id) ?? null
  } catch {
    return null
  }
}

async function buildMcpServers(
  agentMcpIds: string[] | undefined,
  connectionId?: string,
): Promise<{ mcpServers?: McpServersConfig; attached: { id: string; name: string }[] }> {
  const attached: { id: string; name: string }[] = []
  const entries: [string, unknown][] = []
  try {
    const all = await listMcpServers()
    const whitelist = agentMcpIds && agentMcpIds.length > 0 ? new Set(agentMcpIds) : null
    for (const s of all) {
      if (!s.enabled) continue
      // The task's connection bypasses the per-agent whitelist (ADR 0025) so
      // every node can reach the source; other servers still respect it.
      const isConnection = connectionId !== undefined && s.id === connectionId
      if (whitelist && !whitelist.has(s.id) && !isConnection) continue
      let cfg: unknown
      if (s.transport === 'stdio') {
        if (!s.command) continue
        // eslint-disable-next-line no-await-in-loop
        const env = await expandSecrets(s.id, s.env)
        cfg = {
          type: 'stdio' as const,
          command: s.command,
          ...(s.args ? { args: s.args } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      } else if (s.transport === 'http') {
        if (!s.url) continue
        // eslint-disable-next-line no-await-in-loop
        const headers = await expandSecrets(s.id, s.headers)
        cfg = {
          type: 'http' as const,
          url: s.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }
      } else {
        continue
      }
      entries.push([s.id, cfg])
      attached.push({ id: s.id, name: s.name })
    }
  } catch (err) {
    log.warn('task: failed to list mcp servers', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  if (entries.length === 0) return { attached }
  return { mcpServers: Object.fromEntries(entries) as McpServersConfig, attached }
}

function mcpNudge(attached: { id: string; name: string }[]): string {
  const lines = attached.map((s) => `- mcp__${s.id}__* (${s.name})`).join('\n')
  return `<mcp-preference>
The following MCP servers are attached to this task:
${lines}

Prefer the corresponding \`mcp__<serverId>__<toolName>\` tools over CLI equivalents.
</mcp-preference>`
}

// Resolve the agent context for a node. `baseSystemPrompt` is an optional prompt
// the agent prompt is layered onto (usually undefined for tasks).
export async function resolveAgentContext(
  ref: AgentRef,
  baseSystemPrompt?: string,
  // Task's source connection (mcpServerId) — unioned into the node's MCP set
  // regardless of the agent's per-agent whitelist (ADR 0025, simplified).
  connectionId?: string,
): Promise<ResolvedAgentContext> {
  const ctx: ResolvedAgentContext = {}
  if (baseSystemPrompt) ctx.systemPrompt = baseSystemPrompt

  let agent: Agent | null = null
  try {
    agent = await loadAgentFlexibly(ref)
  } catch (err) {
    log.warn('task: failed to load agent', {
      ref,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  if (!agent) return ctx

  ctx.agentName = agent.name
  // Surface the agent's provider/account so the run targets the right credential
  // (defaults applied by the caller). Under the `sdk` runtime non-anthropic still
  // won't work — this just stops hardcoding so the pi runtime can use it in C3.
  if (agent.provider) ctx.provider = agent.provider
  if (agent.accountId) ctx.accountId = agent.accountId
  if (agent.model) ctx.model = agent.model
  if (agent.systemPrompt) ctx.systemPrompt = agent.systemPrompt
  if (agent.tools && agent.tools.length > 0) ctx.allowedTools = agent.tools

  const { mcpServers, attached } = await buildMcpServers(agent.mcpServerIds, connectionId)
  if (mcpServers) {
    ctx.mcpServers = mcpServers
    // Nudge toward mcp__* tools when the agent whitelists servers OR the task
    // attached a connection (so it prefers the connection over a CLI).
    const hasWhitelist = !!agent.mcpServerIds && agent.mcpServerIds.length > 0
    if (attached.length > 0 && (hasWhitelist || connectionId)) {
      ctx.systemPromptAppend = mcpNudge(attached)
    }
  }

  return ctx
}
