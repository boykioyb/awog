import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { log } from './logger'
import { enginePath } from './paths'

// Engine process bridge — the Electron counterpart of the old Rust `sidecar.rs`.
//
// Spawns the Node engine as a child of the Electron binary run in pure-Node mode
// (ELECTRON_RUN_AS_NODE=1). This keeps the OAuth token inside the engine process
// (security invariant #1) AND uses Node's standard ESM loader, which the engine
// requires — Electron's `utilityProcess` uses a patched ESM loader that crashes
// on the engine's CJS deps (see docs/features/electron-migration.md §5).
//
// Carrier is the engine's existing NDJSON JSON-RPC over stdin/stdout, so the
// engine itself is unchanged. Note: the `runAsNode` Electron fuse MUST stay
// enabled (default) for ELECTRON_RUN_AS_NODE to work in packaged builds.

export type RpcErrorShape = { code: number; message: string; data?: unknown }
export type EngineEvent = { type: string; payload: unknown }
export type EngineEventListener = (event: EngineEvent) => void

type InboundMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcErrorShape
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: RpcErrorShape) => void
}

class Engine {
  private child: ChildProcessWithoutNullStreams | null = null

  private nextId = 1

  private stdoutBuf = ''

  private readonly pending = new Map<number, Pending>()

  private readonly listeners = new Set<EngineEventListener>()

  // Reverse channel: handlers the SIDECAR can invoke on the main process via a
  // `host-request` frame (e.g. browser_tool driving Chromium). Keyed by method.
  private readonly hostHandlers = new Map<string, (params: unknown) => Promise<unknown>>()

  start(): void {
    if (this.child) return
    const child = spawn(process.execPath, [enginePath()], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))

    // The engine logs structured NDJSON to stderr; route it to the log file so
    // it survives in packaged builds (electron-log also mirrors to console in dev).
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => log.info('[engine]', chunk.trimEnd()))

    child.on('exit', (code) => {
      log.warn('engine exited', { code })
      const err: RpcErrorShape = { code: -32000, message: `engine exited (code ${code})` }
      this.pending.forEach((p) => p.reject(err))
      this.pending.clear()
      this.child = null
    })

    this.child = child
  }

  // Re-frame stdout chunks on '\n'; each complete line is one JSON-RPC envelope.
  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    let idx = this.stdoutBuf.indexOf('\n')
    while (idx >= 0) {
      const line = this.stdoutBuf.slice(0, idx).trim()
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1)
      if (line) this.onLine(line)
      idx = this.stdoutBuf.indexOf('\n')
    }
  }

  private onLine(line: string): void {
    let message: InboundMessage
    try {
      message = JSON.parse(line) as InboundMessage
    } catch {
      return // ignore malformed lines (defensive; engine never emits them)
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(message.error)
      else pending.resolve(message.result ?? null)
      return
    }
    if (message.method === 'host-request') {
      void this.handleHostRequest(message.params)
      return
    }
    if (message.method === 'event') {
      const event = message.params as EngineEvent
      this.listeners.forEach((listener) => listener(event))
    }
  }

  // Register a handler the sidecar can invoke via hostRequest(method, params).
  registerHostHandler(method: string, fn: (params: unknown) => Promise<unknown>): void {
    this.hostHandlers.set(method, fn)
  }

  // Run a sidecar→main request and write the `host-response` back on stdin.
  // ALWAYS replies (unknown method / handler throw → error reply) so the
  // sidecar's pending promise never dangles.
  private async handleHostRequest(params: unknown): Promise<void> {
    const p = (params ?? {}) as { rid?: unknown; hostMethod?: unknown; hostParams?: unknown }
    if (typeof p.rid !== 'number') return // no rid → cannot reply
    const rid = p.rid
    const reply = (result: unknown, error?: RpcErrorShape): void => {
      if (!this.child) return
      const env = error
        ? { jsonrpc: '2.0', method: 'host-response', params: { rid, error } }
        : { jsonrpc: '2.0', method: 'host-response', params: { rid, result } }
      this.child.stdin.write(`${JSON.stringify(env)}\n`)
    }
    const method = typeof p.hostMethod === 'string' ? p.hostMethod : ''
    const handler = this.hostHandlers.get(method)
    if (!handler) {
      reply(null, { code: -32601, message: `unknown host method: ${method}` })
      return
    }
    try {
      const result = await handler(p.hostParams)
      reply(result ?? null)
    } catch (err) {
      reply(null, { code: -32000, message: err instanceof Error ? err.message : String(err) })
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) {
      return Promise.reject({ code: -32000, message: 'engine not started' } satisfies RpcErrorShape)
    }
    const id = this.nextId
    this.nextId += 1
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? null })}\n`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(payload)
    })
  }

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.child?.kill()
    this.child = null
  }
}

export const engine = new Engine()
