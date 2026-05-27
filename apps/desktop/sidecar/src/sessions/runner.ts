// Streaming chat runner backed by @anthropic-ai/claude-agent-sdk.
//
// Replaces the hand-rolled SSE client (legacy providers/anthropic/client.ts +
// auth/refresh dance). Responsibility split:
//   - resolveAccount: pick the AccountRecord for {provider, accountId} from our
//     credentials store. Same shape as legacy so account.usage.ts keeps working.
//   - runStream:      build the SDK Query, stream text deltas via cb.onChunk,
//                     return aggregate (text, modelUsed, usage, stopReason).
//
// Auth bridging:
// The SDK reads CLAUDE_CODE_OAUTH_TOKEN from env when no credentials file is
// present. We refresh our OAuth tokens via the existing token-manager (so the
// refresh_token lives in ~/.awog/credentials.json and never touches the SDK's
// disk paths), then pass the bare access token through env. This keeps our
// paste-code OAuth UX (auth.completeOAuth) intact while delegating the actual
// API call + SSE handling to the SDK.

import { loadCredentials } from '../credentials/store.js'
import { ensureFreshAccessToken } from '../credentials/token-manager.js'
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
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'

// Thinking budget mapping → SDK thinking config.
// 'standard' = no extended thinking; 'high'/'extra-high' = explicit budget on
// models that support it. SDK Options.thinking supersedes the deprecated
// maxThinkingTokens for predictable behaviour across model versions.
const THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  standard: 0,
  high: 8_000,
  'extra-high': 16_000,
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

// Resolve an account record. Kept exported because account.usage.ts depends on
// the same lookup semantics (oauth-only for now, throw RpcError on mismatch).
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

// Render conversation history into a single Markdown-ish transcript so we can
// send it through `query({ prompt })` as a single string. The SDK supports
// streamed multi-turn input via AsyncIterable<SDKUserMessage>, but for our
// non-tool-use chat flow a single fenced transcript reproduces the same
// behaviour as Anthropic's `messages` array (M4 used).
function renderTranscript(history: SessionMessage[], pendingText: string): string {
  const turns: string[] = []
  for (const m of history) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    if (!text) continue
    const speaker = m.role === 'agent' ? 'Assistant' : 'User'
    turns.push(`${speaker}: ${text}`)
  }
  turns.push(`User: ${pendingText}`)
  return turns.join('\n\n')
}

function buildOptions(
  settings: SessionSettings,
  accessToken: string,
  systemPrompt: string | undefined,
): Options {
  // Replace subprocess env entirely (SDK does NOT merge). Inherit PATH/HOME
  // explicitly so child can find git/node, then inject the OAuth token.
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_OAUTH_TOKEN: accessToken,
    // Disable session persistence on disk under ~/.claude/; we own session
    // storage at ~/.awog/sessions/. Avoids the SDK writing JSONL transcripts.
    CLAUDE_CODE_ENTRYPOINT: 'awog-sidecar',
  }
  // Strip our OAuth refresh secret defensively (not strictly needed since we
  // never set it on process.env, but cheap belt-and-braces).
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN

  const opts: Options = {
    model: settings.modelId,
    env,
    persistSession: false,
    // Pure chat surface: no built-in Claude Code tools yet (no file edits,
    // no Bash). Tool wiring is a follow-up milestone.
    tools: [],
    // Streaming partial text events so we can forward chunks to the UI.
    includePartialMessages: true,
    // No CLI permission prompts; UI is in charge.
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  }

  if (systemPrompt) {
    // String form fully REPLACES the Claude Code preset prompt. Using `append`
    // (or extraArgs.append-system-prompt) leaves "You are Claude Code..." in
    // place and only appends ours — which is why AWOG identity didn't take.
    opts.systemPrompt = systemPrompt
  }

  if (
    settings.level !== 'standard' &&
    isAnthropicModel(settings.modelId) &&
    SUPPORTS_THINKING[settings.modelId as AnthropicModelId]
  ) {
    const budget = THINKING_BUDGETS[settings.level]
    if (budget > 0) {
      opts.thinking = { type: 'enabled', budgetTokens: budget }
    }
  }

  return opts
}

