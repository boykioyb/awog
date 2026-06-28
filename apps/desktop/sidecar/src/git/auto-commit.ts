// Auto-commit helper invoked by the Task Execution Engine when a phase
// completes (Git Manager spec — "Auto-commit per phase" section, AC-37). Wired
// from `tasks/node-runner.ts`: after a node produces its artifact, this commits
// the code the agent wrote to the project repo (ADR 0024 D-8 two-tree).
//
// Spawn invariant: all `git` calls go through `runGit` (cwd = workspaceRoot,
// env whitelist). The commit serializes through the per-workspace mutex like
// every other mutator: the Task Engine runs up to 4 nodes of the same project in
// parallel and the user can drive the Git Manager on the same repo, so two
// unsynchronized `git add`/`commit` runs would otherwise collide on
// `.git/index.lock`. A generous wait lets queued node-commits take their turn
// rather than dropping (a later `add -A` would still capture the skipped
// changes, but per-node commits keep history granular).
import { runGit } from './runner.js'
import { withWorkspaceLock } from './mutex.js'
import { suppressEchoFor } from './watcher.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

// Pathspecs staged when scope = 'artifacts-only': the artifact/AWOG folders inside
// the project workspace, not the whole tree. Only paths that actually exist are
// passed to `git add` (an absent pathspec would make git error out).
const ARTIFACTS_ONLY_PATHSPECS = ['artifacts', '.awog'] as const

const AUTO_COMMIT_LOCK_TIMEOUT_MS = 30_000

export interface AutoCommitPhaseOptions {
  workspaceRoot: string
  taskId: string
  phaseId: string
  agentName: string
  agentRole?: string
  skillName?: string
  taskTitle?: string
  summary: string
  // Caller passes the template straight from settings (e.g.
  // `[{phaseId}] {agentName}: {summary}`). Tokens are substituted below.
  template: string
  // 'workspace' → stage the whole tree (`git add -A`). 'artifacts-only' → stage
  // only the project's artifact folders (artifacts/ + .awog/) so generated docs
  // get committed but agent-touched source files don't. Falls back to a no-op
  // (committed:false) when artifacts-only and neither folder has changes.
  scope: 'workspace' | 'artifacts-only'
  // Append the `Co-Authored-By: AWOG …` trailer (Git setting `commitCoAuthor`,
  // snapshotted on the task). Defaults to true when omitted.
  coAuthor?: boolean
}

// Mirrors the UI-side GIT_COAUTHOR_PROMPT trailer (utils/system-prompt.ts). The
// two runtimes can't share the literal, so keep them in sync by hand.
const CO_AUTHOR_TRAILER = 'Co-Authored-By: AWOG <noreply@awog.local>'

export interface AutoCommitResult {
  committed: boolean
  sha?: string
  sha7?: string
  // 'no-changes' | 'artifacts-only-unsupported' | 'commit-failed'
  reason?: string
}

const SUMMARY_MAX_LEN = 60

// Truncate to 60 chars (Git Manager spec — Auto-commit message template).
// Lowercase the first character so the conventional-commit "lower-case subject"
// guideline holds without forcing the whole summary lowercase (artifact titles
// may carry meaningful casing later in the body).
function normalizeSummary(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  const truncated =
    oneLine.length > SUMMARY_MAX_LEN ? `${oneLine.slice(0, SUMMARY_MAX_LEN - 1)}…` : oneLine
  if (truncated.length === 0) return truncated
  return truncated.charAt(0).toLowerCase() + truncated.slice(1)
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? '')
}

// List the artifacts-only pathspecs that exist in the working tree. `git ls-files`
// + `--others` covers tracked + untracked; we just probe each folder for any path
// under it. Returns the subset to hand to `git add` (empty → nothing to stage).
async function existingArtifactPathspecs(workspaceRoot: string): Promise<string[]> {
  const present: string[] = []
  for (const spec of ARTIFACTS_ONLY_PATHSPECS) {
    // eslint-disable-next-line no-await-in-loop
    const res = await runGit(
      workspaceRoot,
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', spec],
      { throwOnNonZero: false },
    )
    if (res.stdout.trim().length > 0) present.push(spec)
  }
  return present
}

