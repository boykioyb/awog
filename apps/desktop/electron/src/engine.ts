import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { homedir } from 'node:os'
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

// Auto-restart tuning: recover from an unexpected engine crash without spinning
// in a tight crash-loop. Exits closer together than the window count as
// consecutive; more than MAX in a row → give up (emit engine.fatal) so the UI
// can tell the user to restart the app rather than respawn forever.
const RESTART_DELAY_MS = 500
const CRASH_WINDOW_MS = 10_000
const MAX_CONSECUTIVE_CRASHES = 5

// Liveness heartbeat. A WEDGED engine — event loop blocked, or a deadlock that
// stops it processing stdin — keeps the child ALIVE yet stops answering RPCs and
// never emits `exit`, so the crash recovery below never fires. Every pending
// request then hangs forever with no timeout: the in-flight turn's `sendMessage`
// AND the UI's stall-watchdog `turnActive` probe both dangle, so a finished reply
// is stranded on "Streaming…" with the timer running and nothing can recover it.
// We ping the engine periodically; after MAX consecutive unanswered pings we treat
// it as wedged and kill it, converting the freeze into the normal `exit` path
// (reject pending → engine.crashed → auto-restart) that the UI already recovers.
//
// Trigger is a consecutive-MISS COUNT, never a wall-clock delta: OS sleep pauses
// these timers together with the engine's event loop, so a slept engine simply
// answers the next ping on wake instead of being mistaken for a freeze.
const HEARTBEAT_INTERVAL_MS = 10_000
const HEARTBEAT_TIMEOUT_MS = 7_000 // wait for one pong before counting a miss
const MAX_MISSED_HEARTBEATS = 3 // ~3 misses in a row (~30s silent) → wedged → kill

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
  // Diagnostics only: which method + when it was sent, so a freeze dump can name
  // the RPC(s) that were in flight when the engine stopped answering.
  method: string
  startedAt: number
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

  // Auto-restart state: `stopping` marks a deliberate stop() (no restart);
  // consecutiveCrashes/lastExitAt drive the crash-loop guard.
  private stopping = false

  private consecutiveCrashes = 0

  private lastExitAt = 0

  private restartTimer: ReturnType<typeof setTimeout> | null = null

  // Liveness heartbeat state (see constants above). `missedHeartbeats` counts
  // consecutive unanswered pings; a pong resets it to 0.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private missedHeartbeats = 0

  // Diagnostics: wall-clock of the last stdout line the engine produced (any RPC
  // response OR event). Goes stale while the engine is silent — logged in the
  // freeze dump so we can see how long it had been unresponsive.
  private lastStdoutAt = 0

  start(): void {
    if (this.child) return
    this.stopping = false
    // Launch the engine from the user's home dir, not the inherited cwd (the app
    // install dir when packaged, the repo root in dev). A session with no project
    // bound resolves no `cwd`, so the runtime's workspace tools fall back to the
    // engine's `process.cwd()`; without this they'd blindly scan AWOG's own files
    // (e.g. `find . -name '*.md'` hitting only sidecar/node_modules) instead of the
    // user's natural space. Engine/UI asset paths resolve absolutely (see paths.ts),
    // so cwd never affects resource loading.
    const child = spawn(process.execPath, [enginePath()], {
      cwd: homedir(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk))

    // The engine logs structured NDJSON to stderr; route it to the log file so
    // it survives in packaged builds (electron-log also mirrors to console in dev).
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => log.info('[engine]', chunk.trimEnd()))

    // Spawn failure (ENOENT/EACCES) emits 'error' with no default handler → it
    // would crash the main process. Log it; the 'exit' below drives recovery.
    child.on('error', (err) => {
      log.error('engine process error', { message: err.message })
    })

    child.on('exit', (code) => {
      log.warn('engine exited', { code })
      this.stopHeartbeat()
      const err: RpcErrorShape = { code: -32000, message: `engine exited (code ${code})` }
      this.pending.forEach((p) => p.reject(err))
      this.pending.clear()
      this.child = null
      if (this.stopping) return
      // Unexpected exit (crash). Tell the renderer so it can finalize any in-flight
      // streaming turn as errored — the per-turn pending reject above races the UI's
      // stream state and a turn that crashed before emitting output is invisible to
      // the stall watchdog — then auto-restart so the app recovers instead of dying.
      this.emitEvent({ type: 'engine.crashed', payload: { code } })
      this.scheduleRestart()
    })

    this.child = child
    this.startHeartbeat()
  }

  private emitEvent(event: EngineEvent): void {
    this.listeners.forEach((listener) => listener(event))
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.missedHeartbeats = 0
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // One heartbeat round: ping the engine and race the pong against a timeout. A
  // pong resets the miss counter; a timeout increments it and — once MAX
  // consecutive misses accumulate — kills the wedged child so `exit` drives
  // recovery. A REJECTED ping means the child already exited (that path owns
  // recovery), so it just settles without counting a miss.
  private sendHeartbeat(): void {
    if (!this.child || this.stopping) return
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      this.missedHeartbeats += 1
      log.warn('engine heartbeat missed', {
        consecutive: this.missedHeartbeats,
        ...this.freezeContext(),
      })
      if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) this.killWedged()
    }, HEARTBEAT_TIMEOUT_MS)
    this.request('ping', null).then(
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.missedHeartbeats = 0
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
      },
    )
  }

  // The engine stopped answering pings → its event loop is wedged (a slept machine
  // answers on wake, so repeated misses mean a real freeze). It won't run its JS
  // SIGTERM handler while wedged, so SIGTERM alone can hang; escalate to SIGKILL
  // after a short grace. The resulting `exit` rejects every pending RPC (unblocking
  // the stranded UI turn) and schedules the restart.
  private killWedged(): void {
    if (this.stopping || !this.child) return
    const child = this.child
    log.error('engine unresponsive — killing to force restart', {
      missed: this.missedHeartbeats,
      ...this.freezeContext(),
    })
    this.stopHeartbeat()
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone — nothing to escalate
      }
    }, 2_000)
  }

  // Snapshot of what the engine was doing when it stopped answering — logged on a
  // heartbeat miss / wedge so the next freeze can be root-caused. `pending` groups
  // in-flight RPCs by method with a count + oldest age (excluding the heartbeat's
  // own ping, which merely piles up while wedged), pointing at the stuck call.
  private freezeContext(): {
    sinceStdoutMs: number
    pending: Record<string, { count: number; oldestMs: number }>
  } {
    const now = Date.now()
    const pending: Record<string, { count: number; oldestMs: number }> = {}
    for (const p of this.pending.values()) {
      if (p.method === 'ping') continue
      const age = now - p.startedAt
      const entry = (pending[p.method] ??= { count: 0, oldestMs: 0 })
      entry.count += 1
      if (age > entry.oldestMs) entry.oldestMs = age
    }
    return { sinceStdoutMs: this.lastStdoutAt ? now - this.lastStdoutAt : -1, pending }
  }

  // Restart the engine after an unexpected exit, guarding against a crash loop:
  // if it keeps dying within CRASH_WINDOW_MS we stop retrying and emit a terminal
  // engine.fatal so the UI can tell the user to restart the app.
  private scheduleRestart(): void {
    if (this.restartTimer) return
    const now = Date.now()
    this.consecutiveCrashes =
      now - this.lastExitAt < CRASH_WINDOW_MS ? this.consecutiveCrashes + 1 : 1
    this.lastExitAt = now
    if (this.consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) {
      log.error('engine crash-loop — giving up auto-restart', {
        crashes: this.consecutiveCrashes,
      })
      this.emitEvent({ type: 'engine.fatal', payload: { crashes: this.consecutiveCrashes } })
      return
    }
    log.warn('scheduling engine restart', {
      attempt: this.consecutiveCrashes,
      delayMs: RESTART_DELAY_MS,
    })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start()
      this.emitEvent({ type: 'engine.restarted', payload: {} })
    }, RESTART_DELAY_MS)
  }

  // Re-frame stdout chunks on '\n'; each complete line is one JSON-RPC envelope.
  private onStdout(chunk: string): void {
    this.lastStdoutAt = Date.now()
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
      this.pending.set(id, { resolve, reject, method, startedAt: Date.now() })
      this.child!.stdin.write(payload)
    })
  }

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.stopping = true
    this.stopHeartbeat()
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.child?.kill()
    this.child = null
  }
}

export const engine = new Engine()
