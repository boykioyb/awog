import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { refreshImportedSessions } from '../sessions/claude-import.js'
import type { SessionMessage, SessionStep, SessionStepDetail } from '../types/shared.js'

// Lazy-load one full session (with messages) when the UI opens it — ADR 0048.
// `sessions.list` returns only lightweight summaries; this folds the single
// requested transcript. Returns `{ session: null }` if missing or tombstoned.
const Params = z.object({
  sessionId: z.string().min(1),
  // `lite: true` — the transcript-screen projection. The WIRE copy drops
  // `steps` when `parts` already carries the same steps (the UI derives blocks
  // from parts first) and stubs step `detail` payloads past DETAIL_DEFER_MIN
  // down to `{ kind, deferred: true }` — the desktop fetches a stub's real body
  // on expand via `sessions.stepDetail`. Defaults off: other consumers
  // (remote PWA, CLI transcript print, save-export) need the full message and
  // have no lazy-fetch round-trip.
  lite: z.boolean().optional(),
})

// Wire threshold vs DISK threshold: the disk externalization sits at 8KB
// (DETAIL_EXTERNALIZE_MIN in jsonl.ts) because every persisted blob costs a
// file; the WIRE deferral is much lower — a 4KB detail is cheap to fetch on
// expand but 900 of them still cost 3.5MB upfront. 1KB keeps tiny outputs
// inline (the common "short command → few lines" case) while pushing the long
// tail (lists of 100 files, multi-KB command echoes, small diffs) behind the
// lazy fetch.
const DETAIL_DEFER_MIN = 1024
// `target` duplicates the tool input (for terminal steps the FULL command —
// heredoc writes can be tens of KB). The header only renders its start; the
// full string is reachable via detail.command OR the stepDetail fetch, so a
// long target goes over the wire as a preview + flag.
const TARGET_DEFER_MIN = 512

// Marker carried on the projected detail stub — matches the on-disk stub
// shape (`{kind, detailRef}`) minus the file ref, which must never leak.
interface DeferredDetail {
  kind: SessionStepDetail['kind']
  deferred: true
}

// Cheap pre-check before serializing: every SessionStepDetail variant carries
// at least one sizeable string/array field; summing them estimates the detail
// size within ~1% without JSON.stringify on every step of every message.
function detailSize(step: SessionStep): number {
  const d = step.detail as Record<string, unknown> | undefined
  if (!d) return 0
  let n = 0
  for (const v of Object.values(d)) if (typeof v === 'string') n += v.length
  if (Array.isArray(d.items)) n += JSON.stringify(d.items).length
  return n
}

function deferStepDetail(step: SessionStep): SessionStep {
  const d = step.detail
  const deferDetail = !!d && detailSize(step) >= DETAIL_DEFER_MIN
  const deferTarget = (step.target?.length ?? 0) >= TARGET_DEFER_MIN
  if (!deferDetail && !deferTarget) return step
  const out = { ...step }
  if (deferDetail) {
    const stub = { kind: d!.kind, deferred: true } satisfies DeferredDetail
    out.detail = stub as unknown as NonNullable<SessionStep['detail']>
  }
  if (deferTarget) {
    // `targetDeferred` is a wire-only marker (not persisted): the UI fetches the
    // full target through sessions.stepDetail when the step body opens.
    out.target = step.target!.slice(0, TARGET_DEFER_MIN)
    ;(out as SessionStep & { targetDeferred?: boolean }).targetDeferred = true
  }
  return out
}

function projectMessageForWire(m: SessionMessage): SessionMessage {
  // `parts` is the ordered timeline and `steps` its flat fallback — they hold
  // the SAME step objects, so shipping both doubles the transcript's weight
  // (~half the payload is duplicated detail). The UI only falls back to
  // `steps` when `parts` is absent, so drop it whenever parts exists.
  const dropSteps = m.parts !== undefined && m.steps !== undefined
  const parts = m.parts?.map((p) => (p.kind === 'text' ? p : deferStepDetail(p)))
  const steps = dropSteps ? undefined : m.steps?.map(deferStepDetail)
  const partsChanged = parts?.some((p, i) => p !== m.parts![i]) ?? false
  const stepsChanged = steps?.some((s, i) => s !== m.steps![i]) ?? false
  if (!dropSteps && !partsChanged && !stepsChanged) return m
  const out = { ...m }
  if (partsChanged && parts) out.parts = parts
  if (dropSteps) delete out.steps
  else if (stepsChanged && steps) out.steps = steps
  return out
}

register('sessions.get', async (raw) => {
  const { sessionId, lite } = Params.parse(raw)
  await refreshImportedSessions(sessionId)
  const session = await loadSession(sessionId)
  if (!session || !lite) return { session }
  return {
    session: {
      ...session,
      messages: session.messages.map(projectMessageForWire),
    },
  }
})
