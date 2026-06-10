import { z } from 'zod'
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { runGit } from '../git/runner.js'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import type { FsSearchMatch } from '../types/shared.js'

// Find-in-files for the Project workspace (ADR 0022).
//
// Matching ALWAYS runs through `git grep` (git is a hard AWOG dependency):
//   - repo dir   → `git grep --untracked` (.gitignore-aware)
//   - non-repo   → `git grep --no-index` (scans the tree, no .gitignore)
// Both use git's own regex engine, which is immune to catastrophic backtracking
// — so a user `regex: true` query can NEVER ReDoS the single-threaded sidecar
// (infosec F1). We never run a user-supplied RegExp against file content: the
// column is computed with a plain `indexOf` for literal queries and left at 1
// for regex queries. Only if git is entirely unavailable do we fall back to a
// LITERAL (substring) walk with a wallclock + file cap.
//
// Security: query passed via `-e <query> --` (operand, never a flag / shell
// string); cwd = workspaceRoot; pathspecs validated by git (rejects `../`).

const DEFAULT_MAX_RESULTS = 1000
const HARD_MAX_RESULTS = 5000
const MAX_QUERY_LEN = 1000
const PREVIEW_CAP = 400
const MAX_LINE_LEN = 2000 // don't index-scan absurdly long lines
const WALK_FILE_CAP = 1024 * 1024 // skip files > 1 MiB in the fallback walk
const WALK_DEADLINE_MS = 5000 // hard wallclock cap for the literal fallback
const GIT_GREP_TIMEOUT_MS = 15_000

const Params = z.object({
  workspaceRoot: z.string().min(1),
  query: z.string().min(1).max(MAX_QUERY_LEN),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  includeGlob: z.string().min(1).optional(),
  excludeGlob: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(HARD_MAX_RESULTS).optional(),
})

type SearchOpts = z.infer<typeof Params>

// Column of the first match on the line — best-effort, NEVER runs the user's
// regex (ReDoS-safe). Literal queries use indexOf; regex queries report col 1.
function columnOf(opts: SearchOpts, text: string): number {
  if (opts.regex === true || text.length > MAX_LINE_LEN) return 1
  const hay = opts.caseSensitive === true ? text : text.toLowerCase()
  const needle = opts.caseSensitive === true ? opts.query : opts.query.toLowerCase()
  const idx = hay.indexOf(needle)
  return idx === -1 ? 1 : idx + 1
}

const preview = (text: string): string =>
  text.length > PREVIEW_CAP ? `${text.slice(0, PREVIEW_CAP)}…` : text

function parseGrep(opts: SearchOpts, stdout: string, max: number): FsSearchMatch[] {
  const matches: FsSearchMatch[] = []
  const lines = stdout.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw === '') continue
    // `path:line:text` — non-greedy path tolerates a colon inside a filename.
    const m = raw.match(/^(.+?):(\d+):([\s\S]*)$/)
    if (!m) continue
    // `git grep --no-index` prefixes paths with `./` — normalise to workspace-rel.
    const path = m[1].startsWith('./') ? m[1].slice(2) : m[1]
    matches.push({ path, line: Number(m[2]), column: columnOf(opts, m[3]), preview: preview(m[3]) })
    if (matches.length >= max) break
  }
  return matches
}

