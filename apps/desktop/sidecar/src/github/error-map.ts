// Error envelope for the `gh` CLI methods (ADR 0049). Mirrors git/error-map.ts:
// a single JSON-RPC envelope code with a stable `ghCode` string in `data`, so
// the UI dispatches on `ghCode` (GH_NOT_FOUND / GH_NOT_AUTH / GH_NO_REPO /
// UNKNOWN) to pick the right empty-state copy.
import { homedir } from 'node:os'

export const GhErrorCode = {
  // gh binary not installed (ENOENT). UI → "install GitHub CLI".
  GH_NOT_FOUND: 'GH_NOT_FOUND',
  // gh installed but not logged in (or token rejected). UI → "gh auth login".
  GH_NOT_AUTH: 'GH_NOT_AUTH',
  // repo has no GitHub remote / not a repo. UI → "no GitHub repo linked".
  GH_NO_REPO: 'GH_NO_REPO',
  // anything else — stderr (token-stripped) is surfaced verbatim.
  UNKNOWN: 'UNKNOWN',
} as const

export type GhErrorCode = (typeof GhErrorCode)[keyof typeof GhErrorCode]

// Same custom envelope code family as git (ADR 0017/0049) — distinct from git's
// -32100 so the UI never confuses the two surfaces.
export const GH_RPC_CODE = -32110

// Heuristic stderr → code map. Order matters — most specific first. `gh` writes
// human messages to stderr; match the stable substrings it uses across 2.x.
const STDERR_PATTERNS: Array<[RegExp, GhErrorCode]> = [
  // Not logged in / token rejected / auth required.
  [
    /not logged|authentication required|gh auth login|bad credentials|requires authentication|http 401/i,
    GhErrorCode.GH_NOT_AUTH,
  ],
  // No GitHub remote / not inside a git repo / can't infer the repo.
  [
    /no git remotes|none of the git remotes|not a git repository|could not determine|no default remote|failed to run git/i,
    GhErrorCode.GH_NO_REPO,
  ],
]

export function mapStderrToGhCode(stderr: string): GhErrorCode {
  for (const [re, code] of STDERR_PATTERNS) {
    if (re.test(stderr)) return code
  }
  return GhErrorCode.UNKNOWN
}

// Strip GitHub tokens (and the token we may have injected via GH_TOKEN) from any
// stderr before it can leave the sidecar (invariant #1). Covers every gh token
// shape: gho_/ghp_/ghs_/ghu_/ghr_ (the `gh[posru]_` family) + fine-grained
// `github_pat_…`. Also drops absolute home paths and the GitHub request id.
export function sanitizeGhStderr(stderr: string): string {
  if (!stderr) return ''
  let out = stderr
  // gh classic token family: gho_/ghp_/ghs_/ghu_/ghr_ …
  out = out.replace(/gh[posru]_[A-Za-z0-9]{20,}/g, '<token>')
  // fine-grained PAT.
  out = out.replace(/github_pat_[A-Za-z0-9_]{20,}/g, '<token>')
  // any embedded credential in a URL (https://user:token@host or https://token@host).
  out = out.replace(/https?:\/\/[^/\s@]*:[^/\s@]+@/g, (m) => `${m.split('://')[0]}://***@`)
  // GitHub request id echoed in some failures.
  out = out.replace(/\bX-GitHub-Request-Id:[^\n]*/gi, '')
  // Replace home dir absolute paths with ~.
  const home = homedir()
  if (home && home.length > 1) {
    const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(escaped, 'g'), '~')
  }
  if (out.length > 4096) {
    out = `${out.slice(-4096)}… [truncated]`
  }
  return out
}
