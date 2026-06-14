// Build a Pi `AgentContext` from AWOG's JSONL session history (ADR 0029 item 5).
//
// Resume = rebuild Context from history every turn (AWOG JSONL is the source of
// truth; there is no opaque SDK session id). We map AWOG SessionMessage roles to
// Pi message roles:
//   user   → UserMessage (text; image attachments rebuilt into image blocks)
//   agent  → AssistantMessage (text-only; we don't persist tool blocks in JSONL)
//   system → skipped (system instructions live in context.systemPrompt)
//
// The pending user turn is appended last. The new prompt is returned separately
// (runAgentLoop takes `prompts` as its first arg and appends them itself), so
// `buildContext` returns BOTH the prior-history context and the prompt message.

import type {
  AgentContext,
  AgentMessage,
  AgentTool,
} from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  UserMessage,
} from '@earendil-works/pi-ai'
import type { SessionAttachment, SessionMessage } from '../types/shared.js'
import { log } from '../util/logger.js'

// Minimal AssistantMessage stub for replayed history. Pi's convertToLlm passes
// AgentMessage through as Message; the Anthropic provider only reads role +
// content for prior assistant turns, but the type requires the metadata fields,
// so we fill them with inert defaults. usage/cost are zeroed (historical).
function historyAssistant(text: string, timestamp: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: '',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  }
}

// Skip an image whose base64 payload exceeds this many chars (~9MB raw). A
// single oversized image would otherwise blow the provider request limit and
// fail the whole turn — we drop it (with a warning) so the text still goes out.
const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024

// Turn a user attachment into a Pi image content block. Only `image`-type
// attachments with an inline base64 `data:` URL qualify (that is exactly what
// the composer produces via FileReader.readAsDataURL). Anything else — non-image
// files, missing/foreign URLs, oversized payloads — returns null and is skipped.
function toImageContent(att: SessionAttachment): ImageContent | null {
  if (att.type !== 'image' || !att.url) return null
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(att.url)
  if (!match) return null
  const [, mimeType, data] = match
  if (!mimeType || !data) return null
  if (data.length > MAX_IMAGE_BASE64_LENGTH) {
    log.warn('context-builder: skipping oversized image attachment', {
      name: att.name,
      base64Length: data.length,
    })
    return null
  }
  return { type: 'image', data, mimeType }
}

// Build a Pi UserMessage. Text-only turns keep the plain-string content shape;
// when usable image attachments are present we switch to the block array
// (text block first, then images) so the model actually receives them.
function historyUser(
  text: string,
  attachments: SessionAttachment[] | undefined,
  timestamp: number,
): UserMessage {
  const images = (attachments ?? [])
    .map(toImageContent)
    .filter((c): c is ImageContent => c !== null)
  if (images.length === 0) return { role: 'user', content: text, timestamp }
  const content: (TextContent | ImageContent)[] = []
  if (text) content.push({ type: 'text', text })
  content.push(...images)
  return { role: 'user', content, timestamp }
}

// True when a built user message carries nothing the model can use — empty text
// and no image blocks. `content.length` reads as string length or block count.
// Such turns are dropped from the rebuilt history.
function isEmptyUserMessage(msg: UserMessage): boolean {
  return msg.content.length === 0
}

function parseTimestamp(at: string): number {
  const t = Date.parse(at)
  return Number.isNaN(t) ? Date.now() : t
}

export interface BuiltContext {
  // Prior-history context (systemPrompt + replayed messages + tools). Does NOT
  // include the pending user turn — that is returned as `prompt` and passed to
  // runAgentLoop's first argument so the loop emits its events for it.
  context: AgentContext
  // The pending user message to drive this turn.
  prompt: AgentMessage
}

// Resolve the effective system prompt:
//   - custom systemPrompt present  → it REPLACES the preset; if an append nudge
//     also exists, concatenate the nudge after it.
//   - only an append nudge present → that nudge IS the systemPrompt (under
//     OAuth, Pi auto-prepends the "You are Claude Code…" block before whatever
//     we pass, so the preset is preserved automatically — we MUST NOT add our
//     own identity block per ADR 0029).
//   - neither → empty string (Pi still prepends the CC block under OAuth).
function resolveSystemPrompt(
  systemPrompt: string | undefined,
  systemPromptAppend: string | undefined,
): string {
  if (systemPrompt) {
    return systemPromptAppend ? `${systemPrompt}\n\n${systemPromptAppend}` : systemPrompt
  }
  return systemPromptAppend ?? ''
}

export function buildContext(
  history: SessionMessage[],
  pendingText: string,
  systemPrompt: string | undefined,
  systemPromptAppend: string | undefined,
  tools: AgentTool[],
  // Attachments on the pending user turn. Image attachments are rebuilt into Pi
  // image content blocks; non-image / oversized ones are silently dropped.
  pendingAttachments?: SessionAttachment[],
): BuiltContext {
  const messages: AgentMessage[] = []
  for (const m of history) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    const ts = parseTimestamp(m.at)
    if (m.role === 'agent') {
      // Assistant turns are text-only in JSONL (no tool blocks persisted).
      if (!text) continue
      messages.push(historyAssistant(text, ts))
      continue
    }
    // User turns: rebuild image blocks from persisted attachments so resume
    // re-feeds the same images to the model. Drop turns with neither text nor
    // a usable image.
    const userMsg = historyUser(text, m.attachments, ts)
    if (isEmptyUserMessage(userMsg)) continue
    messages.push(userMsg)
  }

  const context: AgentContext = {
    systemPrompt: resolveSystemPrompt(systemPrompt, systemPromptAppend),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  }

  const prompt: AgentMessage = historyUser(pendingText, pendingAttachments, Date.now())
  return { context, prompt }
}
