import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { isTurnActive } from '../sessions/runner.js'

const Params = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
})

// Lightweight liveness probe for a streaming turn. The UI clears its "Streaming…"
// indicator on the sendMessage RPC resolve OR the session.message.done event; if
// BOTH are lost in transit (a dropped/corrupted stdout response line, or a
// webContents.send to a momentarily-absent window) the bubble is stranded
// "streaming" forever with no recovery. The UI's stall watchdog calls this for a
// long-stuck bubble: `active: false` means the turn already ended (its aborter was
// unregistered in send-message's finally) so the UI can finalize defensively;
// `active: true` means it is genuinely still running (incl. a long silent tool call
// or a turn parked on a gate) → the UI leaves it alone.
register('sessions.turnActive', async (raw) => {
  const params = Params.parse(raw)
  return { active: isTurnActive(params.sessionId, params.messageId) }
})
