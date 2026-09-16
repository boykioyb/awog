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

// A persist rewrites the WHOLE transcript SYNCHRONOUSLY (readSessionHeader reads the
// full file; serializeSessionJsonl re-stringifies + re-externalizes every message),
// which can block the engine's event loop on a large session — the prime suspect for
// the post-turn freeze the engine heartbeat now recovers from (see electron engine.ts).
// Log any write slower than this with a sub-step breakdown so a recurrence is named.
const SLOW_WRITE_WARN_MS = 800

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
  aboutSshHostId: string | undefined
  aboutGhUrl: string | undefined
  // Cả ba field dưới đây đều là metadata của header do RPC/người dùng sửa, y hệt
  // `pinned`: `sessions.setArchived`, `sessions.updateTodos`, `sessions.updateBookmarks`.
  // Thiếu chúng trong chữ ký ⇒ một lần sửa bên ngoài (watcher, cửa sổ khác, sửa tay
  // file khi app đang chạy) không được nhận diện là "đĩa đã lệch", nên lần ghi thân
  // bài tiếp theo lặng lẽ ghi đè cờ lưu trữ / checklist / bookmark vừa đổi.
  archived: boolean | undefined
  archivedAt: string | undefined
  todos: SessionHeader['todos']
  bookmarks: SessionHeader['bookmarks']
  // Ngữ cảnh hạ tầng (ADR 0088): cũng là metadata do RPC `infra.setSessionContext`
  // sửa, nên thiếu nó ở đây thì một lần đổi tài khoản từ cửa sổ khác bị lần ghi
  // thân bài kế tiếp lặng lẽ ghi đè — đúng kiểu "âm thầm đổi account" mà cả tính
  // năng này sinh ra để chặn.
  infra: SessionHeader['infra']
  // Gom nhóm phiên: cũng là metadata do RPC `sessions.setGroup` sửa, nên thiếu ở đây
  // thì một lần xếp/tách nhóm ở cửa sổ khác bị lần ghi thân bài kế tiếp ghi đè.
  groupParentId: string | undefined
  groupRole: string | undefined
  groupAutoDeliver: boolean | undefined
}

function headerMetadataSignature(header: SessionHeader): string {
  const sig: HeaderMetadataSignature = {
    title: header.title,
    pinned: header.pinned,
    projectId: header.projectId,
    disabledTools: header.disabledTools,
    mcpServerIds: header.mcpServerIds,
    aboutTaskId: header.aboutTaskId,
    aboutSshHostId: header.aboutSshHostId,
    aboutGhUrl: header.aboutGhUrl,
    archived: header.archived,
    archivedAt: header.archivedAt,
    todos: header.todos,
    bookmarks: header.bookmarks,
    infra: header.infra,
    groupParentId: header.groupParentId,
    groupRole: header.groupRole,
    groupAutoDeliver: header.groupAutoDeliver,
  }
  return JSON.stringify(sig)
}

