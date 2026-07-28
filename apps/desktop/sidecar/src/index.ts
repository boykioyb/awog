import { startStdioLoop, send, resolveHostResponse } from './transport/stdio.js'
import { dispatch, RpcError } from './transport/rpc.js'
import { log } from './util/logger.js'

// Side-effect imports register methods into the RPC registry.
import './methods/ping.js'
import './methods/auth.start-oauth.js'
import './methods/auth.complete-oauth.js'
import './methods/auth.start-oauth-codex.js'
import './methods/auth.cancel-oauth.js'
import './methods/accounts.list.js'
import './methods/accounts.add-api-key.js'
import './methods/accounts.update.js'
import './methods/accounts.remove.js'
import './methods/accounts.set-active.js'
import './methods/accounts.test.js'
import './methods/models.list.js'
import './methods/settings.get.js'
import './methods/settings.set.js'
import './methods/sessions.send-message.js'
import './methods/sessions.compact.js'
import './methods/sessions.cancel.js'
import './methods/sessions.turn-active.js'
import './methods/sessions.active-turns.js'
import './methods/sessions.background-list.js'
import './methods/sessions.background-kill.js'
import './methods/sessions.steer.js'
import './methods/sessions.permission.js'
import './methods/sessions.answer-question.js'
import './methods/sessions.list.js'
import './methods/sessions.get.js'
import './methods/sessions.cost-breakdown.js'
import './methods/sessions.upsert.js'
import './methods/sessions.truncate.js'
import './methods/sessions.generate-title.js'
import './methods/sessions.enhance-prompt.js'
import './methods/sessions.summarize-prompt.js'
import './methods/sessions.search.js'
import './methods/sessions.rewind.js'
import './methods/sessions.list-snapshots.js'
import './methods/sessions.delete.js'
import './methods/sessions.save-export.js'
import './methods/account.usage.js'
import './methods/dashboard.usage.js'
import './methods/activity.summary.js'
import './methods/activity.pricing.js'
import './methods/activity.pricing.fetch.js'
import './methods/projects.list.js'
import './methods/projects.upsert.js'
import './methods/projects.delete.js'
import './methods/projects.clone.js'
import './methods/projects.inspect.js'
import './methods/projects.inspect-remote.js'
import './methods/projects.generate-description.js'
import './methods/skills.list.js'
import './methods/skills.upsert.js'
import './methods/skills.delete.js'
import './methods/skills.generate.js'
import './methods/skills.author.js'
import './methods/sources.list.js'
import './methods/sources.get.js'
import './methods/source.upsert.js'
import './methods/source.delete.js'
import './methods/source.toggle.js'
import './methods/source.toggle-tool.js'
import './methods/source.test.js'
import './methods/source.guide.js'
import './methods/source.permissions.js'
import './methods/source.save-guide.js'
import './methods/source.save-permissions.js'
import './methods/source.tools.js'
import './methods/source.resolve-icon.js'
import './methods/source.discover-preset.js'
import './methods/source.list-presets.js'
import './methods/source.author.js'
import './methods/source.set-secret.js'
import './methods/source.pending-secrets.js'
import './methods/source.set-api-credential.js'
import './methods/source.start-oauth.js'
import './methods/source.cancel-oauth.js'
import './methods/ssh.list.js'
import './methods/ssh.upsert.js'
import './methods/ssh.delete.js'
import './methods/ssh.identity-upsert.js'
import './methods/ssh.identity-delete.js'
import './methods/ssh.set-credential.js'
import './methods/ssh.get-credential.js'
import './methods/ssh.detect-key-type.js'
import './methods/ssh.import-config.js'
import './methods/ssh.import-config-apply.js'
import './methods/ssh.connect.js'
import './methods/ssh.write.js'
import './methods/ssh.resize.js'
import './methods/ssh.disconnect.js'
import './methods/ssh.connections.js'
import './methods/ssh.confirm-host-key.js'
import './methods/ssh.test.js'
import './methods/ssh.exec.js'
import './methods/ssh.run-in-shell.js'
import './methods/ssh.sftp.list.js'
import './methods/ssh.sftp.read.js'
import './methods/ssh.sftp.mkdir.js'
import './methods/ssh.sftp.rename.js'
import './methods/ssh.sftp.delete.js'
import './methods/ssh.sftp.download.js'
import './methods/ssh.sftp.upload.js'
import './methods/ssh.sftp.chmod.js'
import './methods/ssh.sftp.createFile.js'
import './methods/ssh.sftp.copy.js'
import './methods/ssh.sftp.compress.js'
import './methods/ssh.sftp.extract.js'
import './methods/ssh.sftp.chown.js'
import './methods/ssh.sftp.toolcheck.js'
import './methods/ssh.sftp.statx.js'
import './methods/ssh.forward.start.js'
import './methods/ssh.forward.stop.js'
import './methods/ssh.forward.list.js'
import './methods/vpn.list.js'
import './methods/vpn.upsert.js'
import './methods/vpn.delete.js'
import './methods/vpn.set-credential.js'
import './methods/vpn.get-credential.js'
import './methods/vpn.up.js'
import './methods/vpn.down.js'
import './methods/vpn.submit-challenge.js'
import './methods/vpn.status.js'
import './methods/vpn.import-ovpn.js'
import './methods/agents.list.js'
import './methods/agents.upsert.js'
import './methods/agents.delete.js'
import './methods/agents.author.js'
import './methods/agents.generate.js'
import './methods/workflows.list.js'
import './methods/workflows.upsert.js'
import './methods/workflows.delete.js'
import './methods/workflows.generate.js'
import './methods/tasks.list.js'
import './methods/tasks.get.js'
import './methods/tasks.create.js'
import './methods/tasks.delete.js'
import './methods/tasks.rename.js'
import './methods/tasks.approve-phase.js'
import './methods/tasks.rerun-phase.js'
import './methods/tasks.discuss.js'
import './methods/tasks.cancel.js'
import './methods/tasks.pause.js'
import './methods/tasks.resume.js'
import './methods/git.check-installed.js'
import './methods/git.discover-repos.js'
import './methods/git.init.js'
import './methods/git.get-identity.js'
import './methods/git.set-identity.js'
import './methods/git.status.js'
import './methods/git.log.js'
import './methods/git.diff.js'
import './methods/git.branch-list.js'
import './methods/git.stash-list.js'
import './methods/git.remote-list.js'
import './methods/git.remote-add.js'
import './methods/git.remote-set-url.js'
import './methods/git.remote-remove.js'
import './methods/git.stage-file.js'
import './methods/git.stage-hunk.js'
import './methods/git.unstage-hunk.js'
import './methods/git.unstage-file.js'
import './methods/git.discard-file.js'
import './methods/git.commit.js'
import './methods/git.branch-create.js'
import './methods/git.branch-checkout.js'
import './methods/git.branch-delete.js'
import './methods/git.checkout-file-at-commit.js'
import './methods/git.stash-save.js'
import './methods/git.stash-pop.js'
import './methods/git.stash-apply.js'
import './methods/git.stash-drop.js'
import './methods/git.read-conflict-file.js'
import './methods/git.resolve-file.js'
import './methods/git.resolve-file-binary.js'
import './methods/git.merge-abort.js'
import './methods/git.complete-merge.js'
import './methods/git.merge.js'
import './methods/git.rebase.js'
import './methods/git.rebase-continue.js'
import './methods/git.rebase-abort.js'
import './methods/git.fetch.js'
import './methods/git.pull.js'
import './methods/git.push.js'
import './methods/git.cancel.js'
import './methods/git.generate-commit-message.js'
import './methods/git.generate-pr-summary.js'
import './methods/git.tag-create.js'
import './methods/git.tag-list.js'
import './methods/git.tag-delete.js'
import './methods/git.ignore.js'
import './methods/git.checkout-commit.js'
import './methods/git.cherry-pick.js'
import './methods/git.revert-commit.js'
import './methods/git.reset-to.js'
import './methods/git.format-patch.js'
import './methods/git.save-patch.js'
import './methods/gh.accounts.js'
import './methods/gh.list.js'
import './methods/gh.get.js'
import './methods/gh.diff.js'
import './methods/gh.commits.js'
import './methods/gh.comment.js'
import './methods/gh.review.js'
import './methods/gh.translate.js'
import './methods/gh.enhance.js'
import './methods/text.translate.js'
import './methods/fs.list-dir.js'
import './methods/fs.list-files.js'
import './methods/fs.read-file.js'
import './methods/fs.read-file-base64.js'
import './methods/fs.write-file.js'
import './methods/fs.create-file.js'
import './methods/fs.create-dir.js'
import './methods/fs.rename.js'
import './methods/fs.delete.js'
import './methods/fs.search.js'
import './methods/fs.watch.js'
import './methods/fs.unwatch.js'
import './methods/terminal.create.js'
import './methods/terminal.write.js'
import './methods/terminal.resize.js'
import './methods/terminal.kill.js'
import './methods/terminal.list.js'
import './methods/hooks.list.js'
import './methods/hooks.upsert.js'
import './methods/hooks.delete.js'
import './methods/hooks.toggle.js'
import './methods/hooks.run-once.js'
import './methods/hooks.trust.js'
import './methods/hooks.read-script.js'
import './methods/hooks.write-script.js'
import './methods/hooks.generate.js'
import './methods/hooks.generate-script.js'
import './methods/rules.list.js'
import './methods/rules.upsert.js'
import './methods/rules.delete.js'
import './methods/rules.toggle.js'
import './methods/rules.generate.js'
import './methods/commands.list.js'
import './methods/commands.upsert.js'
import './methods/commands.delete.js'
import './methods/commands.toggle.js'
import './methods/commands.generate.js'
import './methods/migration.scan.js'
import './methods/migration.import.js'
import './methods/templates.list.js'
import './methods/templates.get.js'
import './methods/templates.create.js'
import './methods/templates.fetch-remote.js'
import './methods/templates.install.js'
import './methods/templates.delete.js'
import { migrateMcpPlaintextSecrets } from './mcp/store.js'
import { migrateMcpServersToSources } from './sources/migrate.js'
import { sessionManager } from './sessions/session-manager.js'
import { awogWatcher } from './watcher.js'
import { resumeOnBoot } from './tasks/engine.js'
import { reloadBackgroundShells } from './sessions/bg-registry.js'
import { ensureUserPath } from './util/spawn-path.js'

