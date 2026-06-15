// Message ids that have a workspace snapshot (ADR 0038) — drives the UI's rewind
// affordance so a message offers a file-restoring rewind only when one exists.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSnapshotMessageIds } from '../sessions/snapshots.js'

const Params = z.object({
  sessionId: z.string().min(1),
})

register('sessions.listSnapshots', async (raw) => {
  const params = Params.parse(raw)
  return { messageIds: await listSnapshotMessageIds(params.sessionId) }
})
