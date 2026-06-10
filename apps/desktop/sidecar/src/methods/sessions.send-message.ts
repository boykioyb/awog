import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runStream, registerAborter, unregisterAborter } from '../sessions/runner.js'
import { appendMessage } from '../sessions/store.js'
import { loadProject } from '../projects/store.js'
import {
  parkPermissionRequest,
  rejectPermissionRequest,
} from '../sessions/permissions.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { listServers as listMcpServers } from '../mcp/store.js'
import { loadAgent } from '../agents/store.js'
import { expandSecrets } from '../mcp/secrets.js'
import type { CanUseTool, McpServersConfig } from '../runtime/permission-types.js'
import type { SessionMessage, SessionSettings } from '../types/shared.js'

const SessionMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'agent', 'system']),
    text: z.string(),
    at: z.string(),
  })
  .passthrough()

// Pre-process: legacy sessions saved 'standard' before we adopted Claude
// Code's effort vocabulary. Map it to 'low' so old JSONL still parses.
const ThinkingLevelSchema = z.preprocess(
  (v) => (v === 'standard' ? 'low' : v),
  z.enum(['low', 'medium', 'high', 'extra-high', 'max']),
)

const SessionSettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string(),
  level: ThinkingLevelSchema,
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']),
  accountId: z.string().optional(),
})

const Params = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string().min(1),
  history: z.array(SessionMessageSchema).default([]),
  settings: SessionSettingsSchema,
  systemPrompt: z.string().optional(),
  // Optional project linkage. When present, sidecar resolves the project's
  // on-disk path and passes it as the runtime tools' fs root so Read/Bash/Edit
  // operate against the user's repo instead of process.cwd().
  projectId: z.string().optional(),
  // Session-scoped tool denylist (Claude Code tool names). Removes these tools
  // from the runtime tool set so the model never even sees them.
  disabledTools: z.array(z.string()).optional(),
  // Session-scoped MCP server whitelist. `undefined` = legacy behaviour: use
  // all globally-enabled servers. `[]` = explicitly none. `[ids]` = only these
  // (intersected with the globally-enabled set).
  mcpServerIds: z.array(z.string()).optional(),
  // Active agent for this turn. Identifies the AGENT.md by (id, source,
  // projectId?) tuple because the same slug can exist in multiple tiers.
  // When present + resolves to an agent with non-empty systemPrompt, that
  // prompt replaces `params.systemPrompt` for this turn. ADR 0015.
  agent: z
    .object({
      id: z.string().min(1).max(64),
      source: z.enum([
        'global',
        'user-claude',
        'user-agents',
        'project-claude',
        'project-agents',
      ]),
      projectId: z.string().min(1).max(64).optional(),
    })
    .optional(),
})

// exactOptionalPropertyTypes: zod's .optional() yields `T | undefined`, but
// SessionSettings.accountId is presence-only (`accountId?: string`). Rebuild
// with explicit spread so optional fields are only added when defined.
function toSessionSettings(parsed: z.infer<typeof SessionSettingsSchema>): SessionSettings {
  const base: SessionSettings = {
    provider: parsed.provider,
    modelId: parsed.modelId,
    level: parsed.level,
    mode: parsed.mode,
  }
  if (parsed.accountId !== undefined) base.accountId = parsed.accountId
  return base
}

