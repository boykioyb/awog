import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { enqueueSteer } from '../sessions/steering.js'
import { log } from '../util/logger.js'

const Params = z.object({
  sessionId: z.string().min(1),
  // The in-flight assistant turn to steer (its placeholder messageId).
  messageId: z.string().min(1),
  // Bound to match the composer cap on a steer message. Trimmed upstream; we
  // re-trim and reject empties so a whitespace-only steer can't reach the loop.
  text: z.string().min(1).max(100_000),
})

// Inject a steer into a live turn (Session steering). Best-effort like
// sessions.cancel: if the messageId has no in-flight turn (it finished, or the
// id is stale), respond `{ ok: false }` rather than error so the UI race between
// finalize and a click is graceful. On success the steered text reaches the
// running runAgentLoop via getSteeringMessages, and a `kind:'steer'` step is
// emitted into the turn's timeline so the user sees what they injected.
register('sessions.steer', async (raw) => {
  const params = Params.parse(raw)
  const text = params.text.trim()
  if (!text) return { ok: false }
  const item = enqueueSteer(params.messageId, text)
  log.info('sessions.steer', {
    sessionId: params.sessionId,
    messageId: params.messageId,
    landed: !!item,
  })
  return item ? { ok: true, id: item.id } : { ok: false }
})
