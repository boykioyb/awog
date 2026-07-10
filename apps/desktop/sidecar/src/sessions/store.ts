// Session storage facade (craft-parity single-file JSONL, ADR 0061 storage phase).
//
// This module used to BE the event-sourced store (one append-only SessionEvent per
// line, folded on load). It has been CUT OVER to a thin facade over `sessionManager`
// + the single-file header+messages format (sessions/jsonl.ts + session-manager.ts):
// line 1 is a SessionHeader with pre-computed list fields, lines 2+ are the messages.
//
// The exported function names + signatures are preserved so every consumer
// (methods/sessions.*.ts, activity.summary.ts, dashboard.usage.ts, usage/rollup.ts)
// compiles unchanged. Each entry point awaits `sessionManager.ensureLoaded()` first,
// which runs the legacy→new migration + loadAllFromDisk exactly once — so the Map is
// populated (and its startup clear() has already happened) before any read or write.

import { log } from '../util/logger.js'
import type {
  Session,
  SessionCompaction,
  SessionMessage,
  SessionSummary,
} from '../types/shared.js'
import { readSessionJsonl, readSessionMessages, sessionFilePath } from './jsonl.js'
import { sessionManager, type SessionMetadataPatch } from './session-manager.js'

// ─── CRUD facade ──────────────────────────────────────────────────────────────

// Full session (with messages), or null when missing/deleted. Lazy-loads the
// transcript on first access; the runner's resume path folds this when the UI
// sends an empty history array.
export async function loadSession(id: string): Promise<Session | null> {
  await sessionManager.ensureLoaded()
  return sessionManager.getSession(id)
}

export async function createSession(session: Session): Promise<void> {
  await sessionManager.ensureLoaded()
  await sessionManager.createSession(session)
}

export async function updateSessionMetadata(
  id: string,
  patch: SessionMetadataPatch,
): Promise<void> {
  await sessionManager.ensureLoaded()
  await sessionManager.updateMetadata(id, patch)
}

// Append (or upsert-by-id) a message. The manager warms the in-memory cache and
// enqueues a DEBOUNCED (500ms-coalesced) atomic write — that debounce is the
// crash-safety/periodic flush for mid-turn partials.
export async function appendMessage(sessionId: string, message: SessionMessage): Promise<void> {
  await sessionManager.ensureLoaded()
  await sessionManager.appendMessage(sessionId, message)
}

// Drop every message AFTER `keepThroughId` (that message is kept). `null` empties
// the transcript. An unknown id is a NO-OP (never wipe on a stale/garbage id).
// Drops sdkSessionId (ADR 0058): a real truncation rewrites history, so the Claude
// SDK resume handle is stale — the next Claude turn re-seeds from the truncated JSONL.
export async function truncateSession(
  sessionId: string,
  keepThroughId: string | null,
): Promise<void> {
  await sessionManager.ensureLoaded()
  const session = await sessionManager.getSession(sessionId)
  if (!session) {
    log.warn('truncateSession: session not found, skipping', { sessionId })
    return
  }
  let messages: SessionMessage[]
  if (keepThroughId === null) {
    messages = []
  } else {
    const idx = session.messages.findIndex((m) => m.id === keepThroughId)
    // Unknown id → no-op: leave the transcript (and sdkSessionId) untouched.
    if (idx < 0) return
    messages = session.messages.slice(0, idx + 1)
  }
  const { sdkSessionId: _staleSdk, ...rest } = session
  await sessionManager.saveSession({ ...rest, messages })
}

// Persist a context-compaction checkpoint (ADR 0047). Guards against a dangling
// cut point (only applies when firstKeptMessageId still exists in the transcript).
// Drops sdkSessionId (ADR 0058): the compaction supersedes the Claude SDK session,
// so the next Claude turn re-seeds a fresh, smaller SDK session.
export async function compactSession(
  sessionId: string,
  compaction: SessionCompaction,
): Promise<void> {
  await sessionManager.ensureLoaded()
  const session = await sessionManager.getSession(sessionId)
  if (!session) {
    log.warn('compactSession: session not found, skipping', { sessionId })
    return
  }
  const known = session.messages.some((m) => m.id === compaction.firstKeptMessageId)
  if (!known) return
  const { sdkSessionId: _supersededSdk, ...rest } = session
  await sessionManager.saveSession({ ...rest, compaction })
}

