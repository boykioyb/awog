// Debounced, coalescing, per-session-serialized persistence queue for the
// single-file JSONL storage model (craft-parity core — see sessions/jsonl.ts).
//
// Rapid successive persist calls for one session collapse into a single async write
// (debounce). Both the debounce timer AND an explicit flush() go through the same
// per-session serialized path (writeInProgress chain), so a timer write and a flush
// can NEVER race on the shared .tmp file (reviewer #2), and flush()/flushAll() always
// await an in-flight write. Writes are atomic (tmp → rename, POSIX-atomic — infosec F2).

import { writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { log } from '../util/logger.js'
import type { Session, SessionHeader } from '../types/shared.js'
import {
  attachmentsDir,
  createSessionHeader,
  readSessionHeader,
  serializeSessionJsonl,
  sessionFilePath,
} from './jsonl.js'

const DEBOUNCE_MS = 500

type PendingWrite = {
  data: Session
  timer: ReturnType<typeof setTimeout>
}

// User/watcher-editable metadata a queued write must not clobber if it changed on disk
// (external edit) since our last write. Fields are required-but-nullable (not optional)
// so the literal can carry explicit `undefined` under exactOptionalPropertyTypes;
// JSON.stringify drops undefined-valued keys, keeping the signature stable.
type HeaderMetadataSignature = {
  title: string
  pinned: boolean | undefined
  projectId: string | null
  disabledTools: string[] | undefined
  mcpServerIds: string[] | undefined
  aboutTaskId: string | undefined
  aboutGhUrl: string | undefined
}

function headerMetadataSignature(header: SessionHeader): string {
  const sig: HeaderMetadataSignature = {
    title: header.title,
    pinned: header.pinned,
    projectId: header.projectId,
    disabledTools: header.disabledTools,
    mcpServerIds: header.mcpServerIds,
    aboutTaskId: header.aboutTaskId,
    aboutGhUrl: header.aboutGhUrl,
  }
  return JSON.stringify(sig)
}

// Overlay the disk header's user-editable metadata onto the locally-computed header,
// preserving everything else local. Optional fields are copied only when present on
// disk — exactOptionalPropertyTypes forbids assigning `undefined` to an optional prop,
// so a disk edit that CLEARS a flag keeps the local value (an accepted minor deviation).
function mergeHeaderWithExternalMetadata(
  local: SessionHeader,
  disk: SessionHeader,
): SessionHeader {
  return {
    ...local,
    title: disk.title,
    projectId: disk.projectId,
    ...(disk.pinned !== undefined ? { pinned: disk.pinned } : {}),
    ...(disk.disabledTools !== undefined ? { disabledTools: disk.disabledTools } : {}),
    ...(disk.mcpServerIds !== undefined ? { mcpServerIds: disk.mcpServerIds } : {}),
    ...(disk.aboutTaskId !== undefined ? { aboutTaskId: disk.aboutTaskId } : {}),
    ...(disk.aboutGhUrl !== undefined ? { aboutGhUrl: disk.aboutGhUrl } : {}),
  }
}

class SessionPersistenceQueue {
  private pending = new Map<string, PendingWrite>()
  // In-flight write promise per session — flush() chains after it so writes are
  // serialized and a caller can always await the latest write for an id.
  private writeInProgress = new Map<string, Promise<void>>()
  private lastWrittenHeaderSignature = new Map<string, string>()
  private readonly debounceMs: number

  constructor(debounceMs = DEBOUNCE_MS) {
    this.debounceMs = debounceMs
  }

  // Queue a session for persistence. A pending write for the same session is replaced
  // with the new data and its debounce timer reset (coalescing). The timer goes through
  // flush() (not a bare write) so it stays on the serialized path.
  enqueue(session: Session): void {
    const existing = this.pending.get(session.id)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      void this.flush(session.id)
    }, this.debounceMs)

    this.pending.set(session.id, { data: session, timer })
  }

  // Flush a session's pending write immediately, serialized per session: chain after
  // any in-flight write (so we never race the shared .tmp), then write whatever is
  // pending. Both the debounce timer and explicit callers use this single path.
  async flush(sessionId: string): Promise<void> {
    const prior = this.writeInProgress.get(sessionId) ?? Promise.resolve()
    const run = prior.catch(() => {}).then(() => this.writePending(sessionId))
    this.writeInProgress.set(sessionId, run)
    try {
      await run
    } finally {
      if (this.writeInProgress.get(sessionId) === run) this.writeInProgress.delete(sessionId)
    }
  }

  // Write the currently-pending snapshot for a session (no-op if nothing pending).
  // NEVER call directly — only through flush(), which serializes it. Merges in any
  // metadata changed externally since our last write so a queued body-write never
  // reverts a title/pin/binding edited by the watcher or another instance. Errors are
  // logged, not thrown (the caller's flush() must not reject the whole chain).
  private async writePending(sessionId: string): Promise<void> {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(sessionId)

    try {
      const { data } = entry
      const filePath = sessionFilePath(sessionId)
      const sessionDir = dirname(filePath)
      await mkdir(sessionDir, { recursive: true, mode: 0o700 })

      const localHeader = createSessionHeader(data)
      const diskHeader = readSessionHeader(filePath)
      const previousSig = this.lastWrittenHeaderSignature.get(sessionId)
      const diskSig = diskHeader ? headerMetadataSignature(diskHeader) : undefined

      // Preserve disk metadata only when disk diverged from OUR last written signature
      // (an external mutation); a plain local change still wins. A mismatch without a
      // prior signature is treated as local (first write of this process).
      const hasExternalChange = !!diskHeader && !!diskSig && !!previousSig && diskSig !== previousSig
      const header =
        hasExternalChange && diskHeader
          ? mergeHeaderWithExternalMetadata(localHeader, diskHeader)
          : localHeader

      // Record the signature BEFORE the write so a watcher event fired during the
      // rename is recognised as our own write, not an external edit.
      this.lastWrittenHeaderSignature.set(sessionId, headerMetadataSignature(header))

      const body = serializeSessionJsonl(data, attachmentsDir(sessionId), header)
      const tmpFile = `${filePath}.tmp`
      await writeFile(tmpFile, body, { encoding: 'utf-8', mode: 0o600 })
      // POSIX rename over an existing file is atomic (no window with no file). Windows
      // rename fails if the target exists, so unlink first only there (infosec F2).
      if (process.platform === 'win32') {
        try {
          await unlink(filePath)
        } catch {
          /* ignore if it doesn't exist */
        }
      }
      await rename(tmpFile, filePath)
    } catch (err) {
      log.error('persistence-queue: failed to write session', {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Flush all sessions that have a pending or in-flight write. Call on app quit.
  async flushAll(): Promise<void> {
    const ids = new Set<string>([...this.pending.keys(), ...this.writeInProgress.keys()])
    await Promise.all([...ids].map((id) => this.flush(id)))
  }

  // Cancel a pending write (e.g. when deleting the session).
  cancel(sessionId: string): void {
    const entry = this.pending.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pending.delete(sessionId)
    }
    this.lastWrittenHeaderSignature.delete(sessionId)
  }

  // Whether a session has a pending (not-yet-written) debounced write.
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  get pendingCount(): number {
    return this.pending.size
  }
}

// Singleton instance used by the session manager.
export const sessionPersistenceQueue = new SessionPersistenceQueue()

// Named exports for testing/customization.
export { SessionPersistenceQueue, headerMetadataSignature, mergeHeaderWithExternalMetadata }
