// Auto-commit helper invoked by the Task Execution Engine when a phase
// completes (Git Manager spec — "Auto-commit per phase" section, AC-37).
//
// STATUS: helper ready, not wired. The sidecar's session runner today is
// chat-driven (`sessions/runner.ts`) and has no phase lifecycle anchor. Wiring
// this into `runner.ts` requires a phase-complete hook from the Task Execution
// Engine, which lands in a future milestone. Until then this module is
// importable + tested in isolation and the UI flow records `task.started_dirty`
// in console only (NewTaskModal).
//
// Spawn invariant: all `git` calls go through `runGit` (cwd = workspaceRoot,
// env whitelist). Mutex is acquired with `{ reentrant: true }` so callers that
// already hold the workspace lock — typically the engine while it is finishing
// a phase — don't deadlock.
import { runGit } from './runner.js'
import { withWorkspaceLock } from './mutex.js'
import { suppressEchoFor } from './watcher.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

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
  // v1 only honours 'workspace' (git add -A). 'artifacts-only' is reserved for
  // v2 once the engine carries explicit per-phase artifact pathspecs; we
  // accept the value here so call sites are stable across versions.
  scope: 'workspace' | 'artifacts-only'
}

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

export async function autoCommitPhase(opts: AutoCommitPhaseOptions): Promise<AutoCommitResult> {
  if (opts.scope === 'artifacts-only') {
    log.warn('autoCommit artifacts-only scope not supported in v1, falling back to workspace', {
      taskId: opts.taskId,
      phaseId: opts.phaseId,
    })
  }

  const summary = normalizeSummary(opts.summary)
  const message = renderTemplate(opts.template, {
    phaseId: opts.phaseId,
    agentName: opts.agentName,
    agentRole: opts.agentRole ?? '',
    skillName: opts.skillName ?? '',
    taskId: opts.taskId,
    taskTitle: opts.taskTitle ?? '',
    summary,
    timestamp: new Date().toISOString(),
  })

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

      suppressEchoFor(opts.workspaceRoot)

      // Stage everything in the working tree. v1 scope = 'workspace' only.
      await runGit(opts.workspaceRoot, ['add', '-A'])

      // Some operations above (e.g. discard) may have left index in a state
      // where there is still nothing to commit (rare race). Re-check before
      // the actual commit to avoid the "nothing to commit" git error.
      const recheck = await runGit(opts.workspaceRoot, ['diff', '--cached', '--quiet'], {
        throwOnNonZero: false,
      })
      if (recheck.code === 0) {
        log.info('autoCommit skipped — index clean after add', {
          taskId: opts.taskId,
          phaseId: opts.phaseId,
        })
        return { committed: false, reason: 'no-changes' }
      }

      await runGit(opts.workspaceRoot, ['commit', '-F', '-'], { stdin: message })

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
        scope: 'workspace',
        at: new Date().toISOString(),
      })

      return { committed: true, sha, sha7 }
    },
    { reentrant: true },
  )
}
