// Distill a whole session into ONE self-contained handoff prompt.
//
// Streaming pure-text one-shot through the Pi runtime: read the persisted transcript
// and summarize it into a single prompt a FRESH assistant — with no access to this
// conversation — can act on to continue the work (goal · key context & decisions ·
// current state · next steps). Called by the Export dialog's "Prompt" mode; text
// deltas stream to the UI (sessions.summarizePrompt.chunk) so the prompt builds live,
// and the full text is returned for copy / save.
//
// Model choice: prefer a fast, capable model (Sonnet on Anthropic) over the session's
// own — a summary doesn't need the session's heavy model, and the wait was the main
// complaint. Falls back to the session's model if the fast one can't be served (e.g. a
// custom endpoint that doesn't carry it), but only before any text has streamed.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { streamCompletePi } from '../runtime/complete.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import type { ProviderName } from '../types/shared.js'

const Params = z.object({
  sessionId: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
  // Correlates the streamed chunk events (sessions.summarizePrompt.chunk) back to
  // this call so the UI only appends deltas for the prompt it's showing.
  requestId: z.string().min(1),
})

// Fast, capable model per provider for the summary (mirrors the cheap-model strategy
// in sessions.generateTitle). Absent → fall back to the session's own model.
const FAST_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-sonnet-5',
}

const SUMMARY_SYS = `You distill a coding/agent assistant conversation into ONE self-contained prompt that a FRESH assistant — with no access to this conversation — can act on to continue the work.

Write the prompt in the SAME language as the conversation.

Cover (as flowing prose or short labeled sections, whichever reads best):
- Goal: what the user is ultimately trying to accomplish.
- Key context & decisions: concrete facts, constraints, and choices already made — file paths, identifiers, APIs, formats, names. Prefer specifics over vague summary.
- Current state: what has been done / established so far.
- Next steps: what remains to do.

Rules:
- The output IS a prompt addressed TO an assistant (imperative, first person as the user), NOT a report about the conversation.
- Be concise but lossless on the decisions and specifics needed to continue.
- Do NOT invent details that were not in the conversation.
- Output ONLY the prompt text. No preamble, no meta-commentary, no surrounding quotes, no wrapping code fence.`

// Transcript budget: enough to summarize a long session without a heavy prefill on
// every call (prefill was a chunk of the latency). When the conversation exceeds it,
// keep the HEAD (the original goal) plus the TAIL (the recent state) — the two ends
// that matter most for a handoff.
const MAX_INPUT = 24_000

function clipHeadTail(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.35)
  const tail = max - head
  return `${text.slice(0, head)}\n\n[…omitted middle…]\n\n${text.slice(text.length - tail)}`
}

register('sessions.summarizePrompt', async (raw) => {
  const params = Params.parse(raw)
  const session = await loadSession(params.sessionId)
  if (!session) throw new RpcError(-32004, 'Session not found')

  const lines: string[] = []
  for (const m of session.messages) {
    const text = m.text?.trim()
    if (!text) continue
    const who = m.role === 'user' ? 'User' : m.role === 'agent' ? 'Assistant' : 'System'
    lines.push(`${who}: ${text}`)
  }
  const transcript = lines.join('\n\n')
  if (!transcript) throw new RpcError(-32602, 'Session has no content to summarize')

  // Wrap the transcript in markers so the model treats it as source to summarize, not
  // as instructions to act on. Output stays "only the prompt".
  const prompt = `Distill the conversation between the markers into one continuation prompt. Output only the prompt.\n\n<<<CONVERSATION\n${clipHeadTail(transcript, MAX_INPUT)}\nCONVERSATION>>>`

  // Fast model first, then the session's own as a fallback.
  const fast = FAST_MODEL[params.provider]
  const candidates = fast && fast !== params.modelId ? [fast, params.modelId] : [params.modelId]

  // Relay each delta to the UI; `streamed` guards against retrying another model once
  // the user has already seen partial text (a fallback then would garble the preview).
  let streamed = false
  const onDelta = (delta: string): void => {
    streamed = true
    emit('sessions.summarizePrompt.chunk', { requestId: params.requestId, delta })
  }

  let lastErr: unknown
  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      const out = await streamCompletePi(
        {
          provider: params.provider,
          ...(params.accountId ? { accountId: params.accountId } : {}),
          modelId,
          systemPrompt: SUMMARY_SYS,
          prompt,
        },
        onDelta,
      )
      const text = out.trim()
      if (text) {
        log.info('sessions.summarizePrompt', {
          sessionId: params.sessionId,
          model: modelId,
          inChars: transcript.length,
        })
        return { text }
      }
      lastErr = new RpcError(-32021, 'Empty response from model')
    } catch (err) {
      lastErr = err
      log.warn('sessions.summarizePrompt attempt failed', {
        sessionId: params.sessionId,
        model: modelId,
        err: err instanceof Error ? err.message : String(err),
      })
      if (streamed) break
    }
  }
  if (lastErr instanceof RpcError) throw lastErr
  throw new RpcError(
    -32021,
    `summarizePrompt failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
})
