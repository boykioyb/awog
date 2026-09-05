// Content-search backend for the Grep tool (ADR 0029 parity fix).
//
// WHY THIS EXISTS. Claude Code's Grep is ripgrep-powered, so the model is
// conditioned to write ripgrep-flavoured regex (`\d`, `\s`, `\b`, lookahead) and
// to pass output_mode / -i / -A / -B / -C / head_limit. AWOG previously ran
// `git grep -E` — POSIX ERE, where `\d` is not an escape at all. It did not
// error: it matched NOTHING and exited 0, so the model read "no matches" as a
// fact about the codebase and moved on with a wrong premise. A search tool that
// silently returns the wrong answer is worse than one that fails, so the backend
// now prefers ripgrep and only degrades when it is absent.
//
// Order: rg → `git grep -P` (PCRE — same escapes) → `git grep -E` (last resort,
// where `\d` genuinely does not work; we say so IN-BAND rather than pretend).
//
// Security: every backend is spawned via execFile with an ARGUMENT ARRAY (never
// a shell string) under the shell env allowlist, cwd = workspace root, with a
// timeout and a maxBuffer. The pattern is L1 input but never reaches a shell.
// ReDoS: rg's Rust regex engine is linear-time; the PCRE fallback is not, which
// is what the timeout is for.

import { execFile } from 'node:child_process'
import { filteredShellEnv } from './shell.js'

const SEARCH_TIMEOUT_MS = 15_000
const SEARCH_MAX_BUFFER = 16 * 1024 * 1024
const PROBE_TIMEOUT_MS = 5_000

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'
export type SearchBackend = 'rg' | 'git-P' | 'git-E'

export interface GrepRequest {
  pattern: string
  // Workspace-relative subdirectory scope. Already validated by the caller with
  // assertInsideWorkspace; normalised here into a pathspec/positional prefix.
  path?: string | undefined
  glob?: string | undefined
  type?: string | undefined
  caseInsensitive?: boolean | undefined
  outputMode: GrepOutputMode
  before?: number | undefined
  after?: number | undefined
  multiline?: boolean | undefined
}

export interface GrepOutcome {
  lines: string[]
  backend: SearchBackend
  // In-band degradation notice: a capability the chosen backend could not honour
  // (e.g. `type` outside ripgrep). Surfaced to the model so it can adapt instead
  // of trusting a silently narrower search.
  note?: string | undefined
}

// Dependency / build / VCS noise never carries signal worth searching. Excluded
// by default so a broad search cannot scan a vendored bundle — this is the path
// that once returned ~8MB and blew a turn to 5.1M tokens. A caller-supplied
// `glob` REPLACES these (that is how you deliberately search inside them).
export const NOISE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'vendor',
] as const
const NOISE_FILES = ['*.min.js', '*.min.css', '*.map'] as const

const GIT_EXCLUDE_PATHSPECS = [
  ...NOISE_DIRS.map((d) => `:(exclude)**/${d}/**`),
  ...NOISE_FILES.map((f) => `:(exclude)**/${f}`),
]

const RG_EXCLUDE_GLOBS = [
  ...NOISE_DIRS.map((d) => `!**/${d}/**`),
  ...NOISE_FILES.map((f) => `!**/${f}`),
]

interface ExecOutcome {
  stdout: string
  stderr: string
  code: number
  spawnFailed: boolean
}

function execCapture(bin: string, args: string[], cwd: string): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        cwd,
        env: filteredShellEnv(),
        windowsHide: true,
        timeout: SEARCH_TIMEOUT_MS,
        maxBuffer: SEARCH_MAX_BUFFER,
      },
      (err, stdout, stderr) => {
        const out = typeof stdout === 'string' ? stdout : String(stdout ?? '')
        const errOut = typeof stderr === 'string' ? stderr : String(stderr ?? '')
        if (err) {
          const ex = err as NodeJS.ErrnoException & { code?: number | string }
          // ENOENT = binary absent (a real fallback signal), distinct from a
          // non-zero exit (grep's "no matches" is exit 1 and is NOT a failure).
          if (ex.code === 'ENOENT') {
            resolve({ stdout: '', stderr: errOut, code: -1, spawnFailed: true })
            return
          }
          resolve({
            stdout: out,
            stderr: errOut,
            code: typeof ex.code === 'number' ? ex.code : 2,
            spawnFailed: false,
          })
          return
        }
        resolve({ stdout: out, stderr: errOut, code: 0, spawnFailed: false })
      },
    )
  })
}

// ─── Backend availability (memoized for the engine lifetime) ────────────────

let rgAvailable: Promise<boolean> | null = null

function probeRipgrep(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'rg',
      ['--version'],
      { env: filteredShellEnv(), windowsHide: true, timeout: PROBE_TIMEOUT_MS },
      (err) => resolve(!err),
    )
  })
}

function hasRipgrep(): Promise<boolean> {
  if (!rgAvailable) rgAvailable = probeRipgrep()
  return rgAvailable
}

// `git grep -P` needs a git built with PCRE. Rather than probe up front we learn
// it from the one stderr git emits ("cannot be used without PCRE support") and
// remember it, so the cost is paid at most once per engine lifetime.
let gitPcreUnsupported = false

function isPcreUnsupported(stderr: string): boolean {
  return /pcre/i.test(stderr)
}

