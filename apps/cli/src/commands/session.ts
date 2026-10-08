// `awog session ls` + `awog session cli <id> --print` (ADR 0093 phase-2 cheap
// cut: print the native resume command instead of attaching a PTY).

import type { Engine } from '../transport.js'
import { note, sgr, table } from '../tty.js'

interface SessionSummary {
  id: string
  title?: string
  updatedAt?: string
  archived?: boolean
  settings?: { provider?: string; modelId?: string }
}

interface Session {
  id: string
  title?: string
  settings?: { provider?: string; modelId?: string }
  sdkSessionId?: string
  codexThreadId?: string
}

export async function cmdSessionLs(engine: Engine, json: boolean): Promise<void> {
  const res = await engine.rpc<{ sessions: SessionSummary[] }>('sessions.list')
  const sessions = res.sessions ?? []
  if (json) {
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`)
    return
  }
  const rows = sessions.slice(0, 50).map((s) => [
    sgr.accent(s.id),
    sgr.dim(s.updatedAt ? s.updatedAt.slice(0, 16).replace('T', ' ') : ''),
    s.settings?.modelId ?? '',
    s.title ?? '',
  ])
  process.stdout.write(
    `${table(['ID', 'UPDATED', 'MODEL', 'TITLE'], rows, [20, 16, 22, 'flex'])}\n`,
  )
  note(`${sgr.accent('·')} ${sgr.dim(`${sessions.length} session(s)`)}`)
}

// `awog session cli <id> --print`: output the resume command the app's CLI
// mode would use — `claude --resume <sdkSessionId>` or
// `CODEX_HOME=… codex resume <codexThreadId>`. Reads through the engine so the
// CLI needs no ~/.awog knowledge beyond the endpoint file.
export async function cmdSessionCli(engine: Engine, sessionId: string, json: boolean): Promise<void> {
  const res = await engine.rpc<{ session: Session | null }>('sessions.get', { sessionId })
  const s = res.session
  if (!s) throw new Error(`session not found: ${sessionId}`)
  const provider = s.settings?.provider
  if (provider === 'anthropic' && s.sdkSessionId) {
    const cmd = `claude --resume ${s.sdkSessionId}`
    if (json) process.stdout.write(`${JSON.stringify({ command: cmd })}\n`)
    else process.stdout.write(`${cmd}\n`)
    return
  }
  if (provider === 'openai' && s.codexThreadId) {
    const cmd = `codex resume ${s.codexThreadId}`
    if (json) process.stdout.write(`${JSON.stringify({ command: cmd })}\n`)
    else process.stdout.write(`${cmd}\n`)
    return
  }
  throw new Error(
    `session ${sessionId} has no CLI handle (provider=${provider ?? '?'}; needs an anthropic/openai session that already ran a turn)`,
  )
}

// `awog session set <id> [--model m] [--provider p] [--account id]
// [--level l] [--mode m]` — persist an llmOverride on the session header
// (same RPC as the REPL slash commands; convenient for scripting an existing
// session without entering chat).
export async function cmdSessionSet(
  engine: Engine,
  sessionId: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const override: Record<string, string> = {}
  if (typeof flags.provider === 'string') override.provider = flags.provider
  if (typeof flags.model === 'string') override.modelId = flags.model
  if (typeof flags.account === 'string') override.accountId = flags.account
  if (typeof flags.level === 'string') override.level = flags.level
  if (typeof flags.mode === 'string') override.mode = flags.mode
  if (Object.keys(override).length === 0) {
    throw new Error('nothing to set — pass --model/--provider/--account/--level/--mode')
  }
  await engine.rpc('sessions.setLlmOverride', { id: sessionId, override })
  note(
    `${sgr.accent('·')} ${sgr.bold(sessionId)}: ${sgr.dim(
      Object.entries(override).map(([k, v]) => `${k}=${v}`).join(' '),
    )}`,
  )
}
