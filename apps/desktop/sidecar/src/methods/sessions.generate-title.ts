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
  // Client-provided first user message. Lets the UI fire titling EARLY — in
  // parallel with the opening turn, before that message is persisted — so a long
  // agentic first turn doesn't leave the session as "New session" for minutes.
  // Absent ⇒ fall back to the persisted first user message (post-turn path).
  userText: z.string().optional(),
})

const TITLE_SYS = `You generate a concise title for a chat conversation.
Rules:
- 3 to 6 words, Title Case.
- Summarize what the user is trying to do — no filler like "Chat about" or "Help with".
- Match the language of the conversation.
- Output ONLY the title. No surrounding quotes, no trailing punctuation.
- EXCEPTION — the conversation is about one specific GitHub issue/PR (a github.com/<org>/<repo>/(issues|pull)/<n> link in the message, or the "GitHub context" line given): the title MUST be "#<n>_IS: <short desc>" for an issue or "#<n>_PR: <short desc>" for a pull request, with <short desc> still 3-6 words in the conversation's language.`

// Known low-cost models per provider. Absent → fall back to the session model.
const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

const MAX_INPUT = 4000

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

// ── GitHub issue/PR ref → convention `#<n>_IS:` / `#<n>_PR:` ────────────────
// Detected deterministically (the model may forget the format; the prefix is a
// contract other features read back — logtime parses the number off the title).
const GH_URL_RE = /github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/(\d+)(?=[/?#]|\s|$)/i

type GhRef = { kind: 'issue' | 'pr'; number: number }

function ghRefOf(...texts: Array<string | undefined>): GhRef | null {
  for (const t of texts) {
    if (!t) continue
    const m = GH_URL_RE.exec(t)
    if (m && m[2]) {
      return { kind: m[1]?.toLowerCase() === 'pull' ? 'pr' : 'issue', number: Number(m[2]) }
    }
  }
  return null
}

const ghPrefix = (r: GhRef): string => `#${r.number}_${r.kind === 'pr' ? 'PR' : 'IS'}:`

function normalizeTitle(raw: string, ghRef: GhRef | null): string {
  let s = raw.trim().split('\n')[0]?.trim() ?? ''
  // Strip wrapping quotes the model sometimes adds.
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()
  // Drop trailing sentence punctuation.
  s = s.replace(/[.。!?！？]+$/u, '').trim()
  if (ghRef) {
    const prefix = ghPrefix(ghRef)
    // The model may render the same convention loosely ("#123 IS: x", "IS #123:
    // x", "#123: x") — canonicalize any of those onto the exact prefix.
    const loose = new RegExp(
      `^(?:#?${ghRef.number}\\s*[_ ]?\\s*(?:IS|PR)\\s*:|(?:IS|PR)\\s*[_ ]?#?${ghRef.number}\\s*:|#${ghRef.number}\\s*:)\\s*`,
      'i',
    )
    s = s.replace(loose, '')
    // A leftover bare `#<n>` or "issue #<n>" lead-in also folds into the prefix.
    s = s.replace(new RegExp(`^(?:issue|pull\\s*request|pr)?\\s*#?${ghRef.number}\\b[:\\s-]*`, 'i'), '')
    s = `${prefix} ${s}`.trimEnd()
  }
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

register('sessions.generateTitle', async (raw) => {
  const params = Params.parse(raw)
  const session = await loadSession(params.sessionId)

  // Prefer the client-provided first message (early titling, before it's persisted);
  // fall back to the persisted first user message. The session read is best-effort —
  // a title only needs the user's text, so titling still works before anything is on
  // disk (loadSession may legitimately return null on a brand-new session).
  const userText =
    params.userText?.trim() ||
    session?.messages.find((m) => m.role === 'user')?.text.trim() ||
    ''
  if (!userText) return { ok: false, reason: 'no-message' }
  const firstAgent = session?.messages.find((m) => m.role === 'agent')

  // Issue/PR the session is about — from the message text first, else the
  // persisted `aboutGhUrl` link a "New session" on a GH row carries.
  const ghRef = ghRefOf(userText, session?.aboutGhUrl)

  const prompt = [
    `User: ${clip(userText, MAX_INPUT)}`,
    firstAgent && firstAgent.text.trim() ? `Assistant: ${clip(firstAgent.text, MAX_INPUT)}` : '',
    ghRef ? `GitHub context: ${ghRef.kind === 'pr' ? 'pull request' : 'issue'} #${ghRef.number}` : '',
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
      const title = normalizeTitle(out, ghRef)
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
