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
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
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
  // on-disk path and passes it as Options.cwd so the SDK's Read/Bash/Edit
  // tools operate against the user's repo instead of process.cwd().
  projectId: z.string().optional(),
  // Session-scoped tool denylist (SDK tool names). Forwarded to
  // Options.disallowedTools so the model never even sees the tool exists.
  disabledTools: z.array(z.string()).optional(),
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
  // cwd (SDK falls back to process.cwd()). Don't error the chat for a stale
  // projectId.
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
  // turn so the SDK promise chain unwinds cleanly. The runner's `abortController`
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
        ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
        ...(cwd ? { cwd } : {}),
        ...(params.disabledTools && params.disabledTools.length
          ? { disabledTools: params.disabledTools }
          : {}),
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
    // Defensive: if anything left a parked permission (e.g. SDK error without
    // calling canUseTool back), reject so the Map doesn't leak.
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
