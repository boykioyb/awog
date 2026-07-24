import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteSession, loadSession } from '../sessions/store.js'
import { deleteSnapshots } from '../sessions/snapshots.js'
import { clearSessionPermissions } from '../sessions/permissions.js'
import { releaseSessionMcp } from '../runtime/tools/mcp-tools.js'
import { removeSdkSession } from '../runtime/claude-sdk/store.js'
import { cleanupSessionBackground } from '../sessions/bg-registry.js'

const Params = z.object({
  id: z.string().min(1),
})

register('sessions.delete', async (raw) => {
  const params = Params.parse(raw)
  // Remove the Claude SDK store artifacts BEFORE tombstoning (we need the
  // session's sdkSessionId, ADR 0058) so a deleted Anthropic session leaves no
  // orphan SDK transcript under ~/.awog/claude-sdk. No-op for Pi sessions.
  try {
    const s = await loadSession(params.id)
    if (s?.sdkSessionId) await removeSdkSession(s.sdkSessionId)
  } catch {
    /* best-effort: never block the delete */
  }
  await deleteSession(params.id)
  // Drop any session-scoped "always allow" entries so they don't linger in the
  // sidecar for the process lifetime after the session is gone.
  clearSessionPermissions(params.id)
  // Tear down any session-pooled MCP children (e.g. a Playwright browser) so a
  // deleted session leaves no orphan process running for the sidecar lifetime.
  releaseSessionMcp(params.id)
  // Kill any background shells (ADR 0066) + remove their on-disk bg/ dir so a
  // deleted session leaves no detached process or leftover logs.
  cleanupSessionBackground(params.id)
  // Best-effort: discard the session's Rewind snapshot tree (ADR 0038).
  await deleteSnapshots(params.id)
  return { ok: true }
})
