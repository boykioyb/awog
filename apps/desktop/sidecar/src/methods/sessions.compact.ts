import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runStream } from '../sessions/runner.js'
import { loadSession, appendMessage } from '../sessions/store.js'
import { loadProject } from '../projects/store.js'
import { log } from '../util/logger.js'
import type { SessionMessage, SessionSettings } from '../types/shared.js'

// `/compact` — summarize the conversation to free up token budget (ADR 0023,
// amended by ADR 0029). The Pi runtime reimplements compaction as a one-shot
// summarize over the rebuilt history (no opaque SDK session). We load the
// session's messages and hand them to the runtime via slashCommand: 'compact'.
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
  if (!session || session.messages.length === 0) {
    // Nothing to compact: a fresh session with no turns yet. The next normal
    // turn seeds history; compaction only makes sense afterwards.
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

  await runStream(
    {
      sessionId: params.sessionId,
      pendingText: '/compact',
      history: session.messages,
      settings,
      slashCommand: 'compact',
      ...(cwd ? { cwd } : {}),
    },
    { onChunk: () => {} },
  )

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