// Last-resort crash guards. A broken pipe from a spawned child (e.g. the Claude
// Agent SDK subprocess dying mid-turn) surfaces as an async 'error' event on a
// socket with NO listener — Node's default is to rethrow it as an uncaught
// exception, which would take down the WHOLE engine (every session, task,
// watcher) over one turn's recoverable I/O failure. Swallow ONLY these
// recoverable pipe errors: the turn's own runtime path still observes the
// subprocess exit and rejects (→ session.message.done stopReason 'error' + RPC
// reject → UI alert). Any OTHER uncaught error is a real bug — log it and exit
// so the Electron host restarts a clean engine (fail-fast; never mask a bug).
const RECOVERABLE_IO_CODES = new Set(['EPIPE', 'ECONNRESET'])
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code
  if (code && RECOVERABLE_IO_CODES.has(code)) {
    log.warn('recoverable uncaughtException (broken pipe from child process)', {
      code,
      message: err.message,
    })
    return
  }
  log.error('fatal uncaughtException — exiting', { message: err.message, stack: err.stack })
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  const code = (reason as NodeJS.ErrnoException | null)?.code
  if (code && RECOVERABLE_IO_CODES.has(code)) {
    log.warn('recoverable unhandledRejection (broken pipe)', { code })
    return
  }
  log.error('unhandledRejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
  })
})

