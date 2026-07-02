// Rewind a session to an earlier message (ADR 0038): truncate the conversation
// to that point AND restore the workspace files to the snapshot taken at that
// turn. File restore is best-effort — when the session has no project, or no
// snapshot exists for the message, the rewind is conversation-only.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { truncateSession, loadSession } from '../sessions/store.js'
import { restoreSnapshot } from '../sessions/snapshots.js'
import { loadProject } from '../projects/store.js'
import { removeSdkSession } from '../runtime/claude-sdk/store.js'
import { log } from '../util/logger.js'

const Params = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  projectId: z.string().optional(),
})

register('sessions.rewind', async (raw) => {
  const params = Params.parse(raw)

  // Conversation: drop every message after the target (it is kept). The
  // truncation invalidates the Claude SDK resume handle (fold clears
  // sdkSessionId), so remove the now-orphan SDK transcript (ADR 0058); the next
  // Claude turn seeds a fresh SDK session from the rewound JSONL.
  try {
    const s = await loadSession(params.sessionId)
    if (s?.sdkSessionId && s.messages.some((m) => m.id === params.messageId)) {
      await removeSdkSession(s.sdkSessionId)
    }
  } catch {
    /* best-effort: never block the rewind */
  }
  await truncateSession(params.sessionId, params.messageId)

  // Files: restore the snapshot keyed to that turn, if any.
  let restored = 0
  let deleted = 0
  let filesRestored = false
  if (params.projectId) {
    try {
      const project = await loadProject(params.projectId)
      if (project?.path) {
        const res = await restoreSnapshot(params.sessionId, params.messageId, project.path)
        if (res.ok) {
          filesRestored = true
          restored = res.restored ?? 0
          deleted = res.deleted ?? 0
        }
      }
    } catch (err) {
      log.warn('sessions.rewind: restore failed', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { ok: true, filesRestored, restored, deleted }
})
