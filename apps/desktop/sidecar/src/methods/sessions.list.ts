import { register } from '../transport/rpc.js'
import { listSessionSummaries } from '../sessions/store.js'

// Returns lightweight SessionSummary[] from the index (no messages) — ADR 0048.
// The UI lazy-loads a session's transcript via sessions.get when it is opened.
register('sessions.list', async () => {
  const sessions = await listSessionSummaries()
  return { sessions }
})