// Overlay the disk header's user-editable metadata onto the locally-computed header,
// preserving everything else local. Optional fields are copied only when present on
// disk — exactOptionalPropertyTypes forbids assigning `undefined` to an optional prop,
// so a disk edit that CLEARS a flag keeps the local value (an accepted minor deviation).
// EXCEPT archived/archivedAt: xoá key CHÍNH LÀ cách bỏ lưu trữ, nên cặp đó lấy trọn
// theo đĩa (xem trong thân hàm).
function mergeHeaderWithExternalMetadata(
  local: SessionHeader,
  disk: SessionHeader,
): SessionHeader {
  // Bỏ lưu trữ = XOÁ HẲN cặp archived/archivedAt khỏi header (session-manager.ts
  // setArchived), nên "chỉ copy khi đĩa có" sẽ giữ lại `archived: true` của bản local
  // và hoàn tác đúng thao tác vừa làm bên ngoài. Vì vậy cặp này lấy TRỌN VẸN theo đĩa:
  // gỡ khỏi bản local trước, rồi chỉ gắn lại khi đĩa thật sự có.
  const { archived: _localArchived, archivedAt: _localArchivedAt, ...rest } = local
  const diskArchived: Pick<SessionHeader, 'archived' | 'archivedAt'> = disk.archived
    ? {
        archived: true,
        ...(disk.archivedAt !== undefined ? { archivedAt: disk.archivedAt } : {}),
      }
    : {}
  // `infra` lấy TRỌN theo đĩa, cùng lý do với cặp archived: bỏ ghim ngữ cảnh chính
  // là XOÁ HẲN key (session-manager setInfra), nên "chỉ copy khi đĩa có" sẽ giữ lại
  // bản ghim cũ của local và hoàn tác đúng thao tác vừa làm bên ngoài.
  const { infra: _localInfra, ...restNoInfra } = rest
  const diskInfra: Pick<SessionHeader, 'infra'> = disk.infra ? { infra: disk.infra } : {}
  // Cặp nhóm lấy TRỌN theo đĩa, cùng lý do với archived/infra: tách khỏi nhóm là
  // XOÁ HẲN key (session-manager setGroup), nên "chỉ copy khi đĩa có" sẽ giữ lại
  // cha cũ của bản local và hoàn tác đúng thao tác vừa làm bên ngoài.
  const { groupParentId: _localGroup, groupRole: _localRole, ...restNoGroup } = restNoInfra
  const diskGroup: Pick<SessionHeader, 'groupParentId' | 'groupRole'> = disk.groupParentId
    ? {
        groupParentId: disk.groupParentId,
        ...(disk.groupRole !== undefined ? { groupRole: disk.groupRole } : {}),
      }
    : {}
  return {
    ...restNoGroup,
    ...diskGroup,
    title: disk.title,
    projectId: disk.projectId,
    ...diskArchived,
    ...diskInfra,
    ...(disk.pinned !== undefined ? { pinned: disk.pinned } : {}),
    ...(disk.disabledTools !== undefined ? { disabledTools: disk.disabledTools } : {}),
    ...(disk.mcpServerIds !== undefined ? { mcpServerIds: disk.mcpServerIds } : {}),
    ...(disk.aboutTaskId !== undefined ? { aboutTaskId: disk.aboutTaskId } : {}),
    ...(disk.aboutSshHostId !== undefined ? { aboutSshHostId: disk.aboutSshHostId } : {}),
    ...(disk.aboutGhUrl !== undefined ? { aboutGhUrl: disk.aboutGhUrl } : {}),
    ...(disk.groupAutoDeliver !== undefined ? { groupAutoDeliver: disk.groupAutoDeliver } : {}),
    // todos/bookmarks luôn được ghi thành MẢNG (rỗng khi xoá hết) chứ không bị xoá
    // key, nên "copy khi đĩa có" đã diễn tả đủ cả hướng dựng lẫn hướng xoá.
    ...(disk.todos !== undefined ? { todos: disk.todos } : {}),
    ...(disk.bookmarks !== undefined ? { bookmarks: disk.bookmarks } : {}),
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

      // Sub-step timing (see SLOW_WRITE_WARN_MS): the header build/read + serialize are
      // the SYNCHRONOUS phases that can block the event loop; the write/rename are async.
      const t0 = Date.now()
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

      const tHeader = Date.now()
      const body = serializeSessionJsonl(data, attachmentsDir(sessionId), header)
      const tSerialize = Date.now()
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

      const totalMs = Date.now() - t0
      if (totalMs >= SLOW_WRITE_WARN_MS) {
        log.warn('persistence-queue: slow session write', {
          sessionId,
          messageCount: data.messages.length,
          bytes: body.length,
          totalMs,
          headerMs: tHeader - t0, // createSessionHeader + readSessionHeader (sync, full-file)
          serializeMs: tSerialize - tHeader, // JSON.stringify + attachment externalize (sync)
          writeMs: Date.now() - tSerialize, // writeFile + rename (async I/O)
        })
      }
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
