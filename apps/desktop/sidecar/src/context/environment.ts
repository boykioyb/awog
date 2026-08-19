// Environment + workspace-state orientation blocks — ADR 0071.
//
// The Pi path used to send the model NO situational context at all: not the OS,
// not the date, not the working directory, not the branch, not whether the tree
// was dirty. So it guessed — Linux `find` flags on macOS, questions whose answer
// `git status` already held, edits on top of uncommitted work it could not see.
// The Claude Code CLI injects exactly this block at startup, which is a large
// part of why the same model reads as "senior" there and "junior" here.
//
// Split into two blocks on purpose, and the split is about PROMPT CACHING:
//
//   <environment>   machine + workspace facts. Stable for the whole session, so
//                   it rides in the system prompt where it is cached.
//   <current_state> date + git snapshot. Changes as the user works, so it rides
//                   on the TURN PROMPT. Putting volatile text in the system
//                   prompt would change the cached prefix on nearly every turn
//                   and force a full re-write of the session's whole context
//                   (pi-ai marks the system prompt as one cache block, so any
//                   edit to it invalidates everything after it).
//
// Both are built from ONE `collectWorkspaceSnapshot` call so a turn spawns git
// once, not twice. Every git read is best-effort: a non-repo, a missing binary,
// or a timeout yields a partial snapshot rather than an error, because
// orientation context must never be what fails a turn.
import { arch, platform, release } from 'node:os'
import { runGit } from '../git/runner.js'
import { log } from '../util/logger.js'

// Short timeout per git read: this runs on the critical path of every turn, and
// stale-but-fast orientation beats a turn that stalls behind a slow status.
const GIT_TIMEOUT_MS = 5_000

// Cap the changed-path list. A tree with hundreds of dirty files is real (a
// generated build dir, a big rebase) and dumping all of it would crowd out the
// user's actual request; the count still tells the model the tree is dirty.
const MAX_CHANGED_PATHS = 30

const RECENT_COMMIT_COUNT = 5

export interface WorkspaceSnapshot {
  // Absolute repo root, absent when cwd is not inside a git repository.
  repoRoot?: string
  // Current branch, absent on a detached HEAD (see `detachedAt`).
  branch?: string
  // Short sha when HEAD is detached — the model must not assume a branch exists.
  detachedAt?: string
  // Commits ahead of / behind the tracked upstream. Absent when no upstream.
  ahead?: number
  behind?: number
  staged: string[]
  unstaged: string[]
  untracked: string[]
  // Changed paths omitted from the three lists above by MAX_CHANGED_PATHS.
  omittedPaths: number
  // `<short sha> <subject>` lines, newest first.
  recentCommits: string[]
}

// Run a read-only git command, returning trimmed stdout or undefined. Read
// probes set GIT_OPTIONAL_LOCKS=0 upstream in runGit, so none of these can
// contend with a concurrent write for `.git/index.lock`.
async function gitRead(cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const res = await runGit(cwd, args, { throwOnNonZero: false, timeoutMs: GIT_TIMEOUT_MS })
    if (res.code !== 0) return undefined
    // trimEnd, NOT trim: `status --porcelain=v1` encodes the index status in the
    // FIRST character of each line, so a worktree-only change reads ` M path`.
    // Stripping leading whitespace shifts that line by one — the path loses its
    // first letter and an unstaged change is misreported as staged.
    const out = res.stdout.trimEnd()
    return out.length > 0 ? out : undefined
  } catch {
    // Git missing / workspace gone / timeout — orientation is optional.
    return undefined
  }
}

// Parse `git status --porcelain=v1` into staged / unstaged / untracked buckets.
// Format is `XY <path>`, where X is the index status and Y the worktree status;
// `??` marks an untracked path. A rename reads `R  old -> new`; we keep the
// right-hand (current) path since that is what the model would act on.
function parseStatus(stdout: string): Pick<
  WorkspaceSnapshot,
  'staged' | 'unstaged' | 'untracked' | 'omittedPaths'
> {
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []
  let omittedPaths = 0

  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue
    const xy = line.slice(0, 2)
    const rawPath = line.slice(3)
    const arrow = rawPath.lastIndexOf(' -> ')
    const path = arrow >= 0 ? rawPath.slice(arrow + 4) : rawPath
    const total = staged.length + unstaged.length + untracked.length
    if (total >= MAX_CHANGED_PATHS) {
      omittedPaths += 1
      continue
    }
    if (xy === '??') {
      untracked.push(path)
      continue
    }
    // A path can be both staged and unstaged (staged edit, then edited again) —
    // it belongs in both buckets, which is exactly what the model needs to know.
    if (xy[0] !== ' ' && xy[0] !== '?') staged.push(path)
    if (xy[1] !== ' ' && xy[1] !== '?') unstaged.push(path)
  }

  return { staged, unstaged, untracked, omittedPaths }
}

// Parse `git rev-list --left-right --count @{u}...HEAD` → `<behind>\t<ahead>`.
function parseAheadBehind(stdout: string): { ahead?: number; behind?: number } {
  const [behindRaw, aheadRaw] = stdout.trim().split(/\s+/)
  const behind = Number(behindRaw)
  const ahead = Number(aheadRaw)
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return {}
  return { ahead, behind }
}