// Physically delete a session (file + map entry). Unlike the old logical tombstone,
// no purge step is needed afterwards.
export async function deleteSession(id: string): Promise<void> {
  await sessionManager.ensureLoaded()
  await sessionManager.deleteSession(id)
}

// ─── List / search ─────────────────────────────────────────────────────────────

// Lightweight list-row projections, newest first — from the resident header map,
// no transcript reads (ADR 0048).
export async function listSessionSummaries(): Promise<SessionSummary[]> {
  await sessionManager.ensureLoaded()
  return sessionManager.getSessions()
}

// Full sessions (with messages), newest first. Heavy — reads every transcript — so
// this is for on-demand full-text search only (sessions.search). Reads each file
// TRANSIENTLY (readSessionJsonl) instead of sessionManager.getSession, so a search
// does NOT permanently hydrate every transcript into the warm map (reviewer #4).
export async function listFullSessions(): Promise<Session[]> {
  await sessionManager.ensureLoaded()
  const summaries = sessionManager.getSessions()
  const sessions: Session[] = []
  for (const s of summaries) {
    const parsed = readSessionJsonl(sessionFilePath(s.id))
    if (!parsed) continue
    // Strip the 4 pre-computed header fields → Omit<Session, 'messages'>, attach body.
    const { messageCount: _mc, preview: _pv, status: _st, lastPreview: _lp, ...meta } = parsed.header
    sessions.push({ ...meta, messages: parsed.messages })
  }
  return sessions
}

// ─── Bounded token-usage aggregation (dashboard.usage) ──────────────────────
// One token-bearing assistant turn extracted from a session: the timestamp it
// completed and the summed tokens of its `usage` bucket.
export interface UsageEntry {
  // ms epoch — `completedAt` if present, else parsed from the message `at`.
  at: number
  // inputTokens + outputTokens + cacheRead + cacheWrite of the turn.
  tokens: number
}

// Sum the four token buckets of a SessionMessage.usage. Cache buckets count toward
// context usage too, so they are included (see CLAUDE memory note).
function sumUsageTokens(usage: SessionMessage['usage']): number {
  if (!usage) return 0
  return (
    (usage.inputTokens || 0) +
    (usage.outputTokens || 0) +
    (usage.cacheReadTokens || 0) +
    (usage.cacheWriteTokens || 0)
  )
}

// Resolve the effective timestamp of an assistant turn — its own `completedAt`
// (ms epoch) if present, else the message `at` (ISO-8601) parsed to ms.
function messageTimeMs(msg: SessionMessage): number {
  if (typeof msg.completedAt === 'number' && Number.isFinite(msg.completedAt)) {
    return msg.completedAt
  }
  return Date.parse(msg.at)
}