export interface RunNonStreamArgs {
  sessionId: string
  pendingText: string
  history: SessionMessage[]
  settings: SessionSettings
  systemPrompt?: string
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void
}

export interface RunStreamResult {
  text: string
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
}

interface AssistantTextBlock {
  type: 'text'
  text: string
}

function isTextBlock(block: unknown): block is AssistantTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  )
}

function mapSdkErrorToRpc(err: unknown): RpcError {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  if (lower.includes('unauthor') || lower.includes('401') || lower.includes('authentication')) {
    return new RpcError(-32020, 'AUTH_EXPIRED: re-authenticate via Settings')
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RpcError(
      -32022,
      'Rate limited by Anthropic. Subscription quota exhausted — try a cheaper model (Haiku) or wait a few minutes.',
    )
  }
  return new RpcError(-32021, `chat failed: ${message}`)
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

    const tokens = await ensureFreshAccessToken(args.settings.provider, account.id)
    const prompt = renderTranscript(args.history, args.pendingText)
    const options = buildOptions(args.settings, tokens.accessToken, args.systemPrompt)

    log.info('chat stream request', {
      sessionId: args.sessionId,
      model: args.settings.modelId,
      messages: args.history.length + 1,
      account: account.id,
    })

    let fullText = ''
    let modelUsed = ''
    let inputTokens = 0
    let outputTokens = 0
    let stopReason: string | null = null

    try {
      const q = query({ prompt, options })
      for await (const evt of q as AsyncIterable<SDKMessage>) {
        if (evt.type === 'stream_event') {
          // Partial assistant message — drill into the underlying
          // BetaRawMessageStreamEvent for text deltas. The SDK forwards the
          // raw provider SSE events here when includePartialMessages = true.
          const inner = evt.event as { type?: string; delta?: { type?: string; text?: string } }
          if (
            inner.type === 'content_block_delta' &&
            inner.delta?.type === 'text_delta' &&
            typeof inner.delta.text === 'string' &&
            inner.delta.text.length > 0
          ) {
            fullText += inner.delta.text
            cb.onChunk(inner.delta.text)
          }
          continue
        }
        if (evt.type === 'assistant') {
          // Aggregate snapshot of an assistant turn. We trust the deltas we
          // already streamed; only use this to capture model + usage when the
          // result message is not emitted (defensive fallback).
          const msg = evt.message as {
            model?: string
            usage?: { input_tokens?: number; output_tokens?: number }
            content?: unknown[]
          }
          if (msg.model) modelUsed = msg.model
          if (msg.usage?.input_tokens) inputTokens = msg.usage.input_tokens
          if (msg.usage?.output_tokens) outputTokens = msg.usage.output_tokens
          // If we somehow received no stream_event deltas (e.g. SDK omitted
          // partials for this run), reconstruct text from the snapshot.
          if (!fullText && Array.isArray(msg.content)) {
            const text = msg.content.filter(isTextBlock).map((b) => b.text).join('')
            if (text) fullText = text
          }
          continue
        }
        if (evt.type === 'result') {
          if (evt.subtype === 'success') {
            stopReason = evt.stop_reason ?? 'end_turn'
            inputTokens = evt.usage?.input_tokens ?? inputTokens
            outputTokens = evt.usage?.output_tokens ?? outputTokens
            // SDK exposes a `result` string containing the assistant's final
            // text — use it as authoritative when present.
            if (typeof evt.result === 'string' && evt.result.length > 0) {
              if (!fullText) fullText = evt.result
            }
          } else {
            const errMessages = Array.isArray(evt.errors) ? evt.errors.join('; ') : ''
            throw mapSdkErrorToRpc(new Error(`SDK ${evt.subtype}: ${errMessages || 'unknown'}`))
          }
          continue
        }
        // Other event types (system, status, hook, task etc.) are ignored.
      }

      log.info('chat stream done', {
        sessionId: args.sessionId,
        model: modelUsed,
        inputTokens,
        outputTokens,
        stopReason,
      })

      return {
        text: fullText,
        modelUsed: modelUsed || args.settings.modelId,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        stopReason,
      }
    } catch (err) {
      if (err instanceof RpcError) throw err
      throw mapSdkErrorToRpc(err)
    }
  })
}
