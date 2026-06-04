// Pure HTTP client for Anthropic /v1/messages. Knows nothing about account
// resolution, credentials, or RPC — that lives in sessions/runner.ts.

import { ANTHROPIC_API_HEADERS, REQUIRED_HEADERS } from '../../auth/anthropic-oauth.js'

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com'

export function buildHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_API_HEADERS.ANTHROPIC_VERSION,
    'anthropic-beta': ANTHROPIC_API_HEADERS.ANTHROPIC_BETA_OAUTH,
    ...REQUIRED_HEADERS,
  }
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string // text-only for M4
}

export interface AnthropicThinkingConfig {
  type: 'enabled'
  budget_tokens: number
}

export interface AnthropicMessagesRequest {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string
  thinking?: AnthropicThinkingConfig
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: string }

export interface AnthropicMessagesResponse {
  id: string
  model: string
  role: 'assistant'
  content: AnthropicContentBlock[]
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
}

export class MessagesHttpError extends Error {
  public readonly status: number

  public readonly body: string

  constructor(status: number, body: string) {
    super(`messages api ${status}: ${body.slice(0, 200)}`)
    this.name = 'MessagesHttpError'
    this.status = status
    this.body = body
  }
}

export async function callMessages(
  accessToken: string,
  req: AnthropicMessagesRequest,
): Promise<AnthropicMessagesResponse> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: buildHeaders(accessToken),
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new MessagesHttpError(res.status, text)
  }
  return (await res.json()) as AnthropicMessagesResponse
}

// ─── Streaming ─────────────────────────────────────────────────────────────
// SSE wire format: events delimited by blank line (\n\n). Each event has
// optional `event:` line + `data:` line (JSON). See M5 spec.

export interface ChatStreamChunk {
  type: 'text_delta'
  text: string
}

export interface ChatStreamEnd {
  type: 'done'
  modelUsed: string
  usage: { input_tokens: number; output_tokens: number }
  stopReason: string | null
}

export type ChatStreamEvent = ChatStreamChunk | ChatStreamEnd

// SSE payload shape is external/untrusted (L1). We narrow at use sites; using
// `any` here at the JSON.parse boundary is the documented exception in
// .claude/rules/typescript.md (external SSE wire format).
interface SseMessageStart {
  type: 'message_start'
  message?: { model?: string; usage?: { input_tokens?: number } }
}
interface SseContentBlockDelta {
  type: 'content_block_delta'
  delta?: { type?: string; text?: string }
}
interface SseMessageDelta {
  type: 'message_delta'
  delta?: { stop_reason?: string | null }
  usage?: { output_tokens?: number }
}
interface SseError {
  type: 'error'
  error?: { message?: string; type?: string }
}
type SseEvent =
  | SseMessageStart
  | SseContentBlockDelta
  | SseMessageDelta
  | SseError
  | { type: string }

export async function* callMessagesStream(
  accessToken: string,
  req: AnthropicMessagesRequest,
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
    method: 'POST',
    headers: { ...buildHeaders(accessToken), Accept: 'text/event-stream' },
    body: JSON.stringify({ ...req, stream: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new MessagesHttpError(res.status, text)
  }
  if (!res.body) throw new MessagesHttpError(0, 'streaming body missing')

  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let buf = ''
  let modelUsed = ''
  let inputTokens = 0
  let outputTokens = 0
  let stopReason: string | null = null

  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let idx = buf.indexOf('\n\n')
      while (idx >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
        if (dataLine) {
          const payload = dataLine.slice('data:'.length).trim()
          if (payload) {
            let evt: SseEvent | null = null
            try {
              evt = JSON.parse(payload) as SseEvent
            } catch {
              evt = null
            }
            if (evt) {
              switch (evt.type) {
                case 'message_start': {
                  const msg = (evt as SseMessageStart).message
                  modelUsed = msg?.model ?? ''
                  inputTokens = msg?.usage?.input_tokens ?? 0
                  break
                }
                case 'content_block_delta': {
                  const delta = (evt as SseContentBlockDelta).delta
                  if (
                    delta?.type === 'text_delta'
                    && typeof delta.text === 'string'
                    && delta.text.length > 0
                  ) {
                    yield { type: 'text_delta', text: delta.text }
                  }
                  // thinking_delta intentionally ignored in M5 (surfaced separately in M7).
                  break
                }
                case 'message_delta': {
                  const md = evt as SseMessageDelta
                  if (typeof md.delta?.stop_reason === 'string') stopReason = md.delta.stop_reason
                  if (typeof md.usage?.output_tokens === 'number') {
                    outputTokens = md.usage.output_tokens
                  }
                  break
                }
                case 'error': {
                  const err = (evt as SseError).error
                  throw new MessagesHttpError(
                    500,
                    JSON.stringify(err ?? { message: 'stream error' }),
                  )
                }
                default:
                  break
              }
            }
          }
        }
        idx = buf.indexOf('\n\n')
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  yield {
    type: 'done',
    modelUsed,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    stopReason,
  }
}
