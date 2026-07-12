import { register } from '../transport/rpc.js'
import { activeSessionIds } from '../sessions/runner.js'
import { listSessionSummaries } from '../sessions/store.js'

// Sessions with a turn currently in flight, resolved to {engineId, title} for the
// tray popover's "Running" section. The popover is a separate renderer without live
// engine events, so it can't observe the main window's in-memory `streaming` status
// (which is never persisted — a hydrated snapshot never reads back as streaming).
// It polls this on open/focus instead. The in-flight aborter registry
// (sessions/runner.ts) is the source of truth for what is running; titles come from
// the cheap on-disk index (listSessionSummaries), filtered to the active set — so
// the result is independent of how stale the tray's own session list is.
register('sessions.activeTurns', async () => {
  const ids = activeSessionIds()
  if (!ids.length) return { sessions: [] }
  const titleById = new Map((await listSessionSummaries()).map((s) => [s.id, s.title]))
  const sessions = ids.map((engineId) => ({ engineId, title: titleById.get(engineId) ?? '' }))
  return { sessions }
})
