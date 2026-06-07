// Build a Pi `AgentContext` from AWOG's JSONL session history (ADR 0029 item 5).
//
// Resume = rebuild Context from history every turn (AWOG JSONL is the source of
// truth; there is no opaque SDK session id). We map AWOG SessionMessage roles to
// Pi message roles:
//   user   → UserMessage
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
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import type { SessionMessage } from '../types/shared.js'

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

function historyUser(text: string, timestamp: number): UserMessage {
  return { role: 'user', content: text, timestamp }
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
): BuiltContext {
  const messages: AgentMessage[] = []
  for (const m of history) {
    if (m.role === 'system') continue
    const text = (m.text ?? '').trim()
    if (!text) continue
    const ts = parseTimestamp(m.at)
    messages.push(m.role === 'agent' ? historyAssistant(text, ts) : historyUser(text, ts))
  }

  const context: AgentContext = {
    systemPrompt: resolveSystemPrompt(systemPrompt, systemPromptAppend),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  }

  const prompt: AgentMessage = historyUser(pendingText, Date.now())
  return { context, prompt }
}
