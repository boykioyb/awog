// Per-turn workspace file snapshots for Session Rewind (ADR 0038).
//
// Sessions do NOT auto-commit to git (that is a Tasks-only behaviour), so Rewind
// captures the workspace itself. A snapshot is a content-addressed copy of the
// workspace state right after an assistant turn, keyed by that turn's message
// id. Rewinding to a message restores its snapshot (write the tracked files
// back + delete files created since) while the conversation is truncated to the
// same point.
//
// Layout — ~/.awog/sessions/<sessionId>/snapshots/
//   blobs/<sha256>      file contents, deduplicated across turns (git-like)
//   <messageId>.json    manifest: { at, files: [{ path, sha, size }], partial }
//
// Capture/restore use the SAME file-selection (git ls-files when the workspace
// is a repo — .gitignore-aware — else a bounded walk with SKIP_DIRS), so restore
// only ever touches files the snapshot could have captured; node_modules / build
// output / gitignored paths are never deleted.

import { mkdir, readdir, readFile, writeFile, rm, lstat, stat, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import { runGit } from '../git/runner.js'
import { log } from '../util/logger.js'

// Caps guard against a pathological repo blowing up disk / latency. Over any cap
// → the snapshot is skipped entirely (NOT partial — a partial snapshot would
// make restore delete the un-captured files). The UI then falls back to a
// conversation-only rewind for that turn.
const CAP_FILES = 5000
const CAP_TOTAL_BYTES = 64 * 1024 * 1024 // 64 MB across the snapshot
const CAP_FILE_BYTES = 4 * 1024 * 1024 // 4 MB per file — larger files are left unmanaged
const KEEP_SNAPSHOTS = 20 // most-recent snapshots retained per session

interface ManifestFile {
  path: string
  sha: string
  size: number
}

interface Manifest {
  at: string
  files: ManifestFile[]
  // True when some candidate files were skipped (oversized) — restore won't
  // manage those paths. Informational; capture still produced a usable manifest.
  partial: boolean
}

// Incremental-capture cache (ADR 0038 §44b). Capture runs every assistant turn,
// so re-reading + re-hashing the whole tree each time is the dominant cost. This
// git-index-style cache keys a file's content sha by its (size, mtime); an
// unchanged file reuses its sha without a read. A workspace-wide signature lets a
// chat-only turn (nothing changed) short-circuit to the previous manifest with
// zero reads. In-memory only — a sidecar restart re-hashes once on the next turn.
//
// Racy-clean caveat (same trade-off git accepts): a file rewritten within the
// same mtime tick AND keeping the exact byte count reads as unchanged. Acceptable
// for a best-effort local rewind — the next genuine change re-captures it.
interface StatEntry {
  rel: string
  size: number
  mtimeMs: number
}

interface ShaCacheEntry {
  size: number
  mtimeMs: number
  sha: string
}

interface SessionCache {
  // rel path → last-seen stat signature + content sha.
  shas: Map<string, ShaCacheEntry>
  // Signature + file list of the last successful capture, for the unchanged
  // short-circuit. lastFiles references blobs the last manifest kept alive, so
  // prune (which keeps the 20 newest manifests) never GCs them out from under us.
  lastSignature: string | null
  lastFiles: ManifestFile[] | null
}

const sessionCaches = new Map<string, SessionCache>()

function cacheFor(sessionId: string): SessionCache {
  let c = sessionCaches.get(sessionId)
  if (!c) {
    c = { shas: new Map(), lastSignature: null, lastFiles: null }
    sessionCaches.set(sessionId, c)
  }
  return c
}

// Cheap content-independent fingerprint of the in-scope tree: sorted (path, size,
// mtime) tuples, plus the partial flag (a change in which files are oversized
// must invalidate). Equal signature ⇒ workspace unchanged since the last capture.
function workspaceSignature(stats: StatEntry[], partial: boolean): string {
  const h = createHash('sha256')
  h.update(partial ? 'p' : 'f')
  for (const s of [...stats].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    h.update(`\0${s.rel}\0${s.size}\0${s.mtimeMs}`)
  }
  return h.digest('hex')
}

export interface CaptureResult {
  ok: boolean
  files?: number
  reason?: string
}

export interface RestoreResult {
  ok: boolean
  restored?: number
  deleted?: number
  reason?: string
}

function sessionDir(sessionId: string): string {
  return join(awogHome(), sanitizeChild('sessions'), sanitizeChild(sessionId))
}
function snapshotsDir(sessionId: string): string {
  return join(sessionDir(sessionId), 'snapshots')
}
function blobsDir(sessionId: string): string {
  return join(snapshotsDir(sessionId), 'blobs')
}
function manifestFile(sessionId: string, messageId: string): string {
  return join(snapshotsDir(sessionId), `${sanitizeChild(messageId)}.json`)
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// Workspace-relative file list: git ls-files (gitignore-aware) when available,
// else a bounded BFS walk skipping SKIP_DIRS + symlinks. Mirrors fs.listFiles so
// capture and restore agree on which files are "in scope".
async function listWorkspaceFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const res = await runGit(
      workspaceRoot,
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { throwOnNonZero: false },
    )
    if (res.code === 0) {
      return res.stdout.split('\0').filter((p) => p !== '')
    }
  } catch {
    // not a repo / git missing → fall through to the walk
  }
  const files: string[] = []
  const queue: string[] = ['']
  while (queue.length > 0 && files.length < CAP_FILES + 1) {
    const relDir = queue.shift() as string
    const absDir = assertInsideWorkspace(workspaceRoot, relDir || '.')
    let dirents
    try {
      // eslint-disable-next-line no-await-in-loop
      dirents = await readdir(absDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue
      const childRel = relDir ? `${relDir}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (!SKIP_DIRS.has(dirent.name)) queue.push(childRel)
      } else if (dirent.isFile()) {
        files.push(childRel)
      }
    }
  }
  return files
}

async function atomicWrite(abs: string, buf: Buffer): Promise<void> {
  await mkdir(dirname(abs), { recursive: true })
  const tmp = `${abs}.awog-rewind-tmp`
  await writeFile(tmp, buf, { mode: 0o644 })
  await rename(tmp, abs)
}

// Capture the workspace state and key it to the assistant message id. Best-
// effort: returns { ok:false } (never throws) so a snapshot failure can never
// break the turn that triggered it.
export async function captureSnapshot(
  sessionId: string,
  messageId: string,
  workspaceRoot: string,
): Promise<CaptureResult> {
  try {
    const rels = await listWorkspaceFiles(workspaceRoot)
    if (rels.length > CAP_FILES) {
      log.warn('snapshot skipped: too many files', { sessionId, files: rels.length })
      return { ok: false, reason: 'too-many-files' }
    }

    // Pass 1 — stat only (cheap): collect (size, mtime) for in-scope files and
    // enforce the byte caps before touching any file content.
    const stats: StatEntry[] = []
    let total = 0
    let partial = false
    for (const rel of rels) {
      const abs = assertInsideWorkspace(workspaceRoot, rel)
      let st
      try {
        // eslint-disable-next-line no-await-in-loop
        st = await lstat(abs)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (st.size > CAP_FILE_BYTES) {
        partial = true
        continue
      }
      total += st.size
      if (total > CAP_TOTAL_BYTES) {
        log.warn('snapshot skipped: over byte cap', { sessionId, bytes: total })
        return { ok: false, reason: 'too-large' }
      }
      stats.push({ rel, size: st.size, mtimeMs: st.mtimeMs })
    }

    const cache = cacheFor(sessionId)
    const signature = workspaceSignature(stats, partial)

    // Short-circuit: nothing changed since the previous capture (the common case
    // for a chat-only turn). Reuse the last manifest's file list verbatim — no
    // content reads, no blob writes. The reused shas stay referenced so prune
    // keeps their blobs alive.
    if (signature === cache.lastSignature && cache.lastFiles) {
      const manifest: Manifest = { at: new Date().toISOString(), files: cache.lastFiles, partial }
      await mkdir(snapshotsDir(sessionId), { recursive: true, mode: 0o700 })
      await writeFile(manifestFile(sessionId, messageId), JSON.stringify(manifest), { mode: 0o600 })
      await prune(sessionId)
      return { ok: true, files: cache.lastFiles.length }
    }

    const dir = blobsDir(sessionId)
    await mkdir(dir, { recursive: true, mode: 0o700 })

    // Pass 2 — hash + store. Reuse a cached sha when the file's (size, mtime) is
    // unchanged; only genuinely changed files are read off disk.
    const files: ManifestFile[] = []
    for (const { rel, size, mtimeMs } of stats) {
      const abs = assertInsideWorkspace(workspaceRoot, rel)
      const cached = cache.shas.get(rel)
      let sha: string
      if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
        sha = cached.sha
        const blob = join(dir, sha)
        // Cache hit but the blob was GC'd (e.g. it slid out of the keep window
        // then came back) — re-materialize it from disk.
        // eslint-disable-next-line no-await-in-loop
        if (!(await exists(blob))) {
          // eslint-disable-next-line no-await-in-loop
          await atomicWrite(blob, await readFile(abs))
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const buf = await readFile(abs)
        sha = sha256(buf)
        const blob = join(dir, sha)
        // eslint-disable-next-line no-await-in-loop
        if (!(await exists(blob))) await atomicWrite(blob, buf)
        cache.shas.set(rel, { size, mtimeMs, sha })
      }
      files.push({ path: rel, sha, size })
    }

    const manifest: Manifest = { at: new Date().toISOString(), files, partial }
    await writeFile(manifestFile(sessionId, messageId), JSON.stringify(manifest), { mode: 0o600 })
    cache.lastSignature = signature
    cache.lastFiles = files
    await prune(sessionId)
    return { ok: true, files: files.length }
  } catch (err) {
    log.warn('captureSnapshot failed', {
      sessionId,
      messageId,
      err: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, reason: 'error' }
  }
}

// Restore the workspace to a snapshot: rewrite the tracked files from blobs and
// delete in-scope files created since (present now but not in the manifest).
// Out-of-scope files (gitignored, node_modules, oversized) are left untouched.
export async function restoreSnapshot(
  sessionId: string,
  messageId: string,
  workspaceRoot: string,
): Promise<RestoreResult> {
  let manifest: Manifest
  try {
    manifest = JSON.parse(await readFile(manifestFile(sessionId, messageId), 'utf8')) as Manifest
  } catch {
    return { ok: false, reason: 'no-snapshot' }
  }

  const want = new Map(manifest.files.map((f) => [f.path, f]))
  let deleted = 0
  let restored = 0

  // Delete in-scope files created after the snapshot.
  const current = await listWorkspaceFiles(workspaceRoot)
  for (const rel of current) {
    if (want.has(rel)) continue
    try {
      const abs = assertInsideWorkspace(workspaceRoot, rel)
      // eslint-disable-next-line no-await-in-loop
      const st = await lstat(abs)
      if (st.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        await rm(abs)
        deleted += 1
      }
    } catch {
      // best-effort: skip undeletable paths
    }
  }

  // Restore tracked files from their blobs.
  const dir = blobsDir(sessionId)
  for (const [rel, f] of want) {
    try {
      const abs = assertInsideWorkspace(workspaceRoot, rel)
      // eslint-disable-next-line no-await-in-loop
      const buf = await readFile(join(dir, f.sha))
      // eslint-disable-next-line no-await-in-loop
      await atomicWrite(abs, buf)
      restored += 1
    } catch (err) {
      log.warn('restoreSnapshot: file failed', {
        sessionId,
        path: rel,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { ok: true, restored, deleted }
}

// Message ids that currently have a snapshot (drives the UI's rewind affordance).
export async function listSnapshotMessageIds(sessionId: string): Promise<string[]> {
  try {
    const entries = await readdir(snapshotsDir(sessionId))
    return entries.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length))
  } catch {
    return []
  }
}

// Drop the whole snapshot tree for a session (called on session delete).
export async function deleteSnapshots(sessionId: string): Promise<void> {
  sessionCaches.delete(sessionId)
  try {
    await rm(snapshotsDir(sessionId), { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

// Keep the most-recent KEEP_SNAPSHOTS manifests; drop older ones and GC any blob
// no longer referenced by a surviving manifest.
async function prune(sessionId: string): Promise<void> {
  const dir = snapshotsDir(sessionId)
  let entries: string[]
  try {
    entries = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  } catch {
    return
  }
  if (entries.length === 0) return

  const withTime = await Promise.all(
    entries.map(async (name) => {
      try {
        const st = await stat(join(dir, name))
        return { name, mtime: st.mtimeMs }
      } catch {
        return { name, mtime: 0 }
      }
    }),
  )
  withTime.sort((a, b) => b.mtime - a.mtime)
  const survivors = withTime.slice(0, KEEP_SNAPSHOTS)
  const doomed = withTime.slice(KEEP_SNAPSHOTS)
  await Promise.all(doomed.map((d) => rm(join(dir, d.name), { force: true })))

  // GC blobs: union the shas referenced by surviving manifests, delete the rest.
  const referenced = new Set<string>()
  await Promise.all(
    survivors.map(async (s) => {
      try {
        const m = JSON.parse(await readFile(join(dir, s.name), 'utf8')) as Manifest
        for (const f of m.files) referenced.add(f.sha)
      } catch {
        // ignore unreadable manifest
      }
    }),
  )
  const bdir = blobsDir(sessionId)
  let blobs: string[]
  try {
    blobs = await readdir(bdir)
  } catch {
    return
  }
  await Promise.all(
    blobs.filter((b) => !referenced.has(b)).map((b) => rm(join(bdir, b), { force: true })),
  )
}
