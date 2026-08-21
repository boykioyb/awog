// In-memory session manager for the single-file JSONL storage model
// (craft-parity core — see sessions/jsonl.ts + sessions/persistence-queue.ts).
//
// Holds a Map of session id → ManagedSession. On startup loadAllFromDisk()
// populates the map metadata-only (header line per file) so the list is instant
// and memory stays flat; a session's messages are lazy-loaded on first getSession
// and then kept resident. All mutations go through the debounced persistence
// queue. This is the NEW storage core built ALONGSIDE the event-sourced store.ts
// and is NOT yet wired to any RPC.

import { readdir, rm } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { log } from '../util/logger.js'
import type { Session, SessionMessage, SessionSummary, SessionHeader } from '../types/shared.js'
import {
  createSessionHeader,
  readSessionHeader,
  readSessionMessages,
  sessionDir,
  sessionFilePath,
  sessionsDir,
} from './jsonl.js'
import { sessionPersistenceQueue } from './persistence-queue.js'
import { migrateLegacySessions } from './migrate-legacy.js'

// Metadata a caller may patch on an existing session. Mirrors the event-sourced
// store's SessionMetadataPatch (intentional duplication for this additive phase).
type SessionMetadataPatch = Partial<
  Pick<
    Session,
    | 'title'
    | 'pinned'
    | 'projectId'
    | 'settings'
    | 'invitedAgentIds'
    | 'pendingAgentIds'
    | 'disabledTools'
    | 'mcpServerIds'
    | 'aboutTaskId'
    | 'aboutSshHostId'
    | 'aboutGhUrl'
    | 'pinnedContext'
    | 'workspaceFolder'
    | 'budget'
    | 'parentSessionId'
    | 'forkFromMessageId'
    | 'sdkSessionId'
    | 'compaction'
    | 'todos'
  >
>

