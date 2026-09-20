// JSON-RPC client for the `codex app-server` daemon (ADR 0087).
//
// The daemon is the entry point, NOT `codex exec --json`: exec is one process
// per turn and the binary itself refuses dynamic tools there ("dynamic tool
// calls are not supported in exec mode"). app-server speaks JSON-RPC 2.0 as
// NDJSON over stdio and holds N threads in ONE process — measured, the second
// thread/start costs 5ms against 106ms for the first, so a session is a thread,
// not a process.
//
// One daemon per CODEX_HOME (= per AWOG account, see home.ts). Message routing:
//
//   response      (id, no method)   → resolves the pending request
//   server request(id + method)     → a handler; MUST be answered or the turn
//                                     hangs waiting (approvals, dynamic tools)
//   notification  (method, no id)   → fan-out to the thread's listener
//
// Server requests and notifications both carry `threadId` in params, which is
// how one daemon's stream is demultiplexed back to the right session.

import { basename } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { registerOwnedProcess, unregisterOwnedProcess } from '../../monitor/owned.js'
import { resolveCodexBinary } from './binary.js'
import { log } from '../../util/logger.js'
import type { CodexInitializeResponse } from './protocol.js'

// Client identity in the handshake. `title`/`version` show up in the daemon's
// user-agent, which is what makes an AWOG-originated request identifiable in
// OpenAI's logs when a user asks us to explain their usage.
const CLIENT_NAME = 'awog'
const CLIENT_TITLE = 'AWOG'

// A single NDJSON line over this is treated as a protocol fault rather than
// buffered forever: the stream carries command output deltas, and a runaway
// producer must not grow the sidecar's heap without bound. 32MB is far above
// any legitimate frame (the server chunks output into deltas).
const MAX_LINE_BYTES = 32 * 1024 * 1024

// Handshake + local RPCs answer in milliseconds (measured: initialize 133-295ms,
// thread/start 106ms cold / 5ms warm). A request still pending after this means
// the daemon is wedged, and every caller is better served by an error than by a
// promise that never settles. Turn COMPLETION is not bounded by this — `turn/start`
// returns as soon as the turn is accepted; the turn itself ends on a notification.
const REQUEST_TIMEOUT_MS = 120_000

export type CodexNotification = { method: string; params: Record<string, unknown> }

export type CodexServerRequestHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>

interface ThreadRoute {
  onNotification: (n: CodexNotification) => void
  onServerRequest: CodexServerRequestHandler
}

function threadIdOf(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined
  const id = (params as { threadId?: unknown }).threadId
  return typeof id === 'string' ? id : undefined
}

export class CodexDaemon {
  private child: ChildProcessWithoutNullStreams | undefined
  private buf = ''
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  // Routes keyed by threadId. A thread registers before its first turn and
  // unregisters when the session's turn ends.
  private readonly routes = new Map<string, ThreadRoute>()
  // Server requests that arrive BEFORE the thread/start response has given us
  // the thread id (the server can call item/tool/call the moment a turn starts).
  // Queued against the one route registered without an id yet.
  private pendingRoute: ThreadRoute | undefined
  private exitReason: string | undefined
  private starting: Promise<void> | undefined

  constructor(
    private readonly codexHome: string,
    private readonly version: string,
  ) {}

  get home(): string {
    return this.codexHome
  }

