import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { resolveQuestionRequest } from '../sessions/questions.js'
import { log } from '../util/logger.js'

// Resolves a parked AskUserQuestion promise with the user's answers from the UI
// (see docs/features/ask-user-question.md). `requestId` is the tool-call id (==
// the step id). Input is untrusted (L1, from the renderer): bound the array
// sizes + string lengths so a malformed/oversized payload can't bloat the model
// context. Idempotent: a stale click after the prompt was torn down (cancel /
// abort) returns { resolved: false } so the UI can drop it.
const AnswerSchema = z.object({
  header: z.string().max(200),
  selected: z.array(z.string().max(4_000)).max(8),
})

const Params = z.object({
  requestId: z.string().min(1),
  answers: z.array(AnswerSchema).max(4),
})

register('sessions.answerQuestion', async (raw) => {
  const params = Params.parse(raw)
  const resolved = resolveQuestionRequest(params.requestId, params.answers)
  log.info('sessions.answerQuestion', {
    requestId: params.requestId,
    answerCount: params.answers.length,
    resolved,
  })
  return { resolved }
})