export async function autoCommitPhase(opts: AutoCommitPhaseOptions): Promise<AutoCommitResult> {
  const summary = normalizeSummary(opts.summary)
  const subject = renderTemplate(opts.template, {
    phaseId: opts.phaseId,
    agentName: opts.agentName,
    agentRole: opts.agentRole ?? '',
    skillName: opts.skillName ?? '',
    taskId: opts.taskId,
    taskTitle: opts.taskTitle ?? '',
    summary,
    timestamp: new Date().toISOString(),
  })
  // Co-author trailer is opt-in (default on). Standard git trailer placement:
  // a blank line after the subject, then the trailer line.
  const message =
    opts.coAuthor === false ? subject : `${subject}\n\n${CO_AUTHOR_TRAILER}`

  return withWorkspaceLock(
    opts.workspaceRoot,
    async () => {
      // Pre-check: any change at all (staged, unstaged, untracked)? If the
      // working tree is clean nothing needs committing — skip silently per
      // spec edge case "Phase trigger auto-commit nhưng artifact chưa thực sự
      // thay đổi (no diff) → skip commit, log".
      const staged = await runGit(opts.workspaceRoot, ['diff', '--cached', '--quiet'], {
        throwOnNonZero: false,
      })
      const working = await runGit(opts.workspaceRoot, ['diff', '--quiet'], {
        throwOnNonZero: false,
      })
      const untracked = await runGit(
        opts.workspaceRoot,
        ['ls-files', '--others', '--exclude-standard'],
        { throwOnNonZero: false },
      )
      const hasUntracked = untracked.stdout.trim().length > 0
      if (staged.code === 0 && working.code === 0 && !hasUntracked) {
        log.info('autoCommit skipped — no changes', {
          taskId: opts.taskId,
          phaseId: opts.phaseId,
        })
        return { committed: false, reason: 'no-changes' }
      }

      // Resolve the pathspec to stage. 'workspace' → everything (`-A`).
      // 'artifacts-only' → just the artifacts/ + .awog/ folders that exist; if
      // neither has changes there is nothing artifact-scoped to commit.
      let addArgs: string[]
      let cachedQuietPathspec: string[] = []
      if (opts.scope === 'artifacts-only') {
        const specs = await existingArtifactPathspecs(opts.workspaceRoot)
        if (specs.length === 0) {
          log.info('autoCommit skipped — no artifact-scoped changes', {
            taskId: opts.taskId,
            phaseId: opts.phaseId,
          })
          return { committed: false, reason: 'no-changes' }
        }
        addArgs = ['add', '--', ...specs]
        cachedQuietPathspec = ['--', ...specs]
      } else {
        addArgs = ['add', '-A']
      }

      suppressEchoFor(opts.workspaceRoot)

      await runGit(opts.workspaceRoot, addArgs)

      // Some operations above (e.g. discard) may have left index in a state
      // where there is still nothing to commit (rare race). Re-check before
      // the actual commit to avoid the "nothing to commit" git error. For
      // artifacts-only the recheck is scoped to the same pathspec.
      const recheck = await runGit(
        opts.workspaceRoot,
        ['diff', '--cached', '--quiet', ...cachedQuietPathspec],
        { throwOnNonZero: false },
      )
      if (recheck.code === 0) {
        log.info('autoCommit skipped — index clean after add', {
          taskId: opts.taskId,
          phaseId: opts.phaseId,
        })
        return { committed: false, reason: 'no-changes' }
      }

      // For artifacts-only, scope the commit to the same pathspec so any files
      // a concurrent user staged outside the artifact folders are left alone.
      await runGit(opts.workspaceRoot, ['commit', '-F', '-', ...cachedQuietPathspec], {
        stdin: message,
      })

      const head = await runGit(opts.workspaceRoot, ['rev-parse', 'HEAD'])
      const sha = head.stdout.trim()
      const sha7 = sha.slice(0, 7)

      emit('git:status:changed', { reason: 'commit', workspaceRoot: opts.workspaceRoot })

      // Spec calls for a trace event `artifact.commit` appended to events.log.
      // The sidecar does not yet have a generic trace-event sink (the existing
      // events.log writer is owned by sessions runner). Log structured here so
      // the engine wiring can pull this back into the trace pipeline later.
      log.info('autoCommit done', {
        type: 'artifact.commit',
        taskId: opts.taskId,
        phaseId: opts.phaseId,
        commitSha: sha,
        commitSha7: sha7,
        message,
        scope: opts.scope,
        at: new Date().toISOString(),
      })

      return { committed: true, sha, sha7 }
    },
    { timeoutMs: AUTO_COMMIT_LOCK_TIMEOUT_MS },
  )
}