// One `git grep` invocation. `noIndex` scans a non-repo dir. Returns matches, or
// null when not applicable (not a repo for repo-mode, or git unavailable).
async function tryGitGrep(
  opts: SearchOpts,
  max: number,
  noIndex: boolean,
): Promise<FsSearchMatch[] | null> {
  const args = ['grep', '--no-color', '-I', '-n']
  args.push(noIndex ? '--no-index' : '--untracked')
  if (opts.caseSensitive !== true) args.push('-i')
  args.push(opts.regex === true ? '-E' : '-F')
  if (opts.wholeWord === true) args.push('-w')
  args.push('-e', opts.query, '--')
  if (opts.includeGlob) args.push(`:(glob)${opts.includeGlob}`)
  if (opts.excludeGlob) args.push(`:(exclude,glob)${opts.excludeGlob}`)
  // `--no-index` ignores .gitignore, so a non-repo / multi-repo-container root
  // would otherwise return node_modules/dist/.git junk. Exclude the same dirs the
  // file index + literal walk already skip (SKIP_DIRS) so results stay relevant.
  // (`--exclude-standard` is NOT valid with `--no-index`; `:(exclude)` pathspecs are.)
  if (noIndex) {
    for (const dir of SKIP_DIRS) args.push(`:(exclude,glob)**/${dir}/**`)
  }

  let res
  try {
    res = await runGit(opts.workspaceRoot, args, {
      throwOnNonZero: false,
      timeoutMs: GIT_GREP_TIMEOUT_MS,
    })
  } catch {
    return null // GIT_NOT_FOUND / WORKSPACE_NOT_FOUND → caller decides next step
  }
  // git grep: 0 = matches, 1 = no matches, >1 = error / not a repo.
  if (res.code > 1) return null
  if (res.code === 1) return []
  return parseGrep(opts, res.stdout, max)
}

// LITERAL (substring) fallback for when git is unavailable. No user RegExp is
// ever compiled here, so it cannot ReDoS. Bounded by file size, file count and
// a hard wallclock deadline.
async function literalWalk(opts: SearchOpts, max: number): Promise<FsSearchMatch[]> {
  const deadline = Date.now() + WALK_DEADLINE_MS
  const cs = opts.caseSensitive === true
  const needle = cs ? opts.query : opts.query.toLowerCase()
  const matches: FsSearchMatch[] = []
  const queue: string[] = ['']

  while (queue.length > 0 && matches.length < max) {
    if (Date.now() > deadline) break
    const relDir = queue.shift() as string
    const absDir = assertInsideWorkspace(opts.workspaceRoot, relDir || '.')
    let dirents
    try {
      dirents = await readdir(absDir, { withFileTypes: true }) // eslint-disable-line no-await-in-loop
    } catch {
      continue
    }
    for (let d = 0; d < dirents.length; d++) {
      const dirent = dirents[d]
      if (matches.length >= max || Date.now() > deadline) break
      const { name } = dirent
      if (dirent.isSymbolicLink()) continue
      const childRel = relDir ? `${relDir}/${name}` : name
      if (dirent.isDirectory()) {
        if (!SKIP_DIRS.has(name)) queue.push(childRel)
        continue
      }
      if (!dirent.isFile()) continue
      const abs = assertInsideWorkspace(opts.workspaceRoot, childRel)
      let content: string
      try {
        const st = await stat(abs) // eslint-disable-line no-await-in-loop
        if (st.size > WALK_FILE_CAP) continue
        const buf = await readFile(abs) // eslint-disable-line no-await-in-loop
        if (buf.includes(0)) continue // binary
        content = buf.toString('utf8')
      } catch {
        continue
      }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        const hay = cs ? lines[i] : lines[i].toLowerCase()
        const idx = hay.indexOf(needle)
        if (idx !== -1) {
          matches.push({ path: childRel, line: i + 1, column: idx + 1, preview: preview(lines[i]) })
        }
      }
    }
  }
  return matches
}

register(
  'fs.search',
  async (raw): Promise<{ matches: FsSearchMatch[]; truncated: boolean }> => {
    const opts = Params.parse(raw)
    if (!isAbsolute(opts.workspaceRoot)) {
      throw new RpcError(-32602, 'workspaceRoot must be absolute')
    }
    const max = opts.maxResults ?? DEFAULT_MAX_RESULTS

    // repo mode → no-index mode → literal walk (only if git is missing).
    const repo = await tryGitGrep(opts, max, false)
    const matches =
      repo ?? (await tryGitGrep(opts, max, true)) ?? (await literalWalk(opts, max))

    return { matches, truncated: matches.length >= max }
  },
)
