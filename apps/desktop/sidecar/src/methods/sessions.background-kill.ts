import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { killBackground } from '../sessions/bg-registry.js'

// Kill a running background shell (ADR 0066) — the UI's "stop" affordance on a
// bg-shell chip. Kills the detached process group and finalizes the shell (which
// emits session.background-done). Returns { ok } — false for an unknown shellId.
const Params = z.object({
  sessionId: z.string().min(1),
  shellId: z.string().min(1),
})

register('sessions.backgroundKill', (raw) => {
  const { sessionId, shellId } = Params.parse(raw)
  return { ok: killBackground(sessionId, shellId) }
})
