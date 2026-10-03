import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSessionCascade } from '../sessions/delete-cascade.js'

// Session ids are slugs: legacy `ses-<n>` and the current
// `YYMMDD-adjective-noun-tail`. Bounded here as well as in `sanitizeChild`,
// because this id addresses a directory that gets removed recursively.
const SESSION_ID_RE = /^[a-z0-9-]+$/

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
})

register('sessions.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteSessionCascade(params.id)
  return { ok: true }
})
