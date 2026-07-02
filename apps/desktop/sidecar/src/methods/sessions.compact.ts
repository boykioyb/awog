import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { runStream, registerAborter, unregisterAborter } from '../sessions/runner.js'
import { loadSession, compactSession } from '../sessions/store.js'
import { loadProject } from '../projects/store.js'
import { log } from '../util/logger.js'
import type { SessionSettings } from '../types/shared.js'

// `/compact` — summarise older turns to free up token budget (ADR 0047, amends
// ADR 0023). The Pi runtime re-summarises the transcript prefix and returns a
// compaction checkpoint { summary, firstKeptMessageId, tokensBefore }; we persist
// it as a `session.compacted` event. The full transcript is left intact (the UI
// keeps showing it); only the model context is cut, in buildContext.
//
// Separate from sessions.sendMessage so it never pushes a `/compact` user bubble;
// the UI drives a normal running state (placeholder + Stop) and renders a summary
// marker on success. `messageId` lets the UI's Stop button abort mid-compaction.
const Params = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  // Recent-context budget kept verbatim (ADR 0047). Manual /compact sends 0
  // (keep only the last turn); omitted → Pi default (20k). Clamped ≥ 0.
  keepRecentTokens: z.number().int().min(0).optional(),
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

  // Compaction is a context op: level/mode don't affect the result, so use the
  // cheapest, no-prompt combo.
  const settings: SessionSettings = {
    provider: params.provider,
    modelId: params.modelId,
    level: 'low',
    mode: 'ask',
    ...(params.accountId ? { accountId: params.accountId } : {}),
  }

  // One AbortController for the run; sessions.cancel resolves it by messageId so
  // the Stop button aborts mid-compaction (mirrors sessions.send-message).
  const abortController = new AbortController()
  registerAborter(params.sessionId, params.messageId, abortController)

  try {
    const result = await runStream(
      {
        sessionId: params.sessionId,
        pendingText: '/compact',
        history: session.messages,
        settings,
        slashCommand: 'compact',
        abortController,
        ...(params.keepRecentTokens !== undefined
          ? { keepRecentTokens: params.keepRecentTokens }
          : {}),
        // Prior checkpoint: lets runCompact skip a no-op re-compact and keeps the
        // cut monotonic.
        ...(session.compaction ? { compaction: session.compaction } : {}),
        ...(cwd ? { cwd } : {}),
      },
      { onChunk: () => {} },
    )

    // Pi path returns a compaction CHECKPOINT (ADR 0047) we persist as a
    // session.compacted event + render as a marker.
    if (result.compaction) {
      await compactSession(params.sessionId, result.compaction)
      return { ok: true, compaction: result.compaction }
    }
    // Claude SDK path (ADR 0058) compacts its OWN session store — no AWOG
    // checkpoint to persist; `compacted: true` means it really compacted, so
    // report success (avoids a false "nothing to compact" on the Anthropic path).
    if (result.compacted) {
      return { ok: true }
    }
    // Nothing was summarised (too short / already compacted / failed). The UI
    // clears its running state without adding a checkpoint.
    return { ok: false, reason: 'nothing-to-compact' }
  } catch (err) {
    log.warn('sessions.compact failed', {
      sessionId: params.sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, reason: 'error' }
  } finally {
    unregisterAborter(params.messageId)
  }
})
