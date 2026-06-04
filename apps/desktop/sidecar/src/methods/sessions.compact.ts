import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runStream } from '../sessions/runner.js'
import { loadSession, appendMessage, updateSessionMetadata } from '../sessions/store.js'
import { loadProject } from '../projects/store.js'
import { log } from '../util/logger.js'
import type { SessionMessage, SessionSettings } from '../types/shared.js'

// `/compact` — forward the SDK's internal compaction command (ADR 0023). The
// SDK only treats `/compact` as a command when it is the sole prompt of a
// resumed session, so this runs a dedicated lean turn: resume the session,
// send the bare `/compact`, let the SDK summarize + shrink its context.
//
// Separate from sessions.sendMessage so it never pushes a `/compact` user
// bubble; the UI shows a system note instead. No agent / MCP / tool resolution
// — compaction is a pure context operation.
const Params = z.object({
  sessionId: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
})

register('sessions.compact', async (raw) => {
  const params = Params.parse(raw)

  const session = await loadSession(params.sessionId)
  if (!session?.sdkSessionId) {
    // Nothing to compact: no SDK session has been started for this chat yet
    // (e.g. a fresh session, or one created before resume existed). The next
    // normal turn seeds one; compaction only makes sense afterwards.
    return { ok: false, reason: 'no-session' }
  }

  let cwd: string | undefined
  if (params.projectId) {
    try {
      const project = await loadProject(params.projectId)
      if (project?.path) cwd = project.path
    } catch {
      // Stale projectId — run compaction without a cwd.
    }
  }

  // Compaction is a context op: defaults for level/mode are irrelevant to the
  // result, so use the cheapest, no-prompt combo.
  const settings: SessionSettings = {
    provider: params.provider,
    modelId: params.modelId,
    level: 'low',
    mode: 'ask',
    ...(params.accountId ? { accountId: params.accountId } : {}),
  }

  const result = await runStream(
    {
      sessionId: params.sessionId,
      pendingText: '/compact',
      history: [],
      settings,
      slashCommand: 'compact',
      sdkSessionId: session.sdkSessionId,
      ...(cwd ? { cwd } : {}),
    },
    { onChunk: () => {} },
  )

  // Compaction may rotate the session id — persist whatever the SDK reported.
  if (result.sdkSessionId && result.sdkSessionId !== session.sdkSessionId) {
    try {
      await updateSessionMetadata(params.sessionId, { sdkSessionId: result.sdkSessionId })
    } catch (err) {
      log.warn('failed to persist sdkSessionId after compact', {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Leave a system breadcrumb in the transcript so the user sees compaction ran.
  const note: SessionMessage = {
    id: `msg_sys_${randomBytes(8).toString('hex')}`,
    role: 'system',
    text: 'Context compacted to free up token budget.',
    at: new Date().toISOString(),
  }
  try {
    await appendMessage(params.sessionId, note)
  } catch (err) {
    log.warn('failed to persist compact note', {
      sessionId: params.sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }

  return { ok: true, note }
})
