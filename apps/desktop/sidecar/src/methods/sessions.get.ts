import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'

// Lazy-load one full session (with messages) when the UI opens it — ADR 0048.
// `sessions.list` returns only lightweight summaries; this folds the single
// requested transcript. Returns `{ session: null }` if missing or tombstoned.
const Params = z.object({ sessionId: z.string().min(1) })

register('sessions.get', async (raw) => {
  const { sessionId } = Params.parse(raw)
  const session = await loadSession(sessionId)
  return { session }
})
