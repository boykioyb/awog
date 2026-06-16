import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { abortMessage, abortSession } from '../sessions/runner.js'
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
  // Abort the named turn, then abort any OTHER in-flight turn on the same
  // session too. A hung turn can hold the per-session lock with a later turn
  // queued behind it, and the UI's Stop targets only the (queued) active
  // messageId — session-wide abort guarantees the genuinely-running turn is
  // torn down so the session always unblocks.
  const aborted = abortMessage(params.messageId)
  const sessionAborted = abortSession(params.sessionId)
  log.info('sessions.cancel', {
    sessionId: params.sessionId,
    messageId: params.messageId,
    aborted,
    sessionAborted,
  })
  return { aborted: aborted || sessionAborted > 0 }
})
