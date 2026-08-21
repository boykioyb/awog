// Runner: every `gh` subprocess goes through here. Mirrors git/runner.ts spawn
// invariant (ADR 0049) — execFile only, arg array only (NO shell), env
// whitelist only, cwd = project.path. Read-only; the surface is intentionally
// narrow (only server-loaded projectId + int number + enums + a validated
// login/assignee ever reach args).
//
// SECURITY (invariant #1): the token obtained via `gh auth token --user` for a
// non-active account is a SECRET. It is captured in-process, injected ONLY into
// the child's GH_TOKEN env, and NEVER logged / returned / placed in an RpcError.
// stderr is token-stripped before it can leave this function.
import { execFile, type ExecFileException } from 'node:child_process'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { GH_RPC_CODE, GhErrorCode, mapStderrToGhCode, sanitizeGhStderr } from './error-map.js'
import { listGhAccounts } from './accounts.js'

// env whitelist per ADR 0049. GH_TOKEN/GITHUB_TOKEN passed through so the active
// account works when the user exports a token; GH_TOKEN is also where we inject
// a resolved non-active-account token.
const ALLOW_ENV = [
  'PATH',
  'HOME',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'XDG_CONFIG_HOME',
  'LANG',
  'LC_ALL',
  'USERPROFILE',
  'SystemRoot',
] as const

function filteredEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const k of ALLOW_ENV) {
    const v = process.env[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

// GitHub login: alphanumeric, single internal hyphens, 1–39 chars. Also the
// shape we accept for `assignee` (plus the literal `@me` handled by callers).
const LOGIN_RE = /^[A-Za-z\d](?:-?[A-Za-z\d]){0,38}$/

export function isValidGhLogin(login: string): boolean {
  return LOGIN_RE.test(login)
}

const DEFAULT_TIMEOUT = 30_000
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024

interface ExecOpts {
  cwd?: string | undefined
  env: NodeJS.ProcessEnv
}

type ExecOutcome =
  | { ok: true; stdout: string }
  | { ok: false; kind: 'enoent' }
  // stdout is kept on failure too: `gh api graphql` exits non-zero for a PARTIAL
  // success (data + errors), and runGhAccountAllowPartial salvages that body.
  | { ok: false; kind: 'fail'; stdout: string; stderr: string; code: number; message: string }

function execOnce(args: readonly string[], opts: ExecOpts): Promise<ExecOutcome> {
  return new Promise<ExecOutcome>((resolveOutcome) => {
    execFile(
      'gh',
      [...args],
      {
        cwd: opts.cwd,
        env: opts.env,
        windowsHide: true,
        maxBuffer: DEFAULT_MAX_BUFFER,
        timeout: DEFAULT_TIMEOUT,
      },
      (err, stdoutBuf, stderrBuf) => {
        const decode = (v: string | Buffer | undefined | null): string => {
          if (v === undefined || v === null) return ''
          return typeof v === 'string' ? v : v.toString('utf8')
        }
        const stdout = decode(stdoutBuf as string | Buffer | undefined | null)
        const stderr = decode(stderrBuf as string | Buffer | undefined | null)
        if (err) {
          const ex = err as ExecFileException
          if (ex.code === 'ENOENT') {
            resolveOutcome({ ok: false, kind: 'enoent' })
            return
          }
          const exitCode = typeof ex.code === 'number' ? ex.code : -1
          resolveOutcome({
            ok: false,
            kind: 'fail',
            stdout,
            stderr,
            code: exitCode,
            message: ex.message ?? '',
          })
          return
        }
        resolveOutcome({ ok: true, stdout })
      },
    )
  })
}

// Map a non-zero / spawn failure to a stable RpcError. stderr is ALWAYS
// token-stripped before it leaves here, including the verbatim-UNKNOWN branch.
function throwForOutcome(outcome: Extract<ExecOutcome, { ok: false }>): never {
  if (outcome.kind === 'enoent') {
    throw new RpcError(GH_RPC_CODE, 'GitHub CLI (gh) not found', {
      ghCode: GhErrorCode.GH_NOT_FOUND,
    })
  }
  const sanitized = sanitizeGhStderr(outcome.stderr)
  const ghCode = mapStderrToGhCode(outcome.stderr)
  // Never surface ex.message (may carry the full command + env hints); only the
  // token-stripped stderr or a stable label.
  const message =
    ghCode === GhErrorCode.GH_NOT_AUTH
      ? 'Not logged in to GitHub CLI'
      : ghCode === GhErrorCode.GH_NO_REPO
        ? 'No GitHub remote for this repo'
        : sanitized || 'gh command failed'
  throw new RpcError(GH_RPC_CODE, message, { ghCode, stderrSanitized: sanitized })
}

// Run gh with the base env (no project cwd, no injected token) — for account
// introspection (`gh auth status`, `gh auth token`). NEVER log stdout of the
// latter (it is a token).
export async function runGhBase(args: readonly string[]): Promise<string> {
  const outcome = await execOnce(args, { env: filteredEnv() })
  if (outcome.ok) return outcome.stdout
  throwForOutcome(outcome)
}

// Resolve the GH_TOKEN to inject so a subprocess authenticates as `account`,
// WITHOUT mutating gh's global active account (NO `gh auth switch`):
//   - empty account → null (the base env / keyring active account serves it).
//   - the active login → null by default (base env already serves it); pass
//     `includeActive` to fetch its token anyway (git needs it — see below).
//   - a different (validated, known) login → its token via `gh auth token --user`.
// Throws RpcError on an unknown / malformed login. The returned token is a
// SECRET — inject it into a child env only; never log / return / surface it.
//
// `includeActive`: for git push/fetch/pull the token must be injected even for
// the active account. `gh auth git-credential` honors the URL's embedded
// username (`https://user@github.com`) and DECLINES when it mismatches the
// active account, so relying on the keyring fails for such remotes; an injected
// GH_TOKEN overrides the username check and always serves the pinned account.
export async function resolveGhTokenToInject(
  account?: string,
  opts: { includeActive?: boolean } = {},
): Promise<string | null> {
  const wanted = (account ?? '').trim()
  if (!wanted) return null

  if (!isValidGhLogin(wanted)) {
    throw new RpcError(GH_RPC_CODE, 'Invalid GitHub account', { ghCode: GhErrorCode.GH_NOT_AUTH })
  }

  const accounts = await listGhAccounts()
  const known = accounts.find((a) => a.login === wanted)
  if (!known) {
    throw new RpcError(GH_RPC_CODE, 'Unknown GitHub account', { ghCode: GhErrorCode.GH_NOT_AUTH })
  }
  // Active account → keyring already serves it; skip injection unless the caller
  // needs the token regardless (git).
  if (known.active && !opts.includeActive) return null

  const token = (
    await runGhBase(['auth', 'token', '--user', wanted, '--hostname', 'github.com'])
  ).trim()
  if (!token) {
    throw new RpcError(GH_RPC_CODE, 'Not logged in to GitHub CLI', {
      ghCode: GhErrorCode.GH_NOT_AUTH,
    })
  }
  return token
}

// Resolve the env a repo-scoped gh command should run with, honoring `account`
// (see resolveGhTokenToInject). Injects the resolved token into GH_TOKEN.
export async function resolveGhEnv(account?: string): Promise<NodeJS.ProcessEnv> {
  const env = filteredEnv()
  const token = await resolveGhTokenToInject(account)
  if (token) {
    env.GH_TOKEN = token
    // gh also honors GITHUB_TOKEN; drop any inherited one so the injected
    // GH_TOKEN wins deterministically (gh prefers GH_TOKEN, but keep it clean).
    delete env.GITHUB_TOKEN
  }
  return env
}

// Run an ACCOUNT-scoped gh command that isn't tied to a repo (e.g. the
// notifications inbox). Same token handling as runGh; no cwd because no repo is
// resolved — nothing path-like from params is involved at all.
export async function runGhAccount(
  args: readonly string[],
  account?: string,
): Promise<string> {
  const env = await resolveGhEnv(account)
  log.info('gh exec', { sub: args.slice(0, 2).join(' ') })
  const outcome = await execOnce(args, { env })
  if (outcome.ok) return outcome.stdout
  throwForOutcome(outcome)
}

// Like runGhAccount, but tolerates a non-zero exit WHEN gh still printed a body.
// Exists for `gh api graphql`: GraphQL answers partial success as data + errors,
// and gh exits 1 for it — so the strict runner would throw away perfectly good rows
// because one aliased sub-query was denied. Only stdout is returned; stderr is
// dropped rather than surfaced (it can echo the request, and a caller that wanted
// the failure would use the strict runner).
export async function runGhAccountAllowPartial(
  args: readonly string[],
  account?: string,
): Promise<string> {
  const env = await resolveGhEnv(account)
  log.info('gh exec', { sub: args.slice(0, 2).join(' ') })
  const outcome = await execOnce(args, { env })
  if (outcome.ok) return outcome.stdout
  // A body means gh reached GitHub and got an answer — hand it to the caller, whose
  // schema decides whether it is usable. No body (or a spawn failure: gh missing)
  // is a real error and takes the normal path.
  if (outcome.kind === 'fail' && outcome.stdout.trim() !== '') return outcome.stdout
  throwForOutcome(outcome)
}

// Run a repo-scoped gh command. `cwd` = project.path (server-loaded). `account`
// optionally selects a non-active gh account (token injected, never logged).
export async function runGh(
  args: readonly string[],
  cwd: string,
  account?: string,
): Promise<string> {
  const env = await resolveGhEnv(account)
  // Log the subcommand only (args[0..1]) — never the full args (no token here,
  // but keep logging minimal and stable) and never the env.
  log.info('gh exec', { sub: args.slice(0, 2).join(' ') })
  const outcome = await execOnce(args, { cwd, env })
  if (outcome.ok) return outcome.stdout
  throwForOutcome(outcome)
}
