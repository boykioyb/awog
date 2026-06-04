// Chokidar watcher for external git activity. One watcher per workspaceRoot;
// debounced 200 ms. Uses transport `emit()` so Tauri host forwards to the
// `sidecar-event` channel (only `method === "event"` envelopes are forwarded).
import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

interface WatcherSlot {
  watcher: FSWatcher
  debounce: NodeJS.Timeout | null
}

const watchers = new Map<string, WatcherSlot>()
const DEBOUNCE_MS = 200

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

  const watcher = chokidar.watch(
    [
      join(gitDir, 'HEAD'),
      join(gitDir, 'index'),
      join(gitDir, 'refs'),
      join(gitDir, 'MERGE_HEAD'),
      join(gitDir, 'REBASE_HEAD'),
    ],
    {
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    },
  )

  const slot: WatcherSlot = { watcher, debounce: null }
  const trigger = () => {
    if (slot.debounce) clearTimeout(slot.debounce)
    slot.debounce = setTimeout(() => {
      slot.debounce = null
      emitChanged(workspaceRoot)
    }, DEBOUNCE_MS)
  }

  watcher.on('add', trigger)
  watcher.on('change', trigger)
  watcher.on('unlink', trigger)
  watcher.on('error', (err) => {
    log.warn('git watcher error', { workspaceRoot, err: err instanceof Error ? err.message : String(err) })
  })

  watchers.set(workspaceRoot, slot)
  log.info('git watcher attached', { workspaceRoot })
}

export async function detachGitWatcher(workspaceRoot: string): Promise<void> {
  const slot = watchers.get(workspaceRoot)
  if (!slot) return
  if (slot.debounce) clearTimeout(slot.debounce)
  await slot.watcher.close()
  watchers.delete(workspaceRoot)
}
