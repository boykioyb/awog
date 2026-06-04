// On-demand workspace file watcher for the Project Code Workspace (ADR 0022).
// Unlike watcher.ts (always-on, artifact dirs only), this is started/stopped by
// the UI via fs.watch / fs.unwatch when a code workspace opens/closes — so a
// huge repo's full tree is only watched while the user is actually in it.
//
// Event fired (sidecar.event): `fs:changed { workspaceRoot, paths: string[] }`
// — coalesced workspace-relative paths that changed in the debounce window. The
// UI refreshes the tree and reconciles open tabs.

import { relative, sep } from 'node:path'
import { emit } from './transport/stdio.js'
import { log } from './util/logger.js'
import { SKIP_DIRS } from './fs/skip-dirs.js'

const DEBOUNCE_MS = 300

interface Watcher {
  close: () => Promise<void> | void
  on: (event: string, handler: (path: string) => void) => void
}

interface ChokidarModule {
  watch: (paths: string | string[], options: Record<string, unknown>) => Watcher
}

let chokidarModule: ChokidarModule | null = null
let chokidarLoadAttempted = false

async function getChokidar(): Promise<ChokidarModule | null> {
  if (chokidarLoadAttempted) return chokidarModule
  chokidarLoadAttempted = true
  try {
    const mod = await import('chokidar')
    chokidarModule = mod as unknown as ChokidarModule
    return chokidarModule
  } catch (err) {
    log.warn('fs-watcher: chokidar import failed — workspace auto-refresh disabled', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function isIgnored(testPath: string): boolean {
  for (const segment of testPath.split(/[\\/]+/)) {
    if (SKIP_DIRS.has(segment)) return true
  }
  return false
}

interface Entry {
  watcher: Watcher
  timer: NodeJS.Timeout | undefined
  pending: Set<string>
  refCount: number
}

class WorkspaceFsWatcher {
  private entries = new Map<string, Entry>()

  async watch(workspaceRoot: string): Promise<void> {
    const existing = this.entries.get(workspaceRoot)
    if (existing) {
      existing.refCount += 1
      return
    }
    const chokidar = await getChokidar()
    if (!chokidar) return

    const watcher = chokidar.watch(workspaceRoot, {
      ignoreInitial: true,
      ignored: (p: string) => isIgnored(p),
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      followSymlinks: false,
    })
    const entry: Entry = { watcher, timer: undefined, pending: new Set(), refCount: 1 }
    this.entries.set(workspaceRoot, entry)

    const onChange = (abs: string) => {
      const rel = relative(workspaceRoot, abs)
      if (rel === '' || rel.startsWith(`..${sep}`)) return
      entry.pending.add(rel.split(sep).join('/'))
      this.scheduleEmit(workspaceRoot, entry)
    }
    watcher.on('add', onChange)
    watcher.on('change', onChange)
    watcher.on('unlink', onChange)
    watcher.on('addDir', onChange)
    watcher.on('unlinkDir', onChange)
    watcher.on('error', (err: unknown) => {
      log.warn('fs-watcher: chokidar error', {
        workspaceRoot,
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }

  async unwatch(workspaceRoot: string): Promise<void> {
    const entry = this.entries.get(workspaceRoot)
    if (!entry) return
    entry.refCount -= 1
    if (entry.refCount > 0) return
    if (entry.timer) clearTimeout(entry.timer)
    this.entries.delete(workspaceRoot)
    await Promise.resolve(entry.watcher.close())
  }

  async shutdown(): Promise<void> {
    const all = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(
      all.map((e) => {
        if (e.timer) clearTimeout(e.timer)
        return Promise.resolve(e.watcher.close())
      }),
    )
  }

  private scheduleEmit(workspaceRoot: string, entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer)
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
