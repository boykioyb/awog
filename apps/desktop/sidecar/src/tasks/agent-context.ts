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
import { listSources } from '../sources/store.js'
import { applyOAuthAuthorization } from '../sources/oauth-manager.js'
import {
  resolveSourceGate,
  accumulateSourceGate,
  gateToolFilterFields,
  emptyGateAccumulator,
  buildLocalSourcesNote,
} from '../sources/gate.js'
import { expandSecrets } from '../mcp/secrets.js'
import { log } from '../util/logger.js'
import type { Agent, AgentSource, LocalSource, ProviderName } from '../types/shared.js'
import type {
  ApiSourcesConfig,
  CompiledApiEndpoint,
  McpServersConfig,
} from '../runtime/permission-types.js'

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
  // Enabled api sources (ADR 0060 P3) resolved for this node — bridged to
  // `mcp__<id>__api_<slug>` tools by the runtime (Pi path).
  apiSources?: ApiSourcesConfig
  // Per-source Explore scoping (ADR 0060 P4), keyed by source id. Tasks run
  // unattended so trust:'prompt' is NOT enforced here (no interactive gate — see
  // node-runner); these gate ONLY tool EXPOSURE / api-call scoping (Pi path):
  //   sourceToolPatterns → restrict a source to its own allowedMcpPatterns tools.
  //   sourceApiEndpoints → gate a source's non-GET api calls.
  // trust:'deny' is enforced upstream by dropping the source entirely.
  sourceToolPatterns?: Record<string, RegExp[]>
  sourceApiEndpoints?: Record<string, CompiledApiEndpoint[]>
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

async function buildRuntimeSources(
  agentMcpIds: string[] | undefined,
  connectionId?: string,
): Promise<{
  mcpServers?: McpServersConfig
  apiSources?: ApiSourcesConfig
  attached: { id: string; name: string }[]
  sourceToolPatterns?: Record<string, RegExp[]>
  sourceApiEndpoints?: Record<string, CompiledApiEndpoint[]>
  localNote?: string
}> {
  const attached: { id: string; name: string }[] = []
  const entries: [string, unknown][] = []
  const apiSources: ApiSourcesConfig = []
  // Per-source Explore scoping (ADR 0060 P4) + local-source note. Empty when no
  // source declared trust/permissions/local (no behaviour change).
  const gateAcc = emptyGateAccumulator()
  const localSources: LocalSource[] = []
  try {
    // Source of truth is the `sources` store (ADR 0060); `mcp`- and `api`-kind
    // sources become runtime tools. Whitelist keys are source ids (= old MCP id).
    const all = await listSources()
    const whitelist = agentMcpIds && agentMcpIds.length > 0 ? new Set(agentMcpIds) : null
    for (const s of all) {
      if (!s.enabled) continue
      // The task's connection bypasses the per-agent whitelist (ADR 0025) so
      // every node can reach the source; other sources still respect it.
      const isConnection = connectionId !== undefined && s.id === connectionId
      if (whitelist && !whitelist.has(s.id) && !isConnection) continue
      // Per-source P4 gate (ADR 0060): trust:'deny' drops the source entirely.
      // trust:'prompt' is a no-op in unattended tasks (no gate); allowedMcpPatterns
      // / allowedApiEndpoints still scope tool exposure + api calls.
      // eslint-disable-next-line no-await-in-loop
      const gate = await resolveSourceGate(s)
      if (gate.trust === 'deny') continue
      accumulateSourceGate(gateAcc, s.id, gate)
      // local source → surfaced to the node agent via a system-prompt note.
      if (s.type === 'local') {
        localSources.push(s)
        continue
      }
      // api sources (ADR 0060 P3): forwarded whole (no secret in config — the
      // credential lives in the keychain, read fresh per call by the api tool).
      // NOT added to `attached` (that drives the MCP-preference nudge, which is
      // mcp-only + provider-agnostic; the api tool's own description suffices).
      if (s.type === 'api') {
        apiSources.push(s)
        continue
      }
      if (s.type !== 'mcp') continue
      const transport = s.mcp.transport ?? 'http'
      let cfg: unknown
      if (transport === 'stdio') {
        if (!s.mcp.command) continue
        // eslint-disable-next-line no-await-in-loop
        const env = await expandSecrets(s.id, s.mcp.env)
        cfg = {
          type: 'stdio' as const,
          command: s.mcp.command,
          ...(s.mcp.args ? { args: s.mcp.args } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
          // Per-server handshake budget — `npx -y` cold starts can exceed the
          // bridge default; honour the user's configured timeout.
          timeoutMs: s.timeoutMs,
        }
      } else if (transport === 'http') {
        if (!s.mcp.url) continue
        // eslint-disable-next-line no-await-in-loop
        const expandedHeaders = await expandSecrets(s.id, s.mcp.headers)
        // Layer a fresh OAuth Bearer token (refreshed if near expiry) on top of
        // the static headers for oauth sources — ADR 0060 D-4. No-op for
        // bearer/none. Runs per node resolve, so a refreshed token takes effect.
        // eslint-disable-next-line no-await-in-loop
        const headers = await applyOAuthAuthorization(s, expandedHeaders)
        cfg = {
          type: 'http' as const,
          url: s.mcp.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
          timeoutMs: s.timeoutMs,
        }
      } else {
        continue
      }
      entries.push([s.id, cfg])
      attached.push({ id: s.id, name: s.name })
    }
  } catch (err) {
    log.warn('task: failed to list sources', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  const localNote = buildLocalSourcesNote(localSources)
  return {
    ...(entries.length > 0 ? { mcpServers: Object.fromEntries(entries) as McpServersConfig } : {}),
    ...(apiSources.length > 0 ? { apiSources } : {}),
    attached,
    ...gateToolFilterFields(gateAcc),
    ...(localNote ? { localNote } : {}),
  }
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

  const { mcpServers, apiSources, attached, sourceToolPatterns, sourceApiEndpoints, localNote } =
    await buildRuntimeSources(agent.mcpServerIds, connectionId)
  if (apiSources) ctx.apiSources = apiSources
  // Per-source Explore scoping (ADR 0060 P4) — tool exposure / api-call scoping.
  if (sourceToolPatterns) ctx.sourceToolPatterns = sourceToolPatterns
  if (sourceApiEndpoints) ctx.sourceApiEndpoints = sourceApiEndpoints
  if (mcpServers) {
    ctx.mcpServers = mcpServers
    // Nudge toward mcp__* tools when the agent whitelists servers OR the task
    // attached a connection (so it prefers the connection over a CLI).
    const hasWhitelist = !!agent.mcpServerIds && agent.mcpServerIds.length > 0
    if (attached.length > 0 && (hasWhitelist || connectionId)) {
      ctx.systemPromptAppend = mcpNudge(attached)
    }
  }
  // Local sources (ADR 0060 P4): append the filesystem-folder note after any mcp
  // nudge so the node agent knows where it may explore.
  if (localNote) {
    ctx.systemPromptAppend = ctx.systemPromptAppend
      ? `${ctx.systemPromptAppend}\n\n${localNote}`
      : localNote
  }

  return ctx
}