// Graceful shutdown: flush pending debounced session writes to disk BEFORE exiting.
// Session persistence is debounced (500ms) + coalesced, so a fresh session or a
// just-finished turn can still be in the queue when the host quits — the old
// event-sourced store awaited every append, this one must flush on quit (ADR 0062 D-2,
// review BLOCK #1). Electron `before-quit` → engine.stop() sends SIGTERM (catchable,
// no forced follow-up), so this handler owns the sidecar's exit. Bounded so a hung
// write can never wedge the quit. Idempotent (SIGTERM + stdin-close can both fire).
let shuttingDown = false
async function gracefulShutdown(code: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await Promise.race([
      sessionManager.flushAll(),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ])
  } catch (err) {
    log.error('shutdown: session flush failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  process.exit(code)
}
process.on('SIGTERM', () => void gracefulShutdown(0))
process.on('SIGINT', () => void gracefulShutdown(0))

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.jsonrpc === '2.0' && typeof v.id === 'number' && typeof v.method === 'string'
}

async function handleLine(line: string): Promise<void> {
  let msg: unknown
  try {
    msg = JSON.parse(line)
  } catch {
    log.warn('bad json on stdin', { line })
    return
  }

  // Reverse-channel reply from the host (Electron main) to a hostRequest(). Must
  // be handled BEFORE the forward-request guard — it carries no numeric `id`.
  if (typeof msg === 'object' && msg !== null) {
    const m = msg as { method?: unknown; params?: unknown }
    if (m.method === 'host-response' && typeof m.params === 'object' && m.params !== null) {
      const p = m.params as { rid?: unknown; result?: unknown; error?: { code: number; message: string } }
      if (typeof p.rid === 'number') resolveHostResponse(p.rid, p.result, p.error)
      return
    }
  }

  if (!isJsonRpcRequest(msg)) {
    log.warn('bad envelope on stdin', { msg })
    return
  }

  try {
    const result = await dispatch(msg.method, msg.params)
    send({ jsonrpc: '2.0', id: msg.id, result })
  } catch (err) {
    if (err instanceof RpcError) {
      const error: { code: number; message: string; data?: unknown } = {
        code: err.code,
        message: err.message,
      }
      if (err.data !== undefined) error.data = err.data
      send({ jsonrpc: '2.0', id: msg.id, error })
      return
    }
    log.error('unhandled handler error', {
      err: err instanceof Error ? err.message : String(err),
    })
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: 'Internal error' },
    })
  }
}

