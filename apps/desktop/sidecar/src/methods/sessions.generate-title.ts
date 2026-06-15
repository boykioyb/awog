// AI-generated session title from the first exchange.
//
// Pure-text one-shot through the Pi runtime (like git.generateCommitMessage):
// summarize the opening user → assistant turn into a 3-6 word title. Called by
// the UI after the first turn finalizes (sessions store) to replace the crude
// "first 60 chars of the user's message" placeholder with a concise title.
//
// Cheap-model strategy: prefer a known low-cost model for the provider; if that
// fails (custom endpoint that doesn't serve it, invalid id, auth) fall back to
// the session's own model so a title is still produced. Best-effort — any total
// failure returns { ok: false } and the UI keeps the placeholder title.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'
import type { ProviderName } from '../types/shared.js'

const Params = z.object({
  sessionId: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
})

const TITLE_SYS = `You generate a concise title for a chat conversation.
Rules:
- 3 to 6 words, Title Case.
- Summarize what the user is trying to do — no filler like "Chat about" or "Help with".
- Match the language of the conversation.
- Output ONLY the title. No surrounding quotes, no trailing punctuation.`

// Known low-cost models per provider. Absent → fall back to the session model.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

const MAX_INPUT = 4000

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function normalizeTitle(raw: string): string {
  let s = raw.trim().split('\n')[0]?.trim() ?? ''
  // Strip wrapping quotes the model sometimes adds.
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  // Drop trailing sentence punctuation.
  s = s.replace(/[.。!?！？]+$/u, '').trim()
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

register('sessions.generateTitle', async (raw) => {
  const params = Params.parse(raw)
  const session = await loadSession(params.sessionId)
  if (!session) return { ok: false, reason: 'no-session' }

  const firstUser = session.messages.find((m) => m.role === 'user')
  if (!firstUser || !firstUser.text.trim()) return { ok: false, reason: 'no-message' }
  const firstAgent = session.messages.find((m) => m.role === 'agent')

  const prompt = [
    `User: ${clip(firstUser.text, MAX_INPUT)}`,
    firstAgent && firstAgent.text.trim() ? `Assistant: ${clip(firstAgent.text, MAX_INPUT)}` : '',
    '',
    'Title:',
  ]
    .filter(Boolean)
    .join('\n')

  // Try the cheap model first, then the session's own model as a fallback.
  const cheap = CHEAP_MODEL[params.provider]
  const candidates =
    cheap && cheap !== params.modelId ? [cheap, params.modelId] : [params.modelId]

  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      const out = await completePi({
        provider: params.provider,
        ...(params.accountId ? { accountId: params.accountId } : {}),
        modelId,
        systemPrompt: TITLE_SYS,
        prompt,
      })
      const title = normalizeTitle(out)
      if (title) {
        log.info('sessions.generateTitle', { sessionId: params.sessionId, model: modelId })
        return { ok: true, title }
      }
    } catch (err) {
      log.warn('sessions.generateTitle attempt failed', {
        sessionId: params.sessionId,
        model: modelId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { ok: false, reason: 'error' }
})
