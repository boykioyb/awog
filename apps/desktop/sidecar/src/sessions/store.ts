// Event-sourced session storage. Each session lives in its own JSONL file at
// ~/.awog/sessions/<sessionId>.jsonl — every line is exactly one append-only
// SessionEvent. Snapshots are derived by folding the event log on load; this
// keeps writes O(1) and crash-safe (partial last line is skipped by fold).
//
// Delete is logical: a `session.deleted` event marks the file as tombstoned
// but the file itself is preserved for forensics. A future `sessions.purge`
// command can physically remove tombstoned files.

import { mkdir, readdir, appendFile, readFile, writeFile, rename } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import type {
  Session,
  SessionCompaction,
  SessionMessage,
  SessionStep,
  SessionSummary,
} from '../types/shared.js'

type SessionMetadataPatch = Partial<
  Pick<
    Session,
    | 'title'
    | 'pinned'
    | 'projectId'
    | 'settings'
    | 'invitedAgentIds'
    | 'disabledTools'
    | 'mcpServerIds'
  >
>

export type SessionEvent =
  | { type: 'session.created'; at: string; session: Session }
  | { type: 'session.metadata.updated'; at: string; patch: SessionMetadataPatch }
  | { type: 'message.appended'; at: string; message: SessionMessage }
  // Byte-minimal mid-stream partial (root fix for O(steps²) JSONL bloat). Carries
  // ONLY the text + steps appended SINCE the previous progress event for this
  // message id — never the whole growing message. The final `message.appended`
  // (same id) then replaces the delta-accumulated partial with the authoritative
  // snapshot. Pre-fix every throttled snapshot re-serialised the full steps[]
  // array, so one 491-step turn grew a session file to 1.2 GB — past V8's max
  // string length, which made the file unreadable and the session vanish from
  // the UI list. Crash-safety is preserved: a hard kill mid-turn leaves the
  // accumulated deltas, which the fold replays into a partial reply.
  | { type: 'message.progress'; at: string; id: string; textDelta?: string; steps?: SessionStep[] }
  // Drop every message AFTER `keepThroughId` (inclusive of that message — it is
  // kept). `null` empties the transcript. Backs edit-and-resend / regenerate
  // (sessions.truncate RPC) and the conversation half of Rewind. Append-only:
  // the dropped lines stay in the file but the fold rebuilds the shorter list.
  | { type: 'session.truncated'; at: string; keepThroughId: string | null }
  // Context-compaction checkpoint (ADR 0047). Records the summary of older turns
  // and the id of the first message kept verbatim. Does NOT touch `messages` —
  // the full transcript stays for the UI; only the model context is cut (in
  // buildContext). Latest event wins (a later compaction subsumes the prior).
  | { type: 'session.compacted'; at: string; compaction: SessionCompaction }
  | { type: 'session.deleted'; at: string }

const SESSIONS_DIR_NAME = sanitizeChild('sessions')

function sessionsDir(): string {
  return join(awogHome(), SESSIONS_DIR_NAME)
}

function sessionFile(id: string): string {
  // sanitizeChild rejects '/', '\\', '..'. Defence in depth even though
  // callers should already validate sessionId at the RPC boundary.
  const safe = sanitizeChild(id)
  return join(sessionsDir(), `${safe}.jsonl`)
}

async function ensureDir(): Promise<void> {
  await mkdir(sessionsDir(), { recursive: true, mode: 0o700 })
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Per-session in-memory lock to serialise concurrent appends from the same
// process. Node fs append is atomic per write on POSIX up to PIPE_BUF, but we
// also do read-then-fold elsewhere and want a consistent ordering guarantee.
const SESSION_LOCKS = new Map<string, Promise<unknown>>()

async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = SESSION_LOCKS.get(id) ?? Promise.resolve()
  const next = prev.then(fn, fn) as Promise<T>
  SESSION_LOCKS.set(id, next)
  try {
    return await next
  } finally {
    if (SESSION_LOCKS.get(id) === next) SESSION_LOCKS.delete(id)
  }
}

