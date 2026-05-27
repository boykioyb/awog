// Orchestrates a single non-streaming chat turn:
//   resolve account -> ensure fresh access token -> build messages -> call API
//   -> extract text. Per-session promise chain serialises concurrent sends
//   targeting the same sessionId so message ordering is preserved.

import { loadCredentials } from '../credentials/store.js'
import { ensureFreshAccessToken, forceRefresh } from '../credentials/token-manager.js'
import {
  callMessages,
  callMessagesStream,
  MessagesHttpError,
  type AnthropicMessage,
  type AnthropicMessagesRequest,
} from '../providers/anthropic/client.js'
import {
  isAnthropicModel,
  SUPPORTS_THINKING,
  type AnthropicModelId,
} from '../providers/anthropic/models-map.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import type {
  AccountRecord,
  ProviderName,
  SessionMessage,
  SessionSettings,
  ThinkingLevel,
} from '../types/shared.js'

const MAX_TOKENS_DEFAULT = 4096

// Conservative budgets — Anthropic requires max_tokens >= budget + buffer.
// 'standard' = 0 means thinking is not enabled at all (preserve legacy behaviour).
const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  standard: 0,
  high: 8_000,
  'extra-high': 16_000,
}

// Mutate req in place to enable thinking when the model supports it and the
// caller asked for a non-standard level. Also bumps max_tokens so Anthropic
// has headroom for both thinking and output tokens.
function applyThinking(req: AnthropicMessagesRequest, settings: SessionSettings): void {
  if (settings.level === 'standard') return
  if (!isAnthropicModel(settings.modelId)) return
  if (!SUPPORTS_THINKING[settings.modelId as AnthropicModelId]) return
  const budget = THINKING_BUDGETS[settings.level]
  if (budget <= 0) return
  req.thinking = { type: 'enabled', budget_tokens: budget }
  if (req.max_tokens < budget + 1024) {
    req.max_tokens = budget + 1024
  }
}

const PER_SESSION_LOCKS = new Map<string, Promise<unknown>>()

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = PER_SESSION_LOCKS.get(sessionId) ?? Promise.resolve()
  const next = prev.then(fn, fn) as Promise<T>
  PER_SESSION_LOCKS.set(sessionId, next)
  try {
    return await next
  } finally {
    if (PER_SESSION_LOCKS.get(sessionId) === next) PER_SESSION_LOCKS.delete(sessionId)
  }
}

export async function resolveAccount(
  provider: ProviderName,
  accountId: string | undefined,
): Promise<AccountRecord> {
  if (provider !== 'anthropic') {
    throw new RpcError(-32011, `provider not supported yet: ${provider}`)
  }
  const data = await loadCredentials()
  const bucket = data.providers.anthropic
  const id = accountId ?? bucket.activeAccountId
  if (!id) throw new RpcError(-32012, 'NO_ACTIVE_ACCOUNT')
  const acc = bucket.accounts.find((a) => a.id === id)
  if (!acc) throw new RpcError(-32013, `account not found: ${id}`)
  if (acc.authMode !== 'oauth' || !acc.oauth) {
    throw new RpcError(-32014, 'account has no oauth credentials')
  }
  return acc
}

// Map session messages to Anthropic format. Skip system role (lives in
// settings.system). 'agent' role maps to 'assistant'. Drop whitespace-only.
export function buildAnthropicMessages(
  history: SessionMessage[],
  pending: string,
): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  for (const m of history) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    if (!text) continue
    out.push({ role: m.role === 'agent' ? 'assistant' : 'user', content: text })
  }
  out.push({ role: 'user', content: pending })
  return out
}

export interface RunNonStreamArgs {
  sessionId: string
  pendingText: string
  history: SessionMessage[]
  settings: SessionSettings
  systemPrompt?: string
}

export interface RunNonStreamResult {
  text: string
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
}