// Force stdout to blocking mode so streaming chunks reach the host immediately
// instead of being batched in Node's 64KB pipe buffer. Without this, many small
// `emit()` writes coalesce and the UI sees the whole response in one burst.
const stdoutHandle = (process.stdout as unknown as {
  _handle?: { setBlocking?: (b: boolean) => void }
})._handle
if (stdoutHandle?.setBlocking) stdoutHandle.setBlocking(true)

// Augment PATH before anything spawns a child process (MCP `npx`, git, pty).
// A GUI launch otherwise hands the sidecar a minimal PATH and these fail with
// ENOENT — which, for MCP, silently registers zero tools (see spawn-path.ts).
ensureUserPath()

log.info('sidecar starting', { pid: process.pid, node: process.version })
// Pass gracefulShutdown as the stdin-close handler so a host exit flushes pending
// session writes before the process exits (mirrors the SIGTERM path).
startStdioLoop(handleLine, () => gracefulShutdown(0))

// One-time boot migrations, run STRICTLY IN SEQUENCE (must await — `void a(); void b()`
// would race them):
//   1. migrateMcpPlaintextSecrets — move any plaintext secret-looking MCP env/header
//      values in the LEGACY mcp-servers/*.json to the OS keychain (ADR 0018,
//      invariant 1), rewriting them to `secret:` refs.
//   2. migrateMcpServersToSources — copy legacy mcp-servers/<id>.json into the new
//      per-source folder layout ~/.awog/sources/<slug>/config.json (ADR 0060).
// Step 1 MUST finish first so the copied source configs inherit `secret:` refs and
// never plaintext. Step 2 is copy+backup, never deletes the originals, never touches
// the keychain, idempotent (done-flag). Both are idempotent — safe on every boot.
// The `sources` store is now the single source of truth for the runtime — there is no
// boot auto-start anymore (ADR 0060 D-3): a source's status is derived from its last
// source.test/auth, and the runtime bridge connects lazily per session.
void (async () => {
  try {
    await migrateMcpPlaintextSecrets()
    await migrateMcpServersToSources()
  } catch (err) {
    log.warn('boot: mcp→sources migration failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
})()

// Warm the session store: migrate any legacy event logs to the single-file
// header+messages format and load all headers into memory (ADR 0061). Idempotent +
// lazy-guarded — every sessions.* RPC also awaits ensureLoaded, so this is just a
// proactive kick so the destructive migration + first list happen before the user
// opens the Sessions page rather than on the first RPC. Best-effort at boot.
void sessionManager.ensureLoaded().catch((err) => {
  log.error('boot: session store init failed', {
    err: err instanceof Error ? err.message : String(err),
  })
})

// Start filesystem watcher (Sprint 3 C1) — emits *.fs-changed events to the UI
// when AGENT.md / SKILL.md / sources/<slug>/config.json are touched outside the app.
void awogWatcher.start()

// Resume queued/running tasks from their durable frontier (ADR 0024 restart-
// safety). waiting_approval / completed / failed tasks are left untouched.
void resumeOnBoot()

// Adopt background shells from a previous run (ADR 0066 restart-safety): resume
// polling for ones still running, finalize orphans, sweep stale exited dirs.
// Synchronous fs scan — cheap; must run AFTER the session store warms so the
// dirs it reads are the current ones. Best-effort; never blocks boot.
try {
  reloadBackgroundShells()
} catch (err) {
  log.warn('boot: background-shell reload failed', {
    err: err instanceof Error ? err.message : String(err),
  })
}
