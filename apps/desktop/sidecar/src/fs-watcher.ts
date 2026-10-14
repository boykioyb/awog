// On-demand workspace file watcher for the Project Code Workspace (ADR 0022).
// Unlike watcher.ts (always-on, artifact dirs only), this is started/stopped by
// the UI via fs.watch / fs.unwatch when a code workspace opens/closes — so a
// huge repo's full tree is only watched while the user is actually in it.
//
// Event fired (sidecar.event): `fs:changed { workspaceRoot, paths: string[] }`
// — coalesced workspace-relative paths that changed in the debounce window. The
// UI refreshes the tree and reconciles open tabs.
//
// Backend (native recursive trên macOS/Windows, chokidar trên Linux) và lý do chọn:
// xem fs/watch-tree.ts.

import { relative, sep } from 'node:path'
import { emit } from './transport/stdio.js'
import { log } from './util/logger.js'
import { SKIP_DIRS } from './fs/skip-dirs.js'
import { watchTree, type TreeWatcher } from './fs/watch-tree.js'

const DEBOUNCE_MS = 300
const EMFILE_BACKOFF_MS = 30_000
const ERR_LOG_THROTTLE_MS = 5_000

/** Đường dẫn TƯƠNG ĐỐI (theo `/` hoặc `\`) có đi qua thư mục bỏ qua nào không. */
export function isIgnoredRel(relPath: string): boolean {
  for (const segment of relPath.split(/[\\/]+/)) {
    if (SKIP_DIRS.has(segment)) return true
  }
  return false
}

interface Entry {
  backend: TreeWatcher
  timer: NodeJS.Timeout | undefined
  pending: Set<string>
  refCount: number
  /** Lần log error gần nhất per-message — throttle kẻo một lỗi lặp lại nổ log. */
  lastErrLog: Map<string, number>
}

class WorkspaceFsWatcher {
  private entries = new Map<string, Entry>()
  /** Mốc EMFILE gần nhất — process-wide (fd exhaustion ảnh hưởng MỌI watcher). */
  private lastEmfileAt = 0
  private emfileLogged = false

  async watch(workspaceRoot: string): Promise<void> {
    // EMFILE vừa đập → chặn mọi watch mới trong backoff window. Không phụ thuộc
    // entry đang sống (entry đã đóng do EMFILE), mốc nằm ở class.
    if (Date.now() - this.lastEmfileAt < EMFILE_BACKOFF_MS) return
    const existing = this.entries.get(workspaceRoot)
    if (existing) {
      existing.refCount += 1
      return
    }

    // Entry giữ chỗ TRƯỚC khi backend mở: hai `fs.watch` cùng root tới gần nhau
    // (re-open) không được mở hai backend.
    const entry: Entry = {
      backend: { close: async () => {} },
      timer: undefined,
      pending: new Set(),
      refCount: 1,
      lastErrLog: new Map(),
    }
    this.entries.set(workspaceRoot, entry)

    const onPath = (abs: string) => {
      const rel = relative(workspaceRoot, abs)
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) return
      entry.pending.add(rel.split(sep).join('/'))
      this.scheduleEmit(workspaceRoot, entry)
    }
    const onError = (err: unknown) => this.onError(workspaceRoot, entry, err)

    try {
      const backend = await watchTree(workspaceRoot, {
        ignored: isIgnoredRel,
        onPath,
        onError,
      })
      if (!backend) {
        this.entries.delete(workspaceRoot)
        return
      }
      // Bị unwatch/đóng trong lúc chờ import chokidar ⇒ đóng luôn backend vừa mở.
      if (this.entries.get(workspaceRoot) !== entry) {
        await backend.close()
        return
      }
      entry.backend = backend
      this.emfileLogged = false
    } catch (err) {
      // fs.watch ném đồng bộ khi root không tồn tại / không đọc được / hết fd.
      this.entries.delete(workspaceRoot)
      this.onError(workspaceRoot, entry, err)
    }
  }

  async unwatch(workspaceRoot: string): Promise<void> {
    const entry = this.entries.get(workspaceRoot)
    if (!entry) return
    entry.refCount -= 1
    if (entry.refCount > 0) return
    await this.close(workspaceRoot, entry)
  }

  async shutdown(): Promise<void> {
    const all = [...this.entries.entries()]
    await Promise.all(all.map(([root, e]) => this.close(root, e)))
  }

  private async close(workspaceRoot: string, entry: Entry): Promise<void> {
    clearTimeout(entry.timer)
    if (this.entries.get(workspaceRoot) === entry) this.entries.delete(workspaceRoot)
    await entry.backend.close()
  }

  private onError(workspaceRoot: string, entry: Entry, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    const now = Date.now()
    if (msg.includes('EMFILE')) {
      // EMFILE = hết fd cho cả process. Đóng HẲN watcher của root này (bất kể
      // refCount — các lượt unwatch sau tìm không thấy entry thì là no-op), nhớ
      // mốc, back-off 30s. Bản cũ chỉ trừ refCount nên watcher dùng chung vẫn sống
      // và tiếp tục ngốn fd.
      if (!this.emfileLogged) {
        this.emfileLogged = true
        log.warn('fs-watcher: EMFILE — closing watcher (fd exhausted)', {
          workspaceRoot,
          err: msg,
        })
      }
      this.lastEmfileAt = now
      void this.close(workspaceRoot, entry)
      return
    }
    // Lỗi khác (EPERM/ENOENT/…) — throttle, không tự đóng vì không phải lỗi
    // tài nguyên cấp process.
    const last = entry.lastErrLog.get(msg) ?? 0
    if (now - last < ERR_LOG_THROTTLE_MS) return
    entry.lastErrLog.set(msg, now)
    log.warn('fs-watcher: watch error', { workspaceRoot, err: msg })
  }

  private scheduleEmit(workspaceRoot: string, entry: Entry): void {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      const paths = [...entry.pending]
      entry.pending.clear()
      entry.timer = undefined
      if (paths.length > 0) emit('fs:changed', { workspaceRoot, paths })
    }, DEBOUNCE_MS)
  }
}

export const workspaceFsWatcher = new WorkspaceFsWatcher()

// Mirror terminal/mcp managers — clean up watchers on sidecar exit.
process.once('SIGTERM', () => {
  void workspaceFsWatcher.shutdown()
})
process.once('SIGINT', () => {
  void workspaceFsWatcher.shutdown()
})
