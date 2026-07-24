import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listBackground } from '../sessions/bg-registry.js'

// List a session's background shells (ADR 0066). Used by the UI to hydrate the
// bg-shell chips when a session is opened — the live `session.background-*`
// events only cover shells started/finished after the listener is attached, so a
// reload needs this to recover the current set.
const Params = z.object({
  sessionId: z.string().min(1),
})

register('sessions.backgroundList', (raw) => {
  const { sessionId } = Params.parse(raw)
  return { shells: listBackground(sessionId) }
})