// One resident session: its header (metadata + pre-computed list fields) plus its
// messages, which are loaded lazily. `messagesLoaded` guards the cold-persist
// hydration so a metadata-only entry never writes an empty transcript over disk.
type ManagedSession = {
  header: SessionHeader
  messages: SessionMessage[]
  messagesLoaded: boolean
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Newest first. updatedAt is ISO-8601 so a lexicographic compare matches time order.
function byUpdatedDesc(
  a: { updatedAt: string; createdAt: string },
  b: { updatedAt: string; createdAt: string },
): number {
  const ta = a.updatedAt || a.createdAt
  const tb = b.updatedAt || b.createdAt
  if (ta === tb) return 0
  return ta < tb ? 1 : -1
}

// Reconstruct the full Session from a ManagedSession: drop the 4 pre-computed
// header fields (leaving Omit<Session, 'messages'>) and attach a SHALLOW COPY of the
// messages. The copy (reviewer #6) stops a consumer that mutates `session.messages`
// (push/splice) from corrupting the warm cache, and gives the persistence queue a
// stable snapshot that later streaming mutations can't tear.
function managedToSession(m: ManagedSession): Session {
  const { messageCount: _mc, preview: _pv, status: _st, lastPreview: _lp, ...meta } = m.header
  return { ...meta, messages: [...m.messages] }
}

// Project a header to the list-row SessionSummary WITHOUT touching messages —
// mirrors the event-sourced store's summarize(), reading the pre-computed fields.
function summarizeHeader(h: SessionHeader): SessionSummary {
  const summary: SessionSummary = {
    id: h.id,
    title: h.title,
    projectId: h.projectId,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    invitedAgentIds: h.invitedAgentIds ?? [],
    pendingAgentIds: h.pendingAgentIds ?? [],
    settings: h.settings,
    messageCount: h.messageCount,
    status: h.status,
  }
  if (h.pinned !== undefined) summary.pinned = h.pinned
  if (h.disabledTools !== undefined) summary.disabledTools = h.disabledTools
  if (h.mcpServerIds !== undefined) summary.mcpServerIds = h.mcpServerIds
  if (h.aboutTaskId !== undefined) summary.aboutTaskId = h.aboutTaskId
  if (h.aboutSshHostId !== undefined) summary.aboutSshHostId = h.aboutSshHostId
  if (h.aboutGhUrl !== undefined) summary.aboutGhUrl = h.aboutGhUrl
  if (h.parentSessionId !== undefined) summary.parentSessionId = h.parentSessionId
  if (h.compaction) summary.hasCompaction = true
  if (h.lastPreview) summary.lastPreview = h.lastPreview
  return summary
}

class SessionManager {
  private sessions = new Map<string, ManagedSession>()
  // Deduplicate concurrent lazy loads of the same session's messages.
  private messageLoadingPromises = new Map<string, Promise<void>>()
  // Single-flight guard for the one-time boot init (migration + loadAllFromDisk).
  private initPromise: Promise<void> | null = null

  // Idempotent boot init: migrate any legacy event logs to the new format, then
  // load all headers into the map — exactly once. The facade (sessions/store.ts)
  // awaits this before every read/list/mutation so the Map is always populated
  // (and loadAllFromDisk's clear() has already run) regardless of boot ordering.
  async ensureLoaded(): Promise<void> {
    if (!this.initPromise) {
      const promise = (async () => {
        try {
          await migrateLegacySessions()
        } catch (err) {
          // Migration is best-effort — never block loading over a bad legacy file.
          log.error('session-manager: legacy migration failed, continuing with load', {
            err: err instanceof Error ? err.message : String(err),
          })
        }
        await this.loadAllFromDisk()
      })()
      this.initPromise = promise
      // If the load itself rejects, clear the guard so a later call can retry —
      // a rejected promise cached forever would wedge every list/get.
      promise.catch(() => {
        if (this.initPromise === promise) this.initPromise = null
      })
    }
    return this.initPromise
  }

  // Scan the sessions dir and populate the map metadata-only. Each session lives in
  // its own folder ({id}/session.jsonl); we read only the header line of each. Non-dir
  // entries (leftover .bak/.tmp, the removed index.json) and folders whose session.jsonl
  // is missing/corrupt/old-format are skipped. Legacy + interim flat files have been
  // converted to folders by ensureLoaded's migration before this runs.
  async loadAllFromDisk(): Promise<void> {
    this.sessions.clear()
    let entries: Dirent[]
    try {
      entries = await readdir(sessionsDir(), { withFileTypes: true })
    } catch (err) {
      if (isMissing(err)) return
      throw err
    }
    let loaded = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // readSessionHeader returns null when the folder has no session.jsonl (ENOENT)
      // or carries a corrupt/old-format header → skip it.
      const header = readSessionHeader(sessionFilePath(entry.name))
      if (!header) continue
      this.sessions.set(header.id, { header, messages: [], messagesLoaded: false })
      loaded += 1
    }
    log.info('session-manager: loaded sessions from disk (metadata only)', { count: loaded })
  }

  // List projection — from the resident map only, no disk read.
  getSessions(): SessionSummary[] {
    return [...this.sessions.values()].map((m) => summarizeHeader(m.header)).sort(byUpdatedDesc)
  }

  // Full session with messages. Lazy-loads the transcript on first access.
  async getSession(id: string): Promise<Session | null> {
    const m = this.sessions.get(id)
    if (!m) return null
    await this.ensureMessagesLoaded(m)
    return managedToSession(m)
  }

  // Load messages once; concurrent callers share the in-flight promise.
  private async ensureMessagesLoaded(m: ManagedSession): Promise<void> {
    if (m.messagesLoaded) return
    const existing = this.messageLoadingPromises.get(m.header.id)
    if (existing) return existing
    const loadPromise = this.loadMessagesFromDisk(m)
    this.messageLoadingPromises.set(m.header.id, loadPromise)
    try {
      await loadPromise
    } finally {
      this.messageLoadingPromises.delete(m.header.id)
    }
  }

  private async loadMessagesFromDisk(m: ManagedSession): Promise<void> {
    // readSessionMessages returns [] for a MISSING file but THROWS on a real read
    // error (infosec F1). On a throw, messagesLoaded stays false here and the error
    // propagates — the cold-persist guard then keeps refusing to overwrite the
    // transcript with an empty snapshot.
    m.messages = readSessionMessages(sessionFilePath(m.header.id))
    m.messagesLoaded = true
  }

  // Create a new session and persist it. Flushed immediately (not just debounced) so a
  // brand-new session is durable at once — otherwise a quit within the 500ms debounce
  // window would lose it (ADR 0062 D-2, reviewer #1/#3).
  async createSession(session: Session): Promise<void> {
    const managed: ManagedSession = {
      header: createSessionHeader(session),
      messages: [...session.messages],
      messagesLoaded: true,
    }
    this.sessions.set(session.id, managed)
    this.persistSession(managed)
    await sessionPersistenceQueue.flush(session.id)
  }

  // Patch an existing session's metadata, bump updatedAt, and persist. Messages
  // are untouched (the cold-persist guard hydrates them before the write so a
  // metadata-only entry never clobbers the transcript).
  async updateMetadata(id: string, patch: SessionMetadataPatch): Promise<void> {
    const m = this.sessions.get(id)
    if (!m) {
      log.warn('session-manager: updateMetadata on unknown session', { id })
      return
    }
    m.header = { ...m.header, ...patch, updatedAt: new Date().toISOString() }
    this.persistSession(m)
  }

  // Append (or upsert-by-id) a message and persist. Upsert-by-id matches the
  // event-sourced store's fold: a turn is written user → partial → final under
  // the same id, so replacing in place keeps ordering and last-write-wins.
  async appendMessage(id: string, message: SessionMessage): Promise<void> {
    const m = this.sessions.get(id)
    if (!m) {
      log.warn('session-manager: appendMessage on unknown session', { id })
      return
    }
    await this.ensureMessagesLoaded(m)
    const idx = m.messages.findIndex((x) => x.id === message.id)
    if (idx >= 0) m.messages[idx] = message
    else m.messages.push(message)
    // Recompute the pre-computed header fields (messageCount/preview/status/
    // lastPreview) and bump updatedAt from the new message set.
    m.header = createSessionHeader({ ...managedToSession(m), updatedAt: new Date().toISOString() })
    this.persistSession(m)
  }

  // Replace the full in-memory snapshot for a session and persist. Used when the
  // caller already holds an authoritative Session (e.g. after a truncate/compact).
  // Flushed immediately so a truncation/compaction is durable at once (ADR 0062 D-2).
  async saveSession(session: Session): Promise<void> {
    const managed: ManagedSession = {
      header: createSessionHeader({ ...session, updatedAt: new Date().toISOString() }),
      messages: [...session.messages],
      messagesLoaded: true,
    }
    this.sessions.set(session.id, managed)
    this.persistSession(managed)
    await sessionPersistenceQueue.flush(session.id)
  }

  // Physically delete a session: cancel any pending debounced write, recursively
  // remove the whole {id}/ folder (session.jsonl + attachments/), and drop it from the
  // map. Unlike the old event-sourced store (logical tombstone), this removes the files
  // — no purge step is needed. `force: true` makes a missing folder a no-op.
  async deleteSession(id: string): Promise<void> {
    sessionPersistenceQueue.cancel(id)
    try {
      await rm(sessionDir(id), { recursive: true, force: true })
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('session-manager: failed to remove session folder on delete', {
          id,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
    this.sessions.delete(id)
  }

  // Build the snapshot and hand it to the queue. Cold guard: if messages haven't
  // been lazy-loaded, hydrate them from disk FIRST — otherwise the snapshot would
  // write an empty messages[] over the real transcript. The read is synchronous, so
  // there is no microtask gap between hydrate and enqueue. If the hydrating read fails
  // (a real read error, not a missing file), readSessionMessages THROWS (infosec F1) —
  // we let it propagate so we abort the write rather than persist an empty transcript.
  private persistSession(m: ManagedSession): void {
    if (!m.messagesLoaded) {
      m.messages = readSessionMessages(sessionFilePath(m.header.id))
      m.messagesLoaded = true
    }
    sessionPersistenceQueue.enqueue(managedToSession(m))
  }

  // Flush a specific session's pending write immediately (call on close/switch).
  async flush(id: string): Promise<void> {
    await sessionPersistenceQueue.flush(id)
  }

  // Flush all pending writes (call on app quit).
  async flushAll(): Promise<void> {
    await sessionPersistenceQueue.flushAll()
  }
}

// Singleton — the future RPC layer will drive this instance.
export const sessionManager = new SessionManager()

export { SessionManager }
export type { ManagedSession, SessionMetadataPatch }
