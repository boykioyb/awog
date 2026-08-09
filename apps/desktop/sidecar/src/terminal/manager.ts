// Interactive PTY manager for the Session workspace Terminal tab — see ADR 0019.
//
// node-pty is a native module loaded via dynamic import + graceful fallback
// (mirrors credentials/keychain.ts): if it cannot load, terminal.create returns
// a clear error and the rest of the sidecar keeps working.
//
// SECURITY (invariant #1/#3): cwd is always workspaceRoot (never from UI), the
// shell binary is fixed ($SHELL / platform default, empty arg array — no shell
// string concat), and sensitive env (OAuth/API tokens) is stripped before
// spawn so an interactive shell cannot `echo` the credential.

import { isAbsolute } from 'node:path'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

export interface TerminalSessionRef {
  terminalId: string
  sessionId: string
  createdAt: number
}

interface PtyProcess {
  pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

interface SpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

interface NodePtyModule {
  spawn(file: string, args: string[], options: SpawnOptions): PtyProcess
}

interface TerminalRecord {
  terminalId: string
  sessionId: string
  workspaceRoot: string
  createdAt: number
  pty: PtyProcess
}

// Abuse guard only — a host may open several tabs AND split each into panes, so
// this must stay well above any realistic layout. NOT a lifetime policy: a shell
// lives until the user closes it (see the note on idle-kill below).
const MAX_PER_SESSION = 20

// Strip credentials before handing env to an interactive shell (invariant #1).
const SENSITIVE_EXACT = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])
const SENSITIVE_SUFFIX = /(_TOKEN|_KEY|_SECRET)$/i

// The sidecar is launched as `electron --run-as-node`, so its env carries flags
// that hijack any `node`/`electron` the USER runs from the shell (ELECTRON_RUN_AS_NODE
// makes an electron binary behave as plain node; NODE_OPTIONS is inherited by every
// node child). A real terminal must not leak the host process's runtime flags.
const HOST_RUNTIME_VARS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_ATTACH_CONSOLE']

function sanitizedEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_EXACT.has(key) || SENSITIVE_SUFFIX.test(key)) continue
    if (HOST_RUNTIME_VARS.includes(key)) continue
    out[key] = value
  }
  // What a terminal emulator is expected to advertise (TERM itself is set by
  // node-pty from `name`). Only fill LANG when absent — never override the user's.
  out.TERM_PROGRAM = 'AWOG'
  out.COLORTERM = 'truecolor'
  if (!out.LANG) out.LANG = 'en_US.UTF-8'
  return out
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

// macOS GUI apps inherit a minimal env, so a non-login shell skips `.zprofile`
// (Homebrew/nvm/pyenv PATH) — Terminal.app and VS Code both spawn a LOGIN shell
// there for exactly this reason. Elsewhere the desktop session already exports
// the profile, so a plain interactive shell (like most Linux emulators) is right.
function shellArgs(shell: string): string[] {
  if (process.platform !== 'darwin') return []
  const name = shell.slice(shell.lastIndexOf('/') + 1)
  return name === 'zsh' || name === 'bash' || name === 'fish' || name === 'sh' ? ['-l'] : []
}

let modulePromise: Promise<NodePtyModule | null> | null = null

async function getPty(): Promise<NodePtyModule | null> {
  if (!modulePromise) {
    // String-join hides the specifier from tsc's static resolver — the dep is
    // optional-at-build (ADR 0019) and may not be installed yet.
    const modPath = ['node', 'pty'].join('-')
    modulePromise = import(modPath)
      .then((mod) => mod as unknown as NodePtyModule)
      .catch((err: unknown) => {
        log.warn('terminal: node-pty import failed — terminal disabled', {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      })
  }
  return modulePromise
}

class TerminalManager {
  private terminals = new Map<string, TerminalRecord>()

  private idCounter = 0

  async create(params: {
    workspaceRoot: string
    sessionId: string
    cols: number
    rows: number
  }): Promise<{ terminalId: string }> {
    if (!isAbsolute(params.workspaceRoot)) {
      throw new Error('workspaceRoot must be absolute')
    }
    const pty = await getPty()
    if (!pty) throw new Error('Terminal unavailable: node-pty not installed')

    const sessionCount = [...this.terminals.values()].filter(
      (t) => t.sessionId === params.sessionId,
    ).length
    if (sessionCount >= MAX_PER_SESSION) {
      throw new Error(`Too many terminals for this session (max ${MAX_PER_SESSION})`)
    }

    const terminalId = `term-${Date.now().toString(36)}-${(this.idCounter += 1).toString(36)}`
    const shell = defaultShell()
    const proc = pty.spawn(shell, shellArgs(shell), {
      name: 'xterm-256color',
      cols: params.cols,
      rows: params.rows,
      cwd: params.workspaceRoot,
      env: sanitizedEnv(),
    })

    const record: TerminalRecord = {
      terminalId,
      sessionId: params.sessionId,
      workspaceRoot: params.workspaceRoot,
      createdAt: Date.now(),
      pty: proc,
    }
    this.terminals.set(terminalId, record)

    proc.onData((chunk) => {
      emit('terminal.data', { terminalId, sessionId: params.sessionId, chunk })
    })
    proc.onExit(({ exitCode, signal }) => {
      this.terminals.delete(terminalId)
      emit('terminal.exit', { terminalId, sessionId: params.sessionId, exitCode, signal })
    })

    return { terminalId }
  }

  write(terminalId: string, data: string): void {
    const record = this.terminals.get(terminalId)
    if (!record) throw new Error('Unknown terminal')
    record.pty.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const record = this.terminals.get(terminalId)
    if (!record) throw new Error('Unknown terminal')
    record.pty.resize(cols, rows)
  }

  kill(terminalId: string): void {
    const record = this.terminals.get(terminalId)
    if (!record) return
    this.terminals.delete(terminalId)
    try {
      record.pty.kill()
    } catch {
      // already exited — onExit cleanup may have raced
    }
  }

  list(sessionId?: string): TerminalSessionRef[] {
    return [...this.terminals.values()]
      .filter((t) => sessionId === undefined || t.sessionId === sessionId)
      .map((t) => ({ terminalId: t.terminalId, sessionId: t.sessionId, createdAt: t.createdAt }))
  }

  // NO idle-kill. A shell is a user-owned document, not a pooled resource: reaping
  // it after N minutes of silence killed shells the user had simply left open, and
  // worse, killed long-running-but-quiet commands (build/watch/ssh) mid-flight —
  // something no real terminal does. Lifetime is owned by the UI (close tab/pane,
  // host unmount) plus shutdown() below; an idle PTY costs a sleeping process.
  shutdown(): void {
    for (const record of this.terminals.values()) {
      try {
        record.pty.kill()
      } catch {
        // ignore
      }
    }
    this.terminals.clear()
  }
}

export const terminalManager = new TerminalManager()

// Kill child shells with the sidecar (mirrors mcpManager). stdin-close exit
// also sends SIGHUP to children, so orphan shells are doubly guarded.
process.once('SIGTERM', () => terminalManager.shutdown())
process.once('SIGINT', () => terminalManager.shutdown())
