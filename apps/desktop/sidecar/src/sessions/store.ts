// Event-sourced session storage. Each session lives in its own JSONL file at
// ~/.awog/sessions/<sessionId>.jsonl — every line is exactly one append-only
// SessionEvent. Snapshots are derived by folding the event log on load; this
// keeps writes O(1) and crash-safe (partial last line is skipped by fold).
//
// Delete is logical: a `session.deleted` event marks the file as tombstoned
// but the file itself is preserved for forensics. A future `sessions.purge`
// command can physically remove tombstoned files.

import { mkdir, readdir, readFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import type { Session, SessionMessage } from '../types/shared.js'

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
  // Drop every message AFTER `keepThroughId` (inclusive of that message — it is
  // kept). `null` empties the transcript. Backs edit-and-resend / regenerate
  // (sessions.truncate RPC) and the conversation half of Rewind. Append-only:
  // the dropped lines stay in the file but the fold rebuilds the shorter list.
  | { type: 'session.truncated'; at: string; keepThroughId: string | null }
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

function fold(events: SessionEvent[]): Session | null {
  let snapshot: Session | null = null
  let deleted = false
  for (const e of events) {
    if (e.type === 'session.created') {
      snapshot = { ...e.session, messages: [...(e.session.messages ?? [])] }
    } else if (e.type === 'session.metadata.updated') {
      if (!snapshot) continue
      const current: Session = snapshot
      snapshot = { ...current, ...e.patch, updatedAt: e.at }
    } else if (e.type === 'message.appended') {
      if (!snapshot) continue
      const current: Session = snapshot
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
      snapshot = { ...current, messages, updatedAt: e.at }
    } else if (e.type === 'session.truncated') {
      if (!snapshot) continue
      const current: Session = snapshot
      if (e.keepThroughId === null) {
        snapshot = { ...current, messages: [], updatedAt: e.at }
      } else {
        const idx = current.messages.findIndex((m) => m.id === e.keepThroughId)
        // Unknown id → no-op (never silently drop the whole transcript on a
        // stale/garbage event). Found → keep up to and including it.
        if (idx >= 0) {
          snapshot = { ...current, messages: current.messages.slice(0, idx + 1), updatedAt: e.at }
        }
      }
    } else if (e.type === 'session.deleted') {
      deleted = true
    }
  }
  return deleted ? null : snapshot
}

async function readEvents(file: string): Promise<SessionEvent[]> {
  const raw = await readFile(file, 'utf8')
  const lines = raw.split('\n')
  const out: SessionEvent[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const evt = parseLine(lines[i] ?? '', file, i + 1)
    if (evt) out.push(evt)
  }
  return out
}

export async function loadSession(id: string): Promise<Session | null> {
  const file = sessionFile(id)
  try {
    const events = await readEvents(file)
    return fold(events)
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

export async function listSessions(): Promise<Session[]> {
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
      const events = await readEvents(file)
      const snap = fold(events)
      if (snap) sessions.push(snap)
    } catch (err) {
      log.warn('jsonl: failed to read session file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Newest first. updatedAt is ISO-8601 so lexicographic sort matches time order.
  sessions.sort((a, b) => {
    const ta = a.updatedAt || a.createdAt
    const tb = b.updatedAt || b.createdAt
    if (ta === tb) return 0
    return ta < tb ? 1 : -1
  })
  return sessions
}

export async function appendEvent(sessionId: string, evt: SessionEvent): Promise<void> {
  await withLock(sessionId, async () => {
    await ensureDir()
    const file = sessionFile(sessionId)
    await appendFile(file, `${JSON.stringify(evt)}\n`, { encoding: 'utf8', mode: 0o600 })
  })
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

export async function deleteSession(id: string): Promise<void> {
  const evt: SessionEvent = {
    type: 'session.deleted',
    at: new Date().toISOString(),
  }
  await appendEvent(id, evt)
}