// Collect the git side of the orientation context. Returns undefined when `cwd`
// is absent or is not a git repository — callers then emit the environment block
// without repo facts rather than claiming a repo that is not there.
export async function collectWorkspaceSnapshot(
  cwd: string | undefined,
): Promise<WorkspaceSnapshot | undefined> {
  if (!cwd) return undefined
  const repoRoot = await gitRead(cwd, ['rev-parse', '--show-toplevel'])
  if (!repoRoot) return undefined

  // Independent reads — issue them together rather than serialising four round
  // trips on the turn's critical path.
  const [branchOut, statusOut, logOut, aheadBehindOut] = await Promise.all([
    gitRead(cwd, ['branch', '--show-current']),
    gitRead(cwd, ['status', '--porcelain=v1']),
    gitRead(cwd, ['log', `-${RECENT_COMMIT_COUNT}`, '--format=%h %s']),
    gitRead(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']),
  ])

  const snapshot: WorkspaceSnapshot = {
    repoRoot,
    staged: [],
    unstaged: [],
    untracked: [],
    omittedPaths: 0,
    recentCommits: logOut ? logOut.split('\n').filter((l) => l.length > 0) : [],
  }

  if (branchOut) {
    snapshot.branch = branchOut
  } else {
    // Empty `--show-current` means detached HEAD (or an unborn branch in a fresh
    // repo, where rev-parse also yields nothing — then neither field is set).
    const sha = await gitRead(cwd, ['rev-parse', '--short', 'HEAD'])
    if (sha) snapshot.detachedAt = sha
  }

  if (statusOut) Object.assign(snapshot, parseStatus(statusOut))
  if (aheadBehindOut) Object.assign(snapshot, parseAheadBehind(aheadBehindOut))

  return snapshot
}

function platformName(): string {
  switch (platform()) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return platform()
  }
}

// Stable half: machine + workspace facts. Safe to cache for the whole session.
// `cwd` absent means no project/folder is bound — say so explicitly rather than
// leaving the model to infer a working directory it does not have.
export function buildEnvironmentBlock(
  cwd: string | undefined,
  snapshot: WorkspaceSnapshot | undefined,
): string {
  const lines: string[] = [
    `Platform: ${platformName()} (${platform()} ${release()}, ${arch()})`,
    `Default shell: ${process.env.SHELL || 'unknown'}`,
  ]
  if (cwd) {
    lines.push(`Working directory: ${cwd}`)
    lines.push(
      snapshot?.repoRoot
        ? `Git repository: yes (root ${snapshot.repoRoot})`
        : 'Git repository: no — this directory is not inside a git repo.',
    )
  } else {
    lines.push(
      'Working directory: none — no project or folder is attached to this session, so file and shell tools have no workspace to act in. Ask the user to attach one before attempting filesystem work.',
    )
  }
  return `<environment>\n${lines.join('\n')}\n</environment>`
}

// Volatile half: today's date plus the git snapshot. Rebuilt every turn and
// carried on the TURN PROMPT (never the system prompt — see the header note).
// `now` is injected so the caller owns the clock.
export function buildCurrentStateBlock(
  snapshot: WorkspaceSnapshot | undefined,
  now: Date = new Date(),
): string {
  const lines: string[] = [
    `Today's date: ${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-US', { weekday: 'long' })})`,
  ]

  if (snapshot) {
    if (snapshot.branch) lines.push(`Current branch: ${snapshot.branch}`)
    else if (snapshot.detachedAt) {
      lines.push(
        `HEAD is DETACHED at ${snapshot.detachedAt} — there is no current branch. Do not commit here without telling the user.`,
      )
    }
    if (snapshot.ahead !== undefined && snapshot.behind !== undefined) {
      lines.push(`Versus upstream: ${snapshot.ahead} ahead, ${snapshot.behind} behind`)
    }

    const dirty = snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length
    if (dirty === 0 && snapshot.omittedPaths === 0) {
      lines.push('Working tree: clean')
    } else {
      const bucket = (label: string, paths: string[]): void => {
        if (paths.length > 0) lines.push(`${label} (${paths.length}): ${paths.join(', ')}`)
      }
      lines.push('Working tree: DIRTY — the user has uncommitted work here.')
      bucket('Staged', snapshot.staged)
      bucket('Modified, not staged', snapshot.unstaged)
      bucket('Untracked', snapshot.untracked)
      if (snapshot.omittedPaths > 0) {
        lines.push(`(+${snapshot.omittedPaths} further changed path(s) not listed)`)
      }
    }

    if (snapshot.recentCommits.length > 0) {
      lines.push('Recent commits (newest first):')
      for (const c of snapshot.recentCommits) lines.push(`  ${c}`)
    }
  }

  lines.push(
    'This snapshot was taken when the turn started. Re-run the relevant git command yourself before acting on repository state you need to be exact.',
  )

  return `<current_state>\n${lines.join('\n')}\n</current_state>`
}

// Convenience wrapper for the one-shot paths (tasks, subagents) that want both
// blocks in the system prompt and have no separate turn prompt to split across.
// A task node is a single request, so there is no cache prefix to protect.
export async function buildOneShotContextBlock(cwd: string | undefined): Promise<string> {
  let snapshot: WorkspaceSnapshot | undefined
  try {
    snapshot = await collectWorkspaceSnapshot(cwd)
  } catch (err) {
    log.warn('environment: workspace snapshot failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  return `${buildEnvironmentBlock(cwd, snapshot)}\n\n${buildCurrentStateBlock(snapshot)}`
}