// Strip a leading `./` and trailing slashes so a scope collapses cleanly to ''
// (= workspace root) and composes with a glob without doubling separators.
function normalizeDir(path: string): string {
  return path.replace(/^\.\/+/, '').replace(/\/+$/, '')
}

// ─── ripgrep ────────────────────────────────────────────────────────────────

function buildRgArgs(req: GrepRequest): string[] {
  const dir = req.path ? normalizeDir(req.path) : ''
  const args = ['--color=never', '--no-messages']

  if (req.outputMode === 'files_with_matches') args.push('--files-with-matches')
  else if (req.outputMode === 'count') args.push('--count-matches', '--with-filename')
  else args.push('--line-number', '--no-heading', '--with-filename')

  if (req.caseInsensitive) args.push('--ignore-case')
  // Context flags only mean anything for content output.
  if (req.outputMode === 'content') {
    if (req.before !== undefined && req.before > 0) args.push('--before-context', String(req.before))
    if (req.after !== undefined && req.after > 0) args.push('--after-context', String(req.after))
  }
  if (req.multiline) args.push('--multiline', '--multiline-dotall')
  if (req.type) args.push('--type', req.type)

  if (req.glob) {
    // The caller scoped the search deliberately — honour their glob verbatim and
    // do NOT re-apply the noise excludes (a glob of `dist/**` must still match).
    args.push('--glob', dir ? `${dir}/${req.glob}` : req.glob)
  } else {
    for (const g of RG_EXCLUDE_GLOBS) args.push('--glob', g)
  }

  args.push('--regexp', req.pattern, '--')
  args.push(dir || '.')
  return args
}

// ─── git grep ───────────────────────────────────────────────────────────────

function buildGitGrepArgs(req: GrepRequest, pcre: boolean, noIndex: boolean): string[] {
  const dir = req.path ? normalizeDir(req.path) : ''
  const args = ['grep', '--no-color', '-I']

  if (req.outputMode === 'files_with_matches') args.push('-l')
  else if (req.outputMode === 'count') args.push('-c')
  else args.push('-n')

  if (req.caseInsensitive) args.push('-i')
  if (req.outputMode === 'content') {
    if (req.before !== undefined && req.before > 0) args.push(`-B${req.before}`)
    if (req.after !== undefined && req.after > 0) args.push(`-A${req.after}`)
  }
  args.push(pcre ? '-P' : '-E')
  args.push(noIndex ? '--no-index' : '--untracked')
  args.push('-e', req.pattern, '--')
  if (req.glob) {
    args.push(`:(glob)${dir ? `${dir}/${req.glob}` : req.glob}`)
  } else {
    // A positive pathspec must precede the excludes — an exclude-only pathspec
    // matches nothing.
    args.push(dir || '.', ...GIT_EXCLUDE_PATHSPECS)
  }
  return args
}

function gitDegradationNote(req: GrepRequest, pcre: boolean): string | undefined {
  const lost: string[] = []
  if (req.type) lost.push('`type` (ripgrep-only file-type filter) was ignored — use `glob` instead')
  if (req.multiline) lost.push('`multiline` is unsupported by this backend — the search ran line-by-line')
  if (!pcre) {
    lost.push(
      'this backend is POSIX ERE, NOT ripgrep regex: `\\d` `\\w` `\\s` and lookahead do NOT match ' +
        'here (they fail silently). Use `[0-9]`, `[A-Za-z_]`, `[[:space:]]` instead',
    )
  }
  if (lost.length === 0) return undefined
  return `NOTE (ripgrep unavailable, searched with git grep): ${lost.join('; ')}.`
}

function splitLines(out: string): string[] {
  return out.split('\n').filter((l) => l.length > 0)
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function runGrep(cwd: string, req: GrepRequest): Promise<GrepOutcome> {
  if (await hasRipgrep()) {
    const res = await execCapture('rg', buildRgArgs(req), cwd)
    // rg: 0 = matches, 1 = no matches, 2 = error. Only a spawn failure or a hard
    // error falls through to git; "no matches" is a real, final answer.
    if (!res.spawnFailed && res.code <= 1) {
      return { lines: splitLines(res.stdout), backend: 'rg' }
    }
  }

  // git grep, PCRE first so the model's ripgrep-flavoured escapes keep working.
  for (const pcre of gitPcreUnsupported ? [false] : [true, false]) {
    for (const noIndex of [false, true]) {
      const res = await execCapture('git', buildGitGrepArgs(req, pcre, noIndex), cwd)
      if (res.spawnFailed) break
      if (pcre && isPcreUnsupported(res.stderr)) {
        // Remember for the engine lifetime so we stop paying for this attempt.
        gitPcreUnsupported = true
        break
      }
      if (res.code === 1) {
        return { lines: [], backend: pcre ? 'git-P' : 'git-E', note: gitDegradationNote(req, pcre) }
      }
      if (res.code === 0) {
        return {
          lines: splitLines(res.stdout),
          backend: pcre ? 'git-P' : 'git-E',
          note: gitDegradationNote(req, pcre),
        }
      }
      // code > 1 = not a repo (or an error): retry with --no-index, then degrade.
    }
  }

  return { lines: [], backend: 'git-E', note: 'Search backend unavailable (no ripgrep, and git grep failed).' }
}
