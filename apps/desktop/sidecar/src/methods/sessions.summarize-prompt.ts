// Distill a whole session into ONE self-contained handoff prompt.
//
// Pure-text one-shot through the Pi runtime (like sessions.enhancePrompt): read the
// persisted transcript and summarize it into a single prompt a FRESH assistant — with
// no access to this conversation — can act on to continue the work (goal · key context
// & decisions · current state · next steps). Called by the Export dialog's "Prompt"
// mode; the UI shows it for copy / save.
//
// Uses the session's OWN model (quality matters more than for titling) with its
// account, honoring the session's provider/model config.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { completePi } from '../runtime/complete.js'
import { log } from '../util/logger.js'

const Params = z.object({
  sessionId: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
})

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

// Transcript budget: enough to summarize a long session without blowing the model's
// context. When the conversation exceeds it, keep the HEAD (the original goal) plus
// the TAIL (the recent state) — the two ends that matter most for a handoff.
const MAX_INPUT = 48_000

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

  try {
    const out = await completePi({
      provider: params.provider,
      ...(params.accountId ? { accountId: params.accountId } : {}),
      modelId: params.modelId,
      systemPrompt: SUMMARY_SYS,
      // Wrap the transcript in markers so the model treats it as source to summarize,
      // not as instructions to act on. Output stays "only the prompt".
      prompt: `Distill the conversation between the markers into one continuation prompt. Output only the prompt.\n\n<<<CONVERSATION\n${clipHeadTail(transcript, MAX_INPUT)}\nCONVERSATION>>>`,
    })
    const text = out.trim()
    if (!text) throw new RpcError(-32021, 'Empty response from model')
    log.info('sessions.summarizePrompt', {
      sessionId: params.sessionId,
      model: params.modelId,
      inChars: transcript.length,
    })
    return { text }
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw new RpcError(
      -32021,
      `summarizePrompt failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
})