function parseLine(line: string, file: string, lineNo: number): SessionEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as SessionEvent
  } catch (err) {
    log.warn('jsonl: bad line skipped', {
      file,
      lineNo,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

type FoldState = { snapshot: Session | null; deleted: boolean }

// Apply one event to the running fold state, in place. Extracted so the same
// reducer drives both the in-memory `fold` and the streaming `foldFile`.
function applyEvent(state: FoldState, e: SessionEvent): void {
  if (e.type === 'session.created') {
    state.snapshot = { ...e.session, messages: [...(e.session.messages ?? [])] }
  } else if (e.type === 'session.metadata.updated') {
    if (!state.snapshot) return
    state.snapshot = { ...state.snapshot, ...e.patch, updatedAt: e.at }
  } else if (e.type === 'message.appended') {
    if (!state.snapshot) return
    const current = state.snapshot
    // Upsert by message id. A turn may be appended several times — the user
    // message once, then the assistant message as partial → … → final snapshot
    // (same id) so a cancel/crash mid-stream still persists the truncated
    // reply. Replacing in place keeps order; last write wins. Legacy logs have
    // a unique id per event, so this collapses to a plain push for them.
    const idx = current.messages.findIndex((m) => m.id === e.message.id)
    const messages =
      idx >= 0
        ? current.messages.map((m, i) => (i === idx ? e.message : m))
        : [...current.messages, e.message]
    state.snapshot = { ...current, messages, updatedAt: e.at }
  } else if (e.type === 'message.progress') {
    if (!state.snapshot) return
    const current = state.snapshot
    const idx = current.messages.findIndex((m) => m.id === e.id)
    // Lazily materialise the assistant message on the first delta so a crash
    // before any `message.appended` still surfaces the partial reply.
    const base: SessionMessage =
      idx >= 0 ? current.messages[idx] : { id: e.id, role: 'agent', text: '', at: e.at }
    let steps = base.steps
    if (e.steps && e.steps.length) {
      // Merge step deltas by id (a running → done re-emit replaces in place).
      const merged = [...(base.steps ?? [])]
      for (const s of e.steps) {
        const si = merged.findIndex((x) => x.id === s.id)
        if (si >= 0) merged[si] = s
        else merged.push(s)
      }
      steps = merged
    }
    const next: SessionMessage = {
      ...base,
      text: (base.text ?? '') + (e.textDelta ?? ''),
      at: e.at,
      ...(steps && steps.length ? { steps } : {}),
    }
    const messages =
      idx >= 0
        ? current.messages.map((m, i) => (i === idx ? next : m))
        : [...current.messages, next]
    state.snapshot = { ...current, messages, updatedAt: e.at }
  } else if (e.type === 'session.truncated') {
    if (!state.snapshot) return
    const current = state.snapshot
    if (e.keepThroughId === null) {
      state.snapshot = { ...current, messages: [], updatedAt: e.at }
    } else {
      const idx = current.messages.findIndex((m) => m.id === e.keepThroughId)
      // Unknown id → no-op (never silently drop the whole transcript on a
      // stale/garbage event). Found → keep up to and including it.
      if (idx >= 0) {
        state.snapshot = { ...current, messages: current.messages.slice(0, idx + 1), updatedAt: e.at }
      }
    }
  } else if (e.type === 'session.compacted') {
    if (!state.snapshot) return
    const current = state.snapshot
    // Defence: only accept a checkpoint whose cut point still exists in the
    // transcript (never strand the runtime on a dangling id). Messages stay
    // untouched — the cut is applied in buildContext, not here.
    const known = current.messages.some((m) => m.id === e.compaction.firstKeptMessageId)
    if (known) state.snapshot = { ...current, compaction: e.compaction, updatedAt: e.at }
  } else if (e.type === 'session.deleted') {
    state.deleted = true
  }
}

// Stream the JSONL line-by-line and fold incrementally. Streaming (not
// `readFile(..., 'utf8')`) is mandatory: a single string is capped at V8's
// MAX_STRING_LENGTH (~512 MB), so a large session file would throw
// `Invalid string length` and — caught in listSessions — silently disappear
// from the UI. readline also bounds peak memory to the folded snapshot, not the
// whole file.
async function foldFile(file: string): Promise<Session | null> {
  const state: FoldState = { snapshot: null, deleted: false }
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let lineNo = 0
  for await (const line of rl) {
    lineNo += 1
    const evt = parseLine(line, file, lineNo)
    if (evt) applyEvent(state, evt)
  }
  return state.deleted ? null : state.snapshot
}

export async function loadSession(id: string): Promise<Session | null> {
  const file = sessionFile(id)
  try {
    return await foldFile(file)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

// Newest first. updatedAt is ISO-8601 so lexicographic sort matches time order.
function byUpdatedDesc(a: { updatedAt: string; createdAt: string }, b: typeof a): number {
  const ta = a.updatedAt || a.createdAt
  const tb = b.updatedAt || b.createdAt
  if (ta === tb) return 0
  return ta < tb ? 1 : -1
}

// Fold EVERY session file into a full Session (with messages). Heavy — reads all
// transcripts — so this is for on-demand full-text search only (sessions.search).
// The list/startup path uses listSessionSummaries (the index) instead (ADR 0048).
export async function listFullSessions(): Promise<Session[]> {
  let entries: string[]
  try {
    entries = await readdir(sessionsDir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const sessions: Session[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const file = join(sessionsDir(), name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const snap = await foldFile(file)
      if (snap) sessions.push(snap)
    } catch (err) {
      log.warn('jsonl: failed to read session file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  sessions.sort(byUpdatedDesc)
  return sessions
}

// ─── Session index (ADR 0048) ──────────────────────────────────────────────
// Derived cache of SessionSummary[] at ~/.awog/sessions/index.json so the list
// reads KB instead of folding every transcript. Updated incrementally on
// appendEvent; rebuilt by folding all files only when missing/corrupt.

const INDEX_FILE_NAME = 'index.json'
const PREVIEW_MAX = 140

function indexFile(): string {
  return join(sessionsDir(), INDEX_FILE_NAME)
}

function summarize(s: Session): SessionSummary {
  const last = s.messages[s.messages.length - 1]
  const summary: SessionSummary = {
    id: s.id,
    title: s.title,
    projectId: s.projectId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    invitedAgentIds: s.invitedAgentIds ?? [],
    pendingAgentIds: s.pendingAgentIds ?? [],
    settings: s.settings,
    messageCount: s.messages.length,
  }
  if (s.pinned !== undefined) summary.pinned = s.pinned
  if (s.disabledTools !== undefined) summary.disabledTools = s.disabledTools
  if (s.mcpServerIds !== undefined) summary.mcpServerIds = s.mcpServerIds
  if (s.compaction) summary.hasCompaction = true
  if (last?.text) summary.lastPreview = last.text.slice(0, PREVIEW_MAX)
  return summary
}

// In-memory authoritative copy once loaded; null = not yet loaded this process.
let indexCache: Map<string, SessionSummary> | null = null
// Serialise writes to the single shared index.json (cross-session).
let indexFlushChain: Promise<unknown> = Promise.resolve()

function flushIndex(): Promise<void> {
  const snapshot = indexCache ? [...indexCache.values()] : []
  const next = indexFlushChain.then(async () => {
    await ensureDir()
    const tmp = `${indexFile()}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, indexFile())
  })
  indexFlushChain = next.catch(() => undefined)
  return next
}

async function rebuildIndex(): Promise<Map<string, SessionSummary>> {
  const map = new Map<string, SessionSummary>()
  let entries: string[]
  try {
    entries = await readdir(sessionsDir())
  } catch (err) {
    if (isMissing(err)) {
      indexCache = map
      return map
    }
    throw err
  }
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const file = join(sessionsDir(), name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const snap = await foldFile(file)
      if (snap) map.set(snap.id, summarize(snap))
    } catch (err) {
      log.warn('index: failed to fold session during rebuild', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  indexCache = map
  await flushIndex()
  return map
}

async function loadIndex(): Promise<Map<string, SessionSummary>> {
  if (indexCache) return indexCache
  let raw: string
  try {
    raw = await readFile(indexFile(), 'utf8')
  } catch (err) {
    if (isMissing(err)) return rebuildIndex()
    throw err
  }
  try {
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) throw new Error('index.json is not an array')
    const map = new Map<string, SessionSummary>()
    for (const s of arr as SessionSummary[]) {
      if (s && typeof s.id === 'string') map.set(s.id, s)
    }
    indexCache = map
    return map
  } catch (err) {
    log.warn('index: corrupt index.json, rebuilding', {
      err: err instanceof Error ? err.message : String(err),
    })
    return rebuildIndex()
  }
}

// Apply one just-appended event to the in-memory index, then flush. Mirrors
// applyEvent but only the list projection. Rare events (truncate/compact) re-fold
// the one file for an exact messageCount. Returns without flushing for events
// that don't affect the list (e.g. message.progress).
async function touchIndex(sessionId: string, evt: SessionEvent): Promise<void> {
  const map = await loadIndex()
  const prev = map.get(sessionId)
  if (evt.type === 'session.created') {
    map.set(evt.session.id, summarize({ ...evt.session, messages: evt.session.messages ?? [] }))
  } else if (evt.type === 'session.metadata.updated') {
    if (!prev) return
    map.set(sessionId, {
      ...prev,
      ...(evt.patch.title !== undefined ? { title: evt.patch.title } : {}),
      ...(evt.patch.projectId !== undefined ? { projectId: evt.patch.projectId } : {}),
      ...(evt.patch.settings !== undefined ? { settings: evt.patch.settings } : {}),
      ...(evt.patch.pinned !== undefined ? { pinned: evt.patch.pinned } : {}),
      ...(evt.patch.invitedAgentIds !== undefined
        ? { invitedAgentIds: evt.patch.invitedAgentIds }
        : {}),
      ...(evt.patch.disabledTools !== undefined ? { disabledTools: evt.patch.disabledTools } : {}),
      ...(evt.patch.mcpServerIds !== undefined ? { mcpServerIds: evt.patch.mcpServerIds } : {}),
      updatedAt: evt.at,
    })
  } else if (evt.type === 'message.appended') {
    if (!prev) return
    map.set(sessionId, {
      ...prev,
      updatedAt: evt.at,
      messageCount: prev.messageCount + 1,
      ...(evt.message.text ? { lastPreview: evt.message.text.slice(0, PREVIEW_MAX) } : {}),
    })
  } else if (evt.type === 'session.truncated' || evt.type === 'session.compacted') {
    const snap = await foldFile(sessionFile(sessionId))
    if (snap) map.set(sessionId, summarize(snap))
    else map.delete(sessionId)
  } else if (evt.type === 'session.deleted') {
    map.delete(sessionId)
  } else {
    return // message.progress / anything else: not list-relevant
  }
  await flushIndex()
}

export async function listSessionSummaries(): Promise<SessionSummary[]> {
  const map = await loadIndex()
  return [...map.values()].sort(byUpdatedDesc)
}

export async function appendEvent(sessionId: string, evt: SessionEvent): Promise<void> {
  await withLock(sessionId, async () => {
    await ensureDir()
    const file = sessionFile(sessionId)
    await appendFile(file, `${JSON.stringify(evt)}\n`, { encoding: 'utf8', mode: 0o600 })
  })
  // Keep the list index in sync (ADR 0048), after the event is durably appended.
  // Best-effort: the index is a derived cache, so a failure here never blocks the
  // write — listSessionSummaries can always rebuild from the JSONL files.
  try {
    await touchIndex(sessionId, evt)
  } catch (err) {
    log.warn('index: touch failed', {
      sessionId,
      type: evt.type,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function createSession(session: Session): Promise<void> {
  const evt: SessionEvent = {
    type: 'session.created',
    at: new Date().toISOString(),
    session,
  }
  await appendEvent(session.id, evt)
}

export async function updateSessionMetadata(
  id: string,
  patch: SessionMetadataPatch,
): Promise<void> {
  const evt: SessionEvent = {
    type: 'session.metadata.updated',
    at: new Date().toISOString(),
    patch,
  }
  await appendEvent(id, evt)
}

export async function appendMessage(sessionId: string, message: SessionMessage): Promise<void> {
  // Guard against persisting messages for a session that was never created
  // (or already tombstoned). This is a soft check — we re-fold the file —
  // not authoritative. Race scenario is documented in sessions.send-message.ts.
  const existing = await loadSession(sessionId)
  if (!existing) {
    log.warn('appendMessage: session not found or deleted, skipping', { sessionId })
    return
  }
  const evt: SessionEvent = {
    type: 'message.appended',
    at: new Date().toISOString(),
    message,
  }
  await appendEvent(sessionId, evt)
}

export async function truncateSession(
  sessionId: string,
  keepThroughId: string | null,
): Promise<void> {
  // Soft guard like appendMessage: don't append a truncate for a session that
  // was never created or is already tombstoned.
  const existing = await loadSession(sessionId)
  if (!existing) {
    log.warn('truncateSession: session not found or deleted, skipping', { sessionId })
    return
  }
  const evt: SessionEvent = {
    type: 'session.truncated',
    at: new Date().toISOString(),
    keepThroughId,
  }
  await appendEvent(sessionId, evt)
}

// Persist a context-compaction checkpoint (ADR 0047). `at` is taken from the
// caller-supplied compaction so the event time and the snapshot field agree.
export async function compactSession(
  sessionId: string,
  compaction: SessionCompaction,
): Promise<void> {
  // Soft guard like appendMessage / truncateSession.
  const existing = await loadSession(sessionId)
  if (!existing) {
    log.warn('compactSession: session not found or deleted, skipping', { sessionId })
    return
  }
  const evt: SessionEvent = {
    type: 'session.compacted',
    at: compaction.at,
    compaction,
  }
  await appendEvent(sessionId, evt)
}

export async function deleteSession(id: string): Promise<void> {
  const evt: SessionEvent = {
    type: 'session.deleted',
    at: new Date().toISOString(),
  }
  await appendEvent(id, evt)
}
