import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { updateSessionMetadata } from '../sessions/store.js'

// Replace a session's bookmark list with the one the user currently has (ADR 0074).
// Bookmarks are reading anchors placed by the HUMAN: they live in the session header,
// never enter the prompt, and never leave ~/.awog. A narrow RPC (not sessions.upsert,
// which demands the whole session) mirrors sessions.updateTodos — the right unit for a
// list the UI rewrites on every click.
//
// The payload is L1 (IPC from the UI): the schema is the validation boundary — unknown
// fields are stripped, an empty list is legal (it clears every bookmark), the count is
// capped here and NOT only in the UI, and each `id` is restricted to the message-id
// charset so a bookmark id can never be smuggled toward a path sink.
const MAX_BOOKMARKS = 30
// ISO-8601 timestamps are ~24-33 chars; 40 leaves headroom without letting the header
// line grow on a hostile payload.
const MAX_AT = 40

const Params = z.object({
  sessionId: z.string().min(1),
  bookmarks: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        at: z.string().max(MAX_AT),
      }),
    )
    .max(MAX_BOOKMARKS),
})

register('sessions.updateBookmarks', async (raw) => {
  const params = Params.parse(raw)
  await updateSessionMetadata(params.sessionId, { bookmarks: params.bookmarks })
  return { ok: true }
})
