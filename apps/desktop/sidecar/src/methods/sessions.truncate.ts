import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { truncateSession } from '../sessions/store.js'

// Drop every message after `keepThroughId` from a session's transcript (the
// message itself is kept; `null` empties it). Event-sourced: appends a
// `session.truncated` event the fold replays on load. Backs the UI's
// edit-and-resend / regenerate (sessions store) and the conversation half of
// Rewind. The optimistic UI already mutated its in-memory copy — this persists.
const Params = z.object({
  sessionId: z.string().min(1),
  keepThroughId: z.string().min(1).nullable(),
})

register('sessions.truncate', async (raw) => {
  const params = Params.parse(raw)
  await truncateSession(params.sessionId, params.keepThroughId)
  return { ok: true }
})
