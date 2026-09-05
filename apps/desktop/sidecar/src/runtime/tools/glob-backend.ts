// Filename lookup for the Glob tool.
//
// WHY THIS EXISTS. Glob used to be `git ls-files` and nothing else: outside a git
// repository it answered "Glob unavailable" and the model lost its only way to
// find a file by name (its own source comment promised a filesystem fallback
// that was never written). Claude Code's Glob works anywhere and returns
// most-recently-modified first, which is what makes "find the file I was just
// working on" land on the right one — so both behaviours live here.
//
// The walk is deliberately bounded (entry budget + deadline + the same
// dependency/build excludes the content search uses) so a Glob over a huge
// non-repo tree cannot stall a turn.

import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { NOISE_DIRS } from './search-backend.js'

const WALK_MAX_ENTRIES = 50_000
const WALK_TIMEOUT_MS = 10_000

const NOISE_DIR_SET = new Set<string>(NOISE_DIRS)

// Translate a git-pathspec-style glob into an anchored RegExp.
//   `**/` → any number of leading segments   `**` → anything
//   `*`   → anything but a separator          `?` → one non-separator
//   `{a,b}` → alternation
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function globToRegExp(pattern: string): RegExp {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` spans whole segments (so `**/*.ts` also matches a root-level
        // `a.ts`); a bare `**` spans anything at all.
        if (pattern[i + 2] === '/') {
          out += '(?:[^/]*\\/)*'
          i += 3
        } else {
          out += '.*'
          i += 2
        }
        continue
      }
      out += '[^/]*'
      i += 1
      continue
    }
    if (c === '?') {
      out += '[^/]'
      i += 1
      continue
    }
    if (c === '{') {
      const close = pattern.indexOf('}', i)
      if (close !== -1) {
        const parts = pattern
          .slice(i + 1, close)
          .split(',')
          .map(escapeRegExp)
        out += `(?:${parts.join('|')})`
        i = close + 1
        continue
      }
    }
    out += escapeRegExp(c)
    i += 1
  }
  return new RegExp(`^${out}$`)
}

export interface GlobHit {
  path: string
  mtimeMs: number
}

// Bounded recursive walk rooted at `root`, yielding workspace-relative POSIX
// paths that match `re`. Hidden DIRECTORIES are skipped (.git, .venv, caches) but
// hidden files are not — `.env.example` and `.gitignore` are findable.
async function walk(root: string, re: RegExp, hits: GlobHit[], deadline: number): Promise<number> {
  let visited = 0
  const queue: string[] = [root]
  while (queue.length > 0) {
    if (Date.now() > deadline || visited >= WALK_MAX_ENTRIES) break
    const dir = queue.shift() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue // unreadable directory (permissions, race) — skip, don't fail
    }
    for (const entry of entries) {
      visited += 1
      if (visited >= WALK_MAX_ENTRIES) break
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || NOISE_DIR_SET.has(entry.name)) continue
        queue.push(abs)
        continue
      }
      if (!entry.isFile()) continue // symlink/socket/fifo — never a source file
      const rel = relative(root, abs).split(sep).join('/')
      if (!re.test(rel)) continue
      try {
        const st = await stat(abs)
        hits.push({ path: rel, mtimeMs: st.mtimeMs })
      } catch {
        // Vanished between readdir and stat — just omit it.
      }
    }
  }
  return visited
}

// Find files by name under `root`. Returns most-recently-modified first, which
// is what makes an over-broad pattern still surface the file the user is
// actually working on.
export async function walkGlob(root: string, pattern: string): Promise<GlobHit[]> {
  const re = globToRegExp(pattern)
  const hits: GlobHit[] = []
  await walk(root, re, hits, Date.now() + WALK_TIMEOUT_MS)
  hits.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return hits
}

// Attach mtimes to paths git already resolved, so the git branch sorts the same
// way as the walk branch. Files that vanished since `ls-files` are dropped.
export async function sortByMtime(root: string, paths: string[]): Promise<GlobHit[]> {
  const hits = await Promise.all(
    paths.map(async (p): Promise<GlobHit | null> => {
      try {
        const st = await stat(join(root, p))
        return { path: p, mtimeMs: st.mtimeMs }
      } catch {
        return null
      }
    }),
  )
  return hits.filter((h): h is GlobHit => h !== null).sort((a, b) => b.mtimeMs - a.mtimeMs)
}