register('sessions.sendMessage', async (raw) => {
  const params = Params.parse(raw)

  // One AbortController per turn. sessions.cancel resolves it by messageId.
  const abortController = new AbortController()
  registerAborter(params.messageId, abortController)

  // Resolve cwd from project, if linked. Best-effort: missing project → no
  // cwd (the runtime falls back to process.cwd()). Don't error the chat for a
  // stale projectId.
  let cwd: string | undefined
  if (params.projectId) {
    try {
      const project = await loadProject(params.projectId)
      if (project?.path) cwd = project.path
    } catch (err) {
      log.warn('failed to resolve project cwd', {
        projectId: params.projectId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Resolve the active agent (if any). When found:
  //   - `agent.systemPrompt` REPLACES `params.systemPrompt` (ADR 0015)
  //   - `agent.tools` (Claude Code subagent whitelist) → runtime allowedTools
  //   - `agent.mcpServerIds` → per-agent MCP whitelist
  // Missing / unparseable agent → fall back to the caller's prompt + full toolset.
  let resolvedSystemPrompt = params.systemPrompt
  let resolvedAllowedTools: string[] | undefined
  let resolvedAgentMcpIds: string[] | undefined
  if (params.agent) {
    try {
      const agent = await loadAgent(
        params.agent.id,
        params.agent.source,
        params.agent.projectId,
      )
      if (agent?.systemPrompt) resolvedSystemPrompt = agent.systemPrompt
      if (agent?.tools && agent.tools.length > 0) resolvedAllowedTools = agent.tools
      if (agent?.mcpServerIds && agent.mcpServerIds.length > 0) {
        resolvedAgentMcpIds = agent.mcpServerIds
      }
    } catch (err) {
      log.warn('failed to load agent for runtime injection', {
        agent: params.agent,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Build the resolved MCP server map for the runtime. ADR 0029 §4: the runtime
  // bridges these to in-process Pi tools. We only forward enabled stdio/http
  // servers — disabled entries shouldn't surface tools to the model.
  // Per-session whitelist (params.mcpServerIds) further narrows the set:
  //   undefined → all enabled (legacy)
  //   []        → none
  //   [ids]     → only those (∩ enabled)
  let mcpServersForRuntime: McpServersConfig | undefined
  // Track which servers actually made it through so we can build a matching
  // system-prompt nudge (only when user explicitly whitelisted).
  const attachedMcpServers: { id: string; name: string }[] = []
  try {
    const all = await listMcpServers()
    // Two whitelist layers (ADR 0016): session-level (params.mcpServerIds) and
    // agent-level (resolvedAgentMcpIds). Intersect both when present so the
    // narrower scope wins. undefined = "no restriction at this layer".
    const sessionWhitelist =
      params.mcpServerIds !== undefined ? new Set(params.mcpServerIds) : null
    const agentWhitelist = resolvedAgentMcpIds ? new Set(resolvedAgentMcpIds) : null
    const entries: [string, McpServersConfig[string]][] = []
    for (const s of all) {
      if (!s.enabled) continue
      if (sessionWhitelist && !sessionWhitelist.has(s.id)) continue
      if (agentWhitelist && !agentWhitelist.has(s.id)) continue
      let cfg: McpServersConfig[string]
      if (s.transport === 'stdio') {
        if (!s.command) continue
        // Expand `secret:KEY` placeholders in env against OS keychain — ADR 0018.
        // The runtime passes plaintext env to the in-process MCP child. The
        // expansion happens fresh per turn so a re-saved keychain value
        // takes effect on the next message.
        // eslint-disable-next-line no-await-in-loop
        const expandedEnv = await expandSecrets(s.id, s.env)
        cfg = {
          type: 'stdio',
          command: s.command,
          ...(s.args ? { args: s.args } : {}),
          ...(Object.keys(expandedEnv).length > 0 ? { env: expandedEnv } : {}),
        }
      } else if (s.transport === 'http') {
        if (!s.url) continue
        // eslint-disable-next-line no-await-in-loop
        const expandedHeaders = await expandSecrets(s.id, s.headers)
        cfg = {
          type: 'http',
          url: s.url,
          ...(Object.keys(expandedHeaders).length > 0 ? { headers: expandedHeaders } : {}),
        }
      } else {
        // sse not supported pha 2
        continue
      }
      entries.push([s.id, cfg])
      attachedMcpServers.push({ id: s.id, name: s.name })
    }
    if (entries.length > 0) {
      mcpServersForRuntime = Object.fromEntries(entries)
    }
  } catch (err) {
    log.warn('failed to list mcp servers for session', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // System-prompt nudge — only when user EXPLICITLY attached MCP servers
  // (params.mcpServerIds set OR agent has mcpServerIds) AND at least one
  // server is reachable. Without this, Claude often falls back to CLI tools
  // (`gh`, `gcloud`, `kubectl`) because they're heavily represented in
  // training data. Forwarded to subagents so Task-spawned children honour it.
  let systemPromptAppend: string | undefined
  const hasExplicitWhitelist =
    params.mcpServerIds !== undefined || resolvedAgentMcpIds !== undefined
  if (hasExplicitWhitelist && attachedMcpServers.length > 0) {
    const lines = attachedMcpServers.map((s) => `- mcp__${s.id}__* (${s.name})`).join('\n')
    systemPromptAppend = `<mcp-preference>
The user explicitly attached the following MCP servers to this session:
${lines}

When you need to interact with these services, **prefer the corresponding \`mcp__<serverId>__<toolName>\` tools** over CLI equivalents (\`gh\`, \`gcloud\`, \`kubectl\`, \`aws\`, raw HTTP) or shell scripting. The MCP tools were explicitly enabled for this purpose.

When delegating work via the Task tool, instruct the subagent in the prompt to use these MCP tools rather than CLI alternatives — subagents do not inherit MCP servers automatically, but they can be steered through your instruction.
</mcp-preference>`
  }

  // Track which permission requestIds belong to this turn so we can reject
  // them on abort/cancel (rather than leaking parked promises forever).
  const turnRequestIds = new Set<string>()

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    const requestId = `pr_${randomBytes(8).toString('hex')}`
    turnRequestIds.add(requestId)

    const payload: Record<string, unknown> = {
      sessionId: params.sessionId,
      messageId: params.messageId,
      requestId,
      toolName,
      input,
      toolUseID: opts.toolUseID,
    }
    if (opts.title) payload.promptSentence = opts.title
    if (opts.displayName) payload.displayName = opts.displayName
    if (opts.description) payload.description = opts.description
    if (opts.decisionReason) payload.decisionReason = opts.decisionReason
    if (opts.blockedPath) payload.blockedPath = opts.blockedPath
    if (opts.suggestions && opts.suggestions.length > 0) {
      payload.suggestions = opts.suggestions
    }

    // Hand back a promise that resolves when sessions.permission lands the
    // user's choice. parkPermissionRequest owns the Map of in-flight prompts.
    const pending = parkPermissionRequest(requestId, opts.suggestions ?? [])
    emit('session.permission-request', payload)

    try {
      return await pending
    } finally {
      turnRequestIds.delete(requestId)
    }
  }

  // If the user aborts mid-prompt, reject every parked permission for this
  // turn so the promise chain unwinds cleanly. The runner's `abortController`
  // already short-circuits the model loop; this cleans up the parked promises
  // we own here.
  const onAbort = () => {
    for (const id of turnRequestIds) {
      rejectPermissionRequest(id, 'User canceled the request')
    }
    turnRequestIds.clear()
  }
  abortController.signal.addEventListener('abort', onAbort)

  let result
  try {
    result = await runStream(
      {
        sessionId: params.sessionId,
        pendingText: params.text,
        // Cast: zod .passthrough() yields a permissive shape; we only consume the
        // fields declared above (id/role/text/at) plus ignored extras. The runner
        // treats history as read-only SessionMessage[].
        history: params.history as unknown as SessionMessage[],
        settings: toSessionSettings(params.settings),
        ...(resolvedSystemPrompt ? { systemPrompt: resolvedSystemPrompt } : {}),
        ...(cwd ? { cwd } : {}),
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.disabledTools && params.disabledTools.length
          ? { disabledTools: params.disabledTools }
          : {}),
        ...(mcpServersForRuntime ? { mcpServers: mcpServersForRuntime } : {}),
        ...(systemPromptAppend ? { systemPromptAppend } : {}),
        ...(resolvedAllowedTools ? { allowedTools: resolvedAllowedTools } : {}),
        canUseTool,
        abortController,
      },
      {
        onChunk: (delta) => {
          emit('session.chunk', {
            sessionId: params.sessionId,
            messageId: params.messageId,
            delta,
          })
        },
        onStep: (step) => {
          emit('session.step', {
            sessionId: params.sessionId,
            messageId: params.messageId,
            step,
          })
        },
      },
    )
  } finally {
    abortController.signal.removeEventListener('abort', onAbort)
    // Defensive: if anything left a parked permission (e.g. a runtime error
    // without calling canUseTool back), reject so the Map doesn't leak.
    onAbort()
    unregisterAborter(params.messageId)
  }

  // Persist both turns to JSONL. Best-effort: failures must not bubble back
  // to the UI because the chat itself already succeeded. Race scenario where
  // the session was not yet upserted is handled inside appendMessage (it
  // re-folds the file and skips silently). See sessions/store.ts.
  const now = new Date().toISOString()
  const userMessage: SessionMessage = {
    id: `msg_u_${randomBytes(8).toString('hex')}`,
    role: 'user',
    text: params.text,
    at: now,
  }
  const agentMessage: SessionMessage = {
    id: params.messageId,
    role: 'agent',
    text: result.text,
    at: new Date().toISOString(),
    completedAt: Date.now(),
    modelUsed: result.modelUsed,
    usage: {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    },
  }
  try {
    await appendMessage(params.sessionId, userMessage)
    await appendMessage(params.sessionId, agentMessage)
  } catch (err) {
    log.warn('failed to persist messages', {
      sessionId: params.sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // Terminal event so UI can clear "loading" state purely from the stream,
  // independent of RPC promise resolution timing.
  emit('session.message.done', {
    sessionId: params.sessionId,
    messageId: params.messageId,
    text: result.text,
    modelUsed: result.modelUsed,
    usage: result.usage,
    stopReason: result.stopReason,
  })

  return {
    messageId: params.messageId,
    text: result.text,
    modelUsed: result.modelUsed,
    usage: result.usage,
    stopReason: result.stopReason,
  }
})
