import { startStdioLoop, send } from './transport/stdio.js'
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
import './methods/sessions.send-message.js'
import './methods/sessions.compact.js'
import './methods/sessions.cancel.js'
import './methods/sessions.permission.js'
import './methods/sessions.answer-question.js'
import './methods/sessions.list.js'
import './methods/sessions.upsert.js'
import './methods/sessions.delete.js'
import './methods/account.usage.js'
import './methods/projects.list.js'
import './methods/projects.upsert.js'
import './methods/projects.delete.js'
import './methods/projects.clone.js'
import './methods/projects.inspect.js'
import './methods/skills.list.js'
import './methods/skills.upsert.js'
import './methods/skills.delete.js'
import './methods/skills.generate.js'
import './methods/skills.author.js'
import './methods/mcp.list.js'
import './methods/mcp.upsert.js'
import './methods/mcp.delete.js'
import './methods/mcp.toggle.js'
import './methods/mcp.toggle-tool.js'
import './methods/mcp.restart.js'
import './methods/mcp.test.js'
import './methods/mcp.discover-preset.js'
import './methods/mcp.author.js'
import './methods/mcp.set-secret.js'
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
import './methods/git.status.js'
import './methods/git.log.js'
import './methods/git.diff.js'
import './methods/git.branch-list.js'
import './methods/git.stash-list.js'
import './methods/git.remote-list.js'
import './methods/git.stage-file.js'
import './methods/git.stage-hunk.js'
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
import './methods/git.fetch.js'
import './methods/git.pull.js'
import './methods/git.push.js'
import './methods/git.cancel.js'
import './methods/git.generate-commit-message.js'
import './methods/git.tag-create.js'
import './methods/git.checkout-commit.js'
import './methods/git.cherry-pick.js'
import './methods/git.revert-commit.js'
import './methods/git.reset-to.js'
import './methods/git.format-patch.js'
import './methods/fs.list-dir.js'
import './methods/fs.list-files.js'
import './methods/fs.read-file.js'
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
import './methods/settings.set-rtk.js'
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
import { mcpManager } from './mcp/manager.js'
import { awogWatcher } from './watcher.js'
import { resumeOnBoot } from './tasks/engine.js'

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

log.info('sidecar starting', { pid: process.pid, node: process.version })
startStdioLoop(handleLine)

// Auto-start enabled+autoStart MCP servers on sidecar boot (AC-3 restart-safe).
void mcpManager.hydrateAutoStart()

// Start filesystem watcher (Sprint 3 C1) — emits *.fs-changed events to the UI
// when AGENT.md / SKILL.md / mcp-servers/*.json are touched outside the app.
void awogWatcher.start()

// Resume queued/running tasks from their durable frontier (ADR 0024 restart-
// safety). waiting_approval / completed / failed tasks are left untouched.
void resumeOnBoot()