// Collect every token-bearing assistant turn whose timestamp is >= windowStartMs
// across all sessions. Uses the resident headers to skip sessions untouched since
// the window start, then reads that session's messages from disk (bounded — the
// single-file format keeps files small; only recently-touched sessions are read).
// In the new format each message appears once, so the dedupe-by-id is trivially
// satisfied (kept for parity with the return contract).
export async function collectUsageSince(windowStartMs: number): Promise<UsageEntry[]> {
  await sessionManager.ensureLoaded()
  const summaries = sessionManager.getSessions()
  const entries: UsageEntry[] = []
  for (const s of summaries) {
    const updatedMs = Date.parse(s.updatedAt || s.createdAt)
    if (Number.isFinite(updatedMs) && updatedMs < windowStartMs) continue
    // Best-effort: a single unreadable transcript (readSessionMessages throws on a real
    // read error — infosec F1) must not crash the whole dashboard rollup.
    let messages: SessionMessage[]
    try {
      messages = readSessionMessages(sessionFilePath(s.id))
    } catch (err) {
      log.warn('usage: failed to read session tail', {
        sessionId: s.id,
        err: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    const seen = new Set<string>()
    for (const msg of messages) {
      if (msg.role !== 'agent' || !msg.usage) continue
      if (seen.has(msg.id)) continue
      seen.add(msg.id)
      const tokens = sumUsageTokens(msg.usage)
      if (tokens <= 0) continue
      const at = messageTimeMs(msg)
      if (!Number.isFinite(at) || at < windowStartMs) continue
      entries.push({ at, tokens })
    }
  }
  return entries
}

// ─── Detailed per-turn usage for the Activity rollup (ADR 0054) ──────────────
// One assistant turn with its 4 token buckets + cost-attribution metadata
// (provider / model / accountId). Heavier than UsageEntry (the dashboard tile),
// but the Activity page needs the per-model + per-account breakdown.
export interface SessionTurnUsage {
  at: number // ms epoch — completedAt if present, else message `at`
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  provider: string
  model: string
  accountId: string
  // Owning session id — lets the Activity page group usage by session.
  sessionId: string
  // Owning project id (empty string when the session is not scoped to a project).
  // Lets the Activity page filter usage by project.
  projectId: string
}

// Stable sentinel for a turn whose account id was never recorded (legacy turn +
// a session whose settings carry no explicit accountId — i.e. it ran on the
// provider's active account). The Activity method resolves it to the active
// account label so the row still appears.
export const UNKNOWN_ACCOUNT_ID = 'unknown'

// Collect detailed per-turn usage for every session touched in [windowStartMs,
// windowEndMs]. Same skip-by-updatedAt + read-messages strategy as
// collectUsageSince. Per-turn provider/model/accountId fall back to the session's
// current settings when a legacy turn omits them (back-compat). Dedupes by id.
export async function collectSessionTurnsSince(
  windowStartMs: number,
  windowEndMs: number,
): Promise<SessionTurnUsage[]> {
  await sessionManager.ensureLoaded()
  const summaries = sessionManager.getSessions()
  const out: SessionTurnUsage[] = []
  for (const s of summaries) {
    const updatedMs = Date.parse(s.updatedAt || s.createdAt)
    if (Number.isFinite(updatedMs) && updatedMs < windowStartMs) continue
    // Fallbacks from the session's current settings (a legacy turn omits the
    // per-turn fields). provider/accountId are non-secret ids only.
    const fallbackProvider = s.settings?.provider ?? 'anthropic'
    const fallbackModel = s.settings?.modelId ?? ''
    const fallbackAccountId = s.settings?.accountId ?? UNKNOWN_ACCOUNT_ID
    // Best-effort: skip a session whose transcript can't be read (infosec F1).
    let messages: SessionMessage[]
    try {
      messages = readSessionMessages(sessionFilePath(s.id))
    } catch (err) {
      log.warn('activity: failed to read session tail', {
        sessionId: s.id,
        err: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    const seen = new Set<string>()
    for (const msg of messages) {
      if (msg.role !== 'agent' || !msg.usage) continue
      if (seen.has(msg.id)) continue
      seen.add(msg.id)
      const at = messageTimeMs(msg)
      if (!Number.isFinite(at) || at < windowStartMs || at > windowEndMs) continue
      const inputTokens = msg.usage.inputTokens || 0
      const outputTokens = msg.usage.outputTokens || 0
      const cacheReadTokens = msg.usage.cacheReadTokens || 0
      const cacheWriteTokens = msg.usage.cacheWriteTokens || 0
      if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0) continue
      out.push({
        at,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        provider: fallbackProvider,
        model: msg.modelUsed || fallbackModel,
        accountId: msg.accountId ?? fallbackAccountId,
        sessionId: s.id,
        projectId: s.projectId ?? '',
      })
    }
  }
  return out
}
