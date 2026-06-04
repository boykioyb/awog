import { z } from 'zod'
import { readdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { runGit } from '../git/runner.js'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import type { FsEntry } from '../types/shared.js'

// Flat, recursive file index for the chat composer's `@file` fuzzy mention.
// Unlike fs.listDir (lazy one-level for the Files tab tree), this returns every
// file in the workspace at once so the UI can fuzzy-match anywhere in the tree.
//
// Fast path: `git ls-files` — already .gitignore-aware (skips node_modules,
// dist, .nuxt…) and lists tracked + untracked-not-ignored files in one shot.
// Fallback (no repo / no git): bounded recursive walk with a hardcoded skip set.
// Security invariant #2: every path stays workspace-relative; the walk never
// follows symlinks, so it can't escape the root.

const Params = z.object({
  workspaceRoot: z.string().min(1),
})

// Cap the index so a pathological repo can't blow up the IPC payload / memory.
const MAX_FILES = 20_000

const baseName = (relPath: string): string => {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? relPath : relPath.slice(idx + 1)
}

// Try `git ls-files`. Returns null when the dir is not a git repo (or git is
// unavailable) so the caller can fall back to a manual walk.
async function listViaGit(workspaceRoot: string): Promise<FsEntry[] | null> {
  let stdout: string
  try {
    const res = await runGit(
      workspaceRoot,
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { throwOnNonZero: false },
    )
    if (res.code !== 0) return null // not a repo → fatal: not a git repository
    stdout = res.stdout
  } catch {
    // GIT_NOT_FOUND / WORKSPACE_NOT_FOUND → fall back to the walk.
    return null
  }

  const files: FsEntry[] = []
  for (const rel of stdout.split('\0')) {
    if (rel === '') continue
    files.push({ name: baseName(rel), path: rel, kind: 'file' })
    if (files.length >= MAX_FILES) break
  }
  return files
}

// Breadth-first walk, files only, symlinks skipped (never followed). Count-
// capped rather than depth-capped so deeply nested but small trees fully load.
async function listViaWalk(workspaceRoot: string): Promise<FsEntry[]> {
  const files: FsEntry[] = []
  const queue: string[] = [''] // workspace-relative dirs, '' = root

  while (queue.length > 0 && files.length < MAX_FILES) {
    const relDir = queue.shift() as string
    const absDir = assertInsideWorkspace(workspaceRoot, relDir || '.')
    let dirents
    try {
      dirents = await readdir(absDir, { withFileTypes: true })
    } catch {
      continue // unreadable dir → skip
    }
    for (const dirent of dirents) {
      const { name } = dirent
      if (dirent.isSymbolicLink()) continue // never follow symlinks
      const childRel = relDir ? `${relDir}/${name}` : name
      if (dirent.isDirectory()) {
        if (!SKIP_DIRS.has(name)) queue.push(childRel)
      } else if (dirent.isFile()) {
        files.push({ name, path: childRel, kind: 'file' })
        if (files.length >= MAX_FILES) break
      }
    }
  }
  return files
}

register('fs.listFiles', async (raw): Promise<{ files: FsEntry[]; truncated: boolean }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }

  const fromGit = await listViaGit(params.workspaceRoot)
  const files = fromGit ?? (await listViaWalk(params.workspaceRoot))

  // Directory-grouped alpha order — stable and predictable for fuzzy ranking.
  files.sort((a, b) => a.path.localeCompare(b.path))

  return { files, truncated: files.length >= MAX_FILES }
})
