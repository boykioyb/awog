// Error envelope per ADR 0017. GitErrorCode is the enum surfaced to the UI
// via RpcError.data.gitCode; the numeric RPC code is the JSON-RPC custom
// range -32100 + offset (avoids collision with reserved -32700..-32000).
import { homedir } from 'node:os'

export const GitErrorCode = {
  OK: 'OK',
  BUSY: 'BUSY',
  DIRTY_TREE: 'DIRTY_TREE',
  NOT_FAST_FORWARD: 'NOT_FAST_FORWARD',
  MERGE_CONFLICT: 'MERGE_CONFLICT',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  REMOTE_NOT_FOUND: 'REMOTE_NOT_FOUND',
  UNMERGED: 'UNMERGED',
  FILE_LOCKED: 'FILE_LOCKED',
  GIT_NOT_FOUND: 'GIT_NOT_FOUND',
  INVALID_PATH: 'INVALID_PATH',
  INVALID_REF: 'INVALID_REF',
  ENCODING_UNSUPPORTED: 'ENCODING_UNSUPPORTED',
  CANCELLED: 'CANCELLED',
  // NO_REPO: workspace tồn tại nhưng chưa init Git. Surfaced bởi `git.status`
  // để UI render empty-state + CTA "Initialize repo" (AC edge case M7). Mở
  // rộng từ 17 mã ban đầu của ADR 0017; gitCode được tham chiếu trực tiếp ở
  // UI store, không cần update ADR riêng vì đây chỉ là phân tách sub-case
  // của `INVALID_PATH` (repo-level).
  NO_REPO: 'NO_REPO',
  UNKNOWN: 'UNKNOWN',
} as const

export type GitErrorCode = (typeof GitErrorCode)[keyof typeof GitErrorCode]

// JSON-RPC numeric code per ADR. Single envelope code -32100 with `gitCode`
// in `data` keeps the IPC contract simple — UI dispatches on gitCode, not
// the wire-level number.
export const GIT_RPC_CODE = -32100

// Heuristic regex map. Order matters — most specific first.
const STDERR_PATTERNS: Array<[RegExp, GitErrorCode]> = [
  // `git` outside repo. Match before `index.lock` etc. — most specific first.
  [/not a git repository|fatal: not a git repository/i, GitErrorCode.NO_REPO],
  [/index\.lock|unable to create.*index\.lock/i, GitErrorCode.BUSY],
  [/your local changes.*would be overwritten|commit your changes or stash/i, GitErrorCode.DIRTY_TREE],
  [/non-fast-forward|rejected.*fetch first/i, GitErrorCode.NOT_FAST_FORWARD],
  [/merge conflict|automatic merge failed|conflict.*content|fix conflicts/i, GitErrorCode.MERGE_CONFLICT],
  // `could not read Username`/`Password` (+ `terminal prompts disabled`) is the
  // no-credential case: the URL carries a username (`https://user@host`) but no
  // helper returned a token, so git wanted an interactive prompt we disabled.
  [/authentication failed|could not read.*(username|password)|terminal prompts disabled|permission denied \(publickey\)|access denied/i, GitErrorCode.AUTH_FAILED],
  [/could not resolve host|network is unreachable|connection (refused|timed out)|unable to access/i, GitErrorCode.NETWORK_ERROR],
  [/no such remote|does not appear to be a git repository.*remote/i, GitErrorCode.REMOTE_NOT_FOUND],
  [/the branch .* is not fully merged/i, GitErrorCode.UNMERGED],
  [/unable to unlink|file in use|permission denied/i, GitErrorCode.FILE_LOCKED],
  [/not a valid (object|ref)|bad revision|invalid reference/i, GitErrorCode.INVALID_REF],
]

export function mapStderrToCode(stderr: string): GitErrorCode {
  for (const [re, code] of STDERR_PATTERNS) {
    if (re.test(stderr)) return code
  }
  return GitErrorCode.UNKNOWN
}

// Surface a specific auth flavour so the UI can give actionable copy
// (SSH key reminder vs HTTPS token rotation).
export type AuthHint = 'ssh-key' | 'https-token' | 'unknown'

export function detectAuthHint(stderr: string): AuthHint | null {
  const s = stderr.toLowerCase()
  if (/permission denied \(publickey\)/.test(s)) return 'ssh-key'
  if (
    /authentication failed/.test(s) ||
    /could not read (username|password)/.test(s) ||
    /terminal prompts disabled/.test(s) ||
    /remote: invalid username or password/.test(s)
  ) {
    return 'https-token'
  }
  if (/permission denied/.test(s) || /authenticat/.test(s)) return 'unknown'
  return null
}

// Strip secrets / absolute paths / request IDs before surfacing to UI.
// Limits to 4 KB tail per ADR.
export function sanitizeStderr(stderr: string): string {
  if (!stderr) return ''
  let out = stderr
  // Embedded credentials in URLs: https://user:token@host or https://token@host.
  out = out.replace(/https?:\/\/[^/\s@]*:[^/\s@]+@/g, (m) => `${m.split('://')[0]}://***@`)
  out = out.replace(/https?:\/\/[A-Za-z0-9_.-]{20,}@/g, (m) => `${m.split('://')[0]}://***@`)
  // Well-known token shapes.
  out = out.replace(/sk-[A-Za-z0-9_-]{20,}/g, '<token>')
  // All GitHub token shapes: ghp_ (PAT), gho_ (oauth), ghu_/ghs_ (app), ghr_
  // (refresh) — the gh-account push path injects one of these into the child env.
  out = out.replace(/gh[posur]_[A-Za-z0-9]{20,}/g, '<token>')
  out = out.replace(/github_pat_[A-Za-z0-9_]{20,}/g, '<token>')
  // GitHub request ID echoed in some failures.
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
