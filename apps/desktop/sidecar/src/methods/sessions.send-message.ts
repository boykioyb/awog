import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runStream } from '../sessions/runner.js'
import { appendMessage } from '../sessions/store.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import type { SessionMessage, SessionSettings } from '../types/shared.js'

const SessionMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'agent', 'system']),
    text: z.string(),
    at: z.string(),
  })
  .passthrough()

const SessionSettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string(),
  level: z.enum(['standard', 'high', 'extra-high']),
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

  const result = await runStream(
    {
      sessionId: params.sessionId,
      pendingText: params.text,
      // Cast: zod .passthrough() yields a permissive shape; we only consume the
      // fields declared above (id/role/text/at) plus ignored extras. The runner
      // treats history as read-only SessionMessage[].
      history: params.history as unknown as SessionMessage[],
      settings: toSessionSettings(params.settings),
      ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
    },
    {
      onChunk: (delta) => {
        emit('session.chunk', {
          sessionId: params.sessionId,
          messageId: params.messageId,
          delta,
        })
      },
    },
  )

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
