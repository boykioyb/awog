import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSession } from '../sessions/store.js'
import { deleteSnapshots } from '../sessions/snapshots.js'
import { clearSessionPermissions } from '../sessions/permissions.js'
import { releaseSessionMcp } from '../runtime/tools/mcp-tools.js'

const Params = z.object({
  id: z.string().min(1),
})

register('sessions.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteSession(params.id)
  // Drop any session-scoped "always allow" entries so they don't linger in the
  // sidecar for the process lifetime after the session is gone.
  clearSessionPermissions(params.id)
  // Tear down any session-pooled MCP children (e.g. a Playwright browser) so a
  // deleted session leaves no orphan process running for the sidecar lifetime.
  releaseSessionMcp(params.id)
  // Best-effort: discard the session's Rewind snapshot tree (ADR 0038).
  await deleteSnapshots(params.id)
  return { ok: true }
})
