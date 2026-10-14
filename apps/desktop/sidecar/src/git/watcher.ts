// Watcher for external git activity. One watcher per workspaceRoot; debounced
// 200 ms. Uses transport `emit()` so the host forwards to the `sidecar-event`
// channel (only `method === "event"` envelopes are forwarded).
//
// Watch CẢ thư mục `.git` qua fs/watch-tree.ts (native recursive trên macOS/Windows —
// một handle; chokidar trên Linux) rồi lọc theo đường dẫn tương đối. Bản cũ dùng
// chokidar trực tiếp trên `HEAD`/`index`/`refs` ⇒ trên macOS mỗi ref rời (branch, tag)
// là một kqueue fd, repo nhiều tag là vài trăm fd. Lọc chỉ giữ những gì đổi trạng thái
// mà UI hiển thị; `objects/`, `logs/`, `hooks/`… bị bỏ (và trên Linux chokidar không
// đi xuống chúng nhờ `ignored`).
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { watchTree, type TreeWatcher } from '../fs/watch-tree.js'

interface WatcherSlot {
  watcher: TreeWatcher | null
  debounce: NodeJS.Timeout | undefined
  detached: boolean
}

const watchers = new Map<string, WatcherSlot>()
const DEBOUNCE_MS = 200

// File gốc trong `.git` mà một lần đổi = trạng thái repo đổi. `packed-refs`: sau
// `git gc`/`pack-refs`, xoá hay cập nhật một branch/tag chỉ ghi vào file này.
const ROOT_FILES = new Set(['HEAD', 'index', 'packed-refs', 'MERGE_HEAD', 'REBASE_HEAD'])

/** Đường dẫn tương đối theo `.git` có KHÔNG đáng theo dõi không (cả file lẫn thư mục). */
function isIrrelevant(rel: string): boolean {
  if (rel === '') return false
  const first = rel.split(/[\\/]+/)[0] ?? ''
  return !(ROOT_FILES.has(first) || first === 'refs')
}

// Echo-loop guard (ADR 0017 OQ-5): when a sidecar-driven mutation completes it
// emits `git:status:changed` directly. The chokidar watcher will fire ~ms later
// on the same .git/* writes — suppress it for a short window to avoid double
// refresh round-trips in the UI.
const suppressUntil = new Map<string, number>()

export function suppressEchoFor(workspaceRoot: string, durationMs = 500): void {
  suppressUntil.set(workspaceRoot, Date.now() + durationMs)
}

function isSuppressed(workspaceRoot: string): boolean {
  const until = suppressUntil.get(workspaceRoot)
  if (until === undefined) return false
  if (Date.now() < until) return true
  suppressUntil.delete(workspaceRoot)
  return false
}

function emitChanged(workspaceRoot: string): void {
  if (isSuppressed(workspaceRoot)) return
  emit('git:status:changed', { reason: 'external', workspaceRoot })
}

export function attachGitWatcher(workspaceRoot: string): void {
  if (watchers.has(workspaceRoot)) return
  const gitDir = join(workspaceRoot, '.git')
  // `.git` là FILE ở worktree/submodule (trỏ sang gitdir thật) hoặc chưa có (chưa
  // `git init`) — không có cây để watch. Không giữ chỗ trong map để lần gọi sau (sau
  // `git init`) còn thử lại.
  try {
    if (!statSync(gitDir).isDirectory()) return
  } catch {
    return
  }

  const slot: WatcherSlot = {
    watcher: null,
    debounce: undefined,
    detached: false,
  }
  watchers.set(workspaceRoot, slot)
  const trigger = () => {
    clearTimeout(slot.debounce)
    slot.debounce = setTimeout(() => {
      slot.debounce = undefined
      emitChanged(workspaceRoot)
    }, DEBOUNCE_MS)
  }

  void watchTree(gitDir, {
    ignored: isIrrelevant,
    onPath: trigger,
    onError: (err) => {
      log.warn('git watcher error', {
        workspaceRoot,
        err: err instanceof Error ? err.message : String(err),
      })
    },
  })
    .then(async (watcher) => {
      if (slot.detached) {
        await watcher?.close()
        return
      }
      slot.watcher = watcher
      log.info('git watcher attached', { workspaceRoot })
    })
    .catch((err: unknown) => {
      watchers.delete(workspaceRoot)
      log.warn('git watcher failed to start', {
        workspaceRoot,
        err: err instanceof Error ? err.message : String(err),
      })
    })
}

export async function detachGitWatcher(workspaceRoot: string): Promise<void> {
  const slot = watchers.get(workspaceRoot)
  if (!slot) return
  watchers.delete(workspaceRoot)
  slot.detached = true
  clearTimeout(slot.debounce)
  await slot.watcher?.close()
}