  get alive(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  // Idempotent: concurrent turns on the same account share one spawn.
  async start(): Promise<void> {
    if (this.alive) return
    if (this.starting) return this.starting
    this.starting = this.spawnAndHandshake().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  private async spawnAndHandshake(): Promise<void> {
    const bin = resolveCodexBinary()
    // CODEX_HOME is the isolation boundary (ADR 0087 F4). Without it a thread
    // inherits the user's PERSONAL Codex config — the spike accidentally loaded
    // eight of their MCP servers and their model through a custom provider. It
    // is set explicitly here rather than trusted from the ambient env, and any
    // inherited CODEX_HOME is overridden.
    // ⚠ Daemon này DÙNG CHUNG cho mọi phiên cùng `codexHome` (xem `daemons` bên
    // dưới), nên env ở đây KHÔNG thể mang thứ thuộc về một phiên. Cụ thể: ngữ cảnh
    // hạ tầng đã ghim (`AWS_PROFILE`/`AWS_DEFAULT_REGION`, ADR 0088 §6) không luồn
    // được xuống `shell` của Codex theo đường này — hai phiên ghim hai tài khoản
    // khác nhau sẽ tranh nhau một biến. Hai runtime kia đã luồn được vì tiến trình
    // con của chúng là PER-TURN (`tools/bash-tool.ts`, `claude-sdk/shared.ts`);
    // đường này cần một cơ chế per-thread của Codex trước khi làm được.
    const child = spawn(bin, ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_HOME: this.codexHome },
    })
    this.child = child
    this.exitReason = undefined
    this.buf = ''
    // Màn Giám sát: daemon này DÙNG CHUNG cho mọi phiên cùng `codexHome`, nên cố ý
    // KHÔNG khai `sessionId` — gán nó cho một phiên là nói dối về chỗ CPU thực sự
    // nằm. Nhãn mang tên thư mục home để phân biệt daemon của từng account.
    registerOwnedProcess({
      pid: child.pid ?? -1,
      kind: 'codex-daemon',
      label: `Codex · ${basename(this.codexHome)}`,
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(chunk))
    // stderr is the daemon's own log, not protocol. Keep it flowing (an unread
    // pipe eventually blocks the child) and surface it at debug volume only.
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) log.info('codex app-server stderr', { text: text.slice(0, 500) })
    })
    child.on('exit', (code, signal) => {
      unregisterOwnedProcess(child.pid)
      this.onExit(code, signal)
    })
    child.on('error', (err) => this.onExit(null, null, err.message))

    const res = (await this.request('initialize', {
      clientInfo: { name: CLIENT_NAME, title: CLIENT_TITLE, version: this.version },
      // experimentalApi is what unlocks dynamicTools on thread/start.
      capabilities: { experimentalApi: true, requestAttestation: false },
    })) as CodexInitializeResponse
    log.info('codex app-server ready', {
      codexHome: res.codexHome ?? this.codexHome,
      userAgent: res.userAgent,
    })
  }

  private onData(chunk: string): void {
    this.buf += chunk
    if (this.buf.length > MAX_LINE_BYTES) {
      const reason = `codex app-server sent a frame over ${MAX_LINE_BYTES} bytes`
      this.buf = ''
      this.kill(reason)
      return
    }
    let idx = this.buf.indexOf('\n')
    while (idx >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (line) this.onLine(line)
      idx = this.buf.indexOf('\n')
    }
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      // A non-JSON line is the daemon printing something on stdout that is not
      // protocol. Drop it: killing the daemon over a stray line would be worse.
      log.warn('codex app-server: unparseable stdout line', { head: line.slice(0, 200) })
      return
    }
    const id = msg.id
    const method = msg.method

    // Server → client REQUEST: has both an id and a method, and must be answered.
    if (id !== undefined && typeof method === 'string') {
      void this.handleServerRequest(id as number | string, method, msg.params)
      return
    }
    // Response to one of ours.
    if (id !== undefined) {
      const entry = this.pending.get(id as number)
      if (!entry) return
      this.pending.delete(id as number)
      clearTimeout(entry.timer)
      const err = msg.error as { message?: string; code?: number } | undefined
      if (err) entry.reject(new Error(err.message ?? `codex rpc error ${err.code ?? ''}`.trim()))
      else entry.resolve(msg.result)
      return
    }
    // Notification.
    if (typeof method === 'string') {
      const params = (msg.params ?? {}) as Record<string, unknown>
      this.routeFor(threadIdOf(params))?.onNotification({ method, params })
    }
  }

  private routeFor(threadId: string | undefined): ThreadRoute | undefined {
    if (threadId) {
      const route = this.routes.get(threadId)
      if (route) return route
    }
    // No id, or an id we have not bound yet (the first turn's events can precede
    // our own bookkeeping): fall back to the thread currently being started.
    return this.pendingRoute
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    rawParams: unknown,
  ): Promise<void> {
    const params = (rawParams ?? {}) as Record<string, unknown>
    const route = this.routeFor(threadIdOf(params))
    if (!route) {
      // Answering SOMETHING is mandatory — an unanswered approval or tool call
      // parks the turn until the daemon gives up. Decline is the safe answer:
      // we cannot ask a user who is not attached to this thread.
      log.warn('codex server request for an unknown thread; declining', { method })
      this.respond(id, this.declineShapeFor(method))
      return
    }
    try {
      this.respond(id, await route.onServerRequest(method, params))
    } catch (err) {
      log.warn('codex server request handler threw; declining', {
        method,
        err: err instanceof Error ? err.message : String(err),
      })
      this.respond(id, this.declineShapeFor(method))
    }
  }

  // The shape of "no" differs per request family, and the server validates it.
  private declineShapeFor(method: string): unknown {
    if (method === 'item/tool/call') {
      return {
        contentItems: [{ type: 'inputText', text: 'AWOG could not run this tool.' }],
        success: false,
      }
    }
    if (method.endsWith('/requestApproval')) return { decision: 'decline' }
    if (method === 'item/tool/requestUserInput') return { answers: {} }
    return {}
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  private write(msg: Record<string, unknown>): void {
    if (!this.child || !this.alive) return
    this.child.stdin.write(`${JSON.stringify(msg)}\n`)
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.alive && method !== 'initialize') await this.start()
    if (!this.child) throw new Error(this.exitReason ?? 'codex app-server is not running')
    const id = this.nextId
    this.nextId += 1
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex app-server did not answer ${method} within ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)
      // Never let a pending RPC hold the process open on its own.
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  // Fire-and-forget: used for the response side only, never for requests.
  notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  // Register the route BEFORE thread/start so events that arrive during the
  // start round-trip still reach the session. `bind` then attaches the real id.
  openRoute(route: ThreadRoute): { bind: (threadId: string) => void; close: () => void } {
    this.pendingRoute = route
    let bound: string | undefined
    return {
      bind: (threadId: string) => {
        bound = threadId
        this.routes.set(threadId, route)
      },
      close: () => {
        if (bound) this.routes.delete(bound)
        if (this.pendingRoute === route) this.pendingRoute = undefined
      },
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null, message?: string): void {
    const reason =
      message ?? `codex app-server exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`
    this.exitReason = reason
    this.child = undefined
    // Everything in flight dies with the daemon. Reject rather than hang: a
    // wedged turn with no error is the failure mode users cannot diagnose.
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    this.pending.clear()
    // Tell each live thread, so a turn in progress ends as an error instead of
    // waiting for a turn/completed that can no longer arrive (ADR 0087 F8 —
    // "daemon dies mid-turn" was explicitly unverified; this is the answer).
    const routes = [...this.routes.values()]
    this.routes.clear()
    this.pendingRoute = undefined
    for (const route of routes) {
      route.onNotification({ method: 'awog/daemonExited', params: { message: reason } })
    }
    log.warn('codex app-server exited', { reason })
  }

  kill(reason = 'shutdown'): void {
    const child = this.child
    if (!child) return
    this.exitReason = reason
    child.kill()
  }
}

// ── Pool ────────────────────────────────────────────────────────────────────
// One daemon per CODEX_HOME. Keyed by the home path rather than the account id
// so two accounts that somehow resolve to the same home share one process
// instead of racing over the same SQLite files.

const daemons = new Map<string, CodexDaemon>()

export async function getCodexDaemon(codexHome: string, version: string): Promise<CodexDaemon> {
  const existing = daemons.get(codexHome)
  if (existing?.alive) return existing
  const daemon = existing ?? new CodexDaemon(codexHome, version)
  daemons.set(codexHome, daemon)
  await daemon.start()
  return daemon
}

// Called when an account's credentials change: the daemon read auth.json at
// startup, so a re-login has to reach a fresh process.
export function dropCodexDaemon(codexHome: string): void {
  const daemon = daemons.get(codexHome)
  if (!daemon) return
  daemons.delete(codexHome)
  daemon.kill('credentials changed')
}

export function shutdownCodexDaemons(): void {
  for (const [, daemon] of daemons) daemon.kill('sidecar shutdown')
  daemons.clear()
}
