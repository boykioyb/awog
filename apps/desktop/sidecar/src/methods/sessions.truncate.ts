import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { truncateSession, loadSession } from '../sessions/store.js'
import { removeSdkSession } from '../runtime/claude-sdk/store.js'

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
  // A real truncation invalidates the Claude SDK resume handle (the fold clears
  // sdkSessionId; the SDK store still holds the removed turns), so remove the now
  // -orphan SDK transcript (ADR 0058). Guard on the id actually matching so a
  // stale/garbage no-op truncate doesn't wipe a still-valid SDK session. The next
  // Claude turn seeds a fresh SDK session from the truncated JSONL.
  try {
    const s = await loadSession(params.sessionId)
    const isRealTruncation =
      params.keepThroughId === null || !!s?.messages.some((m) => m.id === params.keepThroughId)
    if (s?.sdkSessionId && isRealTruncation) await removeSdkSession(s.sdkSessionId)
  } catch {
    /* best-effort: never block the truncate */
  }
  await truncateSession(params.sessionId, params.keepThroughId)
  return { ok: true }
})
