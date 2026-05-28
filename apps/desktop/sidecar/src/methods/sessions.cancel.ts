import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { abortMessage } from '../sessions/runner.js'
import { log } from '../util/logger.js'

const Params = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
})

// Best-effort: if the messageId is no longer in the registry (stream already
// finished or never started), respond `{aborted: false}` rather than error so
// the UI race between finalize and a user clicking Stop is graceful.
register('sessions.cancel', async (raw) => {
  const params = Params.parse(raw)
  const aborted = abortMessage(params.messageId)
  log.info('sessions.cancel', {
    sessionId: params.sessionId,
    messageId: params.messageId,
    aborted,
  })
  return { aborted }
})
