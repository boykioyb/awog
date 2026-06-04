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
  lastActivityAt: number
  pty: PtyProcess
}

const MAX_PER_SESSION = 5
const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // kill shells idle > 30 min
const IDLE_SWEEP_MS = 60 * 1000

// Strip credentials before handing env to an interactive shell (invariant #1).
const SENSITIVE_EXACT = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])
const SENSITIVE_SUFFIX = /(_TOKEN|_KEY|_SECRET)$/i

function sanitizedEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_EXACT.has(key) || SENSITIVE_SUFFIX.test(key)) continue
    out[key] = value
  }
  return out
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
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

  private sweepTimer: ReturnType<typeof setInterval> | null = null

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
    const proc = pty.spawn(defaultShell(), [], {
      name: 'xterm-256color',
      cols: params.cols,
      rows: params.rows,
      cwd: params.workspaceRoot,
      env: sanitizedEnv(),
    })

    const now = Date.now()
    const record: TerminalRecord = {
      terminalId,
      sessionId: params.sessionId,
      workspaceRoot: params.workspaceRoot,
      createdAt: now,
      lastActivityAt: now,
      pty: proc,
    }
    this.terminals.set(terminalId, record)

    proc.onData((chunk) => {
      record.lastActivityAt = Date.now()
      emit('terminal.data', { terminalId, sessionId: params.sessionId, chunk })
    })
    proc.onExit(({ exitCode, signal }) => {
      this.terminals.delete(terminalId)
      emit('terminal.exit', { terminalId, sessionId: params.sessionId, exitCode, signal })
    })

    this.ensureSweep()
    return { terminalId }
  }

  write(terminalId: string, data: string): void {
    const record = this.terminals.get(terminalId)
    if (!record) throw new Error('Unknown terminal')
    record.lastActivityAt = Date.now()
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

  private ensureSweep(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => {
      const now = Date.now()
      for (const record of this.terminals.values()) {
        if (now - record.lastActivityAt > IDLE_TIMEOUT_MS) this.kill(record.terminalId)
      }
      if (this.terminals.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer)
        this.sweepTimer = null
      }
    }, IDLE_SWEEP_MS)
    // Don't keep the event loop alive solely for the sweep.
    this.sweepTimer.unref?.()
  }

  shutdown(): void {
    for (const record of this.terminals.values()) {
      try {
        record.pty.kill()
      } catch {
        // ignore
      }
    }
    this.terminals.clear()
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}

export const terminalManager = new TerminalManager()

// Kill child shells with the sidecar (mirrors mcpManager). stdin-close exit
// also sends SIGHUP to children, so orphan shells are doubly guarded.
process.once('SIGTERM', () => terminalManager.shutdown())
process.once('SIGINT', () => terminalManager.shutdown())
