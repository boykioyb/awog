// Repo discovery: walk a project/workspace folder up to `maxDepth` levels and
// collect every git repo found. A project may be a container of several repos
// (e.g. packages/api, services/worker) with no `.git` at its own root — this is
// what lets the Git UI surface a repo picker instead of an empty NO_REPO state.
//
// Read-only walk scoped under `root`: never follows symlinks (Dirent.isDirectory
// is false for symlinks), never spawns git, stops descending once a `.git` is
// found in a folder (nested repos / submodules are not enumerated separately).
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import type { GitRepoEntry } from './types.js'

export interface DiscoverOptions {
  maxDepth?: number
  maxRepos?: number
}

const DEFAULT_MAX_DEPTH = 2
const DEFAULT_MAX_REPOS = 50

// True only when `<dir>/.git` is an actual git repo, not just any `.git` entry.
// A stray `.git` folder (e.g. leftover tooling dir without HEAD) must NOT count,
// otherwise we'd "find" a bogus repo, stop descending, and miss the real repos
// nested below it. Cheap structural check — no git spawn.
async function isGitRepo(dir: string): Promise<boolean> {
  const gitPath = join(dir, '.git')
  let st
  try {
    st = await stat(gitPath)
  } catch {
    return false
  }
  // Normal repo: `.git/` is a directory and always contains a HEAD file.
  if (st.isDirectory()) {
    try {
      await stat(join(gitPath, 'HEAD'))
      return true
    } catch {
      return false
    }
  }
  // Worktree / submodule: `.git` is a file `gitdir: <path>`.
  if (st.isFile()) {
    try {
      const content = await readFile(gitPath, 'utf8')
      return content.startsWith('gitdir:')
    } catch {
      return false
    }
  }
  return false
}

function compareString(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export async function discoverGitRepos(
  root: string,
  opts: DiscoverOptions = {},
): Promise<GitRepoEntry[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxRepos = opts.maxRepos ?? DEFAULT_MAX_REPOS
  const repos: GitRepoEntry[] = []

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (repos.length >= maxRepos) return

    if (await isGitRepo(dir)) {
      repos.push({
        path: dir,
        name: basename(dir),
        relativePath: relative(root, dir) || '.',
        isRoot: dir === root,
      })
      return // do not descend into a repo
    }

    if (depth >= maxDepth) return

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // permission denied / vanished — skip silently
    }
    entries.sort((a, b) => compareString(a.name, b.name))

    for (const entry of entries) {
      if (repos.length >= maxRepos) break
      if (!entry.isDirectory()) continue // skip files + symlinks (no escape)
      if (SKIP_DIRS.has(entry.name)) continue
      // eslint-disable-next-line no-await-in-loop
      await visit(join(dir, entry.name), depth + 1)
    }
  }

  await visit(root, 0)

  // Root first, then by relative path for a stable, readable picker order.
  repos.sort((a, b) => {
    if (a.isRoot) return -1
    if (b.isRoot) return 1
    return compareString(a.relativePath, b.relativePath)
  })
  return repos
}