export async function runNonStream(args: RunNonStreamArgs): Promise<RunNonStreamResult> {
  return withSessionLock(args.sessionId, async () => {
    const account = await resolveAccount(args.settings.provider, args.settings.accountId)

    if (!isAnthropicModel(args.settings.modelId)) {
      throw new RpcError(-32015, `unknown anthropic model: ${args.settings.modelId}`)
    }

    const tokens = await ensureFreshAccessToken(args.settings.provider, account.id)
    const messages = buildAnthropicMessages(args.history, args.pendingText)

    const req: AnthropicMessagesRequest = {
      model: args.settings.modelId,
      max_tokens: MAX_TOKENS_DEFAULT,
      messages,
    }
    if (args.systemPrompt) req.system = args.systemPrompt
    applyThinking(req, args.settings)

    log.info('chat request', {
      sessionId: args.sessionId,
      model: req.model,
      messages: messages.length,
      account: account.id,
    })

    try {
      const response = await callMessages(tokens.accessToken, req)

      // Concatenate text blocks; ignore thinking blocks for M4.
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('')

      log.info('chat response', {
        sessionId: args.sessionId,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      })

      return {
        text,
        modelUsed: response.model,
        usage: response.usage,
      }
    } catch (err) {
      if (err instanceof MessagesHttpError) {
        if (err.status === 401) {
          // M5 will add refresh+retry; M4 surfaces auth error directly.
          throw new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
        }
        if (err.status === 429) {
          throw new RpcError(
            -32022,
            'Rate limited by Anthropic. Subscription quota exhausted — try a cheaper model (Haiku) or wait a few minutes.',
          )
        }
        if (err.status >= 500) {
          throw new RpcError(-32023, `Anthropic upstream error (${err.status}). Try again shortly.`)
        }
      }
      if (err instanceof RpcError) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new RpcError(-32021, `chat failed: ${message}`)
    }
  })
}

// ─── Streaming variant (M5) ────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk: (delta: string) => void
}

export interface RunStreamResult {
  text: string
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
}

export async function runStream(
  args: RunNonStreamArgs,
  cb: StreamCallbacks,
): Promise<RunStreamResult> {
  return withSessionLock(args.sessionId, async () => {
    const account = await resolveAccount(args.settings.provider, args.settings.accountId)

    if (!isAnthropicModel(args.settings.modelId)) {
      throw new RpcError(-32015, `unknown anthropic model: ${args.settings.modelId}`)
    }

    const messages = buildAnthropicMessages(args.history, args.pendingText)
    const req: AnthropicMessagesRequest = {
      model: args.settings.modelId,
      max_tokens: MAX_TOKENS_DEFAULT,
      messages,
    }
    if (args.systemPrompt) req.system = args.systemPrompt
    applyThinking(req, args.settings)

    log.info('chat stream request', {
      sessionId: args.sessionId,
      model: req.model,
      messages: messages.length,
      account: account.id,
    })

    // Up to 2 attempts: attempt 1 uses cached (or just-refreshed-by-expiry) token,
    // attempt 2 force-refreshes after a 401 (token may have been revoked server-side
    // before its local expiresAt).
    let attempt = 0
    while (true) {
      attempt += 1
      // eslint-disable-next-line no-await-in-loop
      const tokens = attempt === 1
        ? await ensureFreshAccessToken(args.settings.provider, account.id)
        : await forceRefresh(args.settings.provider, account.id)

      try {
        let fullText = ''
        let modelUsed = ''
        let usage = { input_tokens: 0, output_tokens: 0 }
        let stopReason: string | null = null

        // eslint-disable-next-line no-await-in-loop
        for await (const evt of callMessagesStream(tokens.accessToken, req)) {
          if (evt.type === 'text_delta') {
            fullText += evt.text
            cb.onChunk(evt.text)
          } else if (evt.type === 'done') {
            modelUsed = evt.modelUsed
            usage = evt.usage
            stopReason = evt.stopReason
          }
        }

        log.info('chat stream done', {
          sessionId: args.sessionId,
          model: modelUsed,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          stopReason,
        })

        return {
          text: fullText, modelUsed, usage, stopReason,
        }
      } catch (err) {
        if (err instanceof MessagesHttpError) {
          if (err.status === 401 && attempt === 1) {
            log.warn('chat stream got 401, force-refreshing token and retrying', {
              account: account.id,
            })
            continue
          }
          if (err.status === 401) {
            throw new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
          }
          if (err.status === 429) {
            throw new RpcError(
              -32022,
              'Rate limited by Anthropic. Subscription quota exhausted — try a cheaper model (Haiku) or wait a few minutes.',
            )
          }
          if (err.status >= 500) {
            throw new RpcError(
              -32023,
              `Anthropic upstream error (${err.status}). Try again shortly.`,
            )
          }
        }
        if (err instanceof RpcError) throw err
        const message = err instanceof Error ? err.message : String(err)
        throw new RpcError(-32021, `chat failed: ${message}`)
      }
    }
  })
}
