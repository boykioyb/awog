import { ref } from 'vue'
import type { GatewayEvent, RemoteDevice } from './types'

// Single WebSocket client to the Remote Gateway (Electron main, ADR 0067). Same
// origin as the served PWA — `ws://${location.host}`. Handles the pair/auth
// handshake, id-matched RPC, event fan-in, auto-reconnect with backoff, and
// liveness (app-level ping + pong watchdog + foreground/network probes). All
// app-facing state is exposed as reactive refs.

export type Phase =
  | 'connecting'
  | 'need-pair'
  | 'pairing'
  | 'authing'
  | 'ready'
  | 'reconnecting'
  // No network at all (`navigator.onLine === false`). Retrying with the radio
  // down only burns battery, so we park here and let the `online` event bring us
  // straight back. ConnectionBar renders this through its default branch
  // ("Ngoại tuyến").
  | 'offline'

const TOKEN_KEY = 'awog.remote.token'
// App-level keepalive interval; also the pong watchdog's window (see startPing).
const PING_MS = 25_000
// Foreground probe: back from the lock screen we ping immediately rather than
// waiting up to PING_MS to discover the socket died while we were suspended.
const VISIBILITY_PROBE_MS = 3_000
const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 10_000
// ±30%. Without it every retry ladder (and every open tab) fires on the same
// instant when the cell comes back, which is the worst moment to synchronise.
const BACKOFF_JITTER = 0.3
const RPC_TIMEOUT_MS = 30_000

// Gateway error codes we treat specially (see remote-gateway.ts handlers).
const CODE_UNAUTHORIZED = -32003

// A request that died with the socket — NOT an answer from the desktop. The
// store has to tell the two apart: a dropped socket says nothing about the turn
// the desktop is running, so failing that turn locally is a lie (the red error
// bubble on a run that is doing fine). A marker class, never a string compare.
export class DisconnectError extends Error {
  constructor(message = 'Mất kết nối tới desktop') {
    super(message)
    this.name = 'DisconnectError'
  }
}

export function isDisconnect(e: unknown): boolean {
  return e instanceof DisconnectError
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }
type EventListener = (evt: GatewayEvent) => void

class Gateway {
  // Public reactive state.
  readonly phase = ref<Phase>('connecting')
  readonly lastError = ref<string | null>(null)
  readonly revoked = ref(false)
  // Bumped on every transition into 'ready' so the store can re-subscribe +
  // refetch the open session (reconnect resume — full refetch for P1).
  readonly readySignal = ref(0)

  private ws: WebSocket | null = null
  private rpcId = 0
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<EventListener>()
  private readonly subs = new Set<string>()
  private pairResolve: ((d: RemoteDevice) => void) | null = null
  private pairReject: ((e: Error) => void) | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private probeTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = BACKOFF_MIN_MS
  private stopped = false
  // True while a ping is out with nothing back yet — the pong watchdog's state.
  private pongPending = false
  private listenersBound = false

  get hasToken(): boolean {
    return this.token !== null
  }

  private get token(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  }

  private set token(v: string | null) {
    if (v) localStorage.setItem(TOKEN_KEY, v)
    else localStorage.removeItem(TOKEN_KEY)
  }

  start(): void {
    this.stopped = false
    this.bindEnvListeners()
    this.open()
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // True when a frame handed to `request()` will actually reach the desktop.
  // The store checks this BEFORE driving a turn so a tap during a reconnect
  // lands in the outbox instead of failing.
  canSend(): boolean {
    return this.phase.value === 'ready' && this.isOpen()
  }

  private wsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}`
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private open(): void {
    this.clearReconnect()
    // A socket left over from an earlier attempt (still CONNECTING, say) would
    // otherwise linger until the gateway's own auth deadline terminates it.
    this.abandonSocket()
    this.phase.value = this.phase.value === 'reconnecting' ? 'reconnecting' : 'connecting'
    let sock: WebSocket
    try {
      sock = new WebSocket(this.wsUrl())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = sock
    // Every handler checks identity: a stale socket (one we abandoned in
    // forceReconnect) must not drive state for the socket that replaced it.
    sock.onopen = () => {
      if (this.ws === sock) this.onOpen()
    }
    sock.onmessage = (e) => {
      if (this.ws === sock) this.onFrame(e.data)
    }
    sock.onclose = () => {
      if (this.ws !== sock) return
      this.ws = null
      this.onDrop()
    }
    sock.onerror = () => {
      // `close` fires right after; reconnect is scheduled there.
    }
  }

  private onOpen(): void {
    this.startPing()
    if (this.token) {
      this.phase.value = 'authing'
      this.send({ type: 'auth', token: this.token })
    } else {
      this.phase.value = 'need-pair'
    }
  }

  // Single exit path for "we no longer have a working socket", whether the OS
  // told us (`close`) or the watchdog decided (forceReconnect).
  private onDrop(): void {
    this.stopPing()
    this.clearProbe()
    this.rejectAllPending()
    if (this.stopped) return
    if (this.phase.value === 'ready' || this.phase.value === 'authing') {
      this.phase.value = 'reconnecting'
    }
    if (this.isNetworkOffline()) {
      // Park instead of retrying — `online` reopens immediately.
      this.clearReconnect()
      if (!this.isPairingPhase()) this.phase.value = 'offline'
      return
    }
    this.scheduleReconnect()
  }

  // Let go of a socket we no longer trust. Handlers are detached FIRST so its
  // late `close` can't drive state for the socket that replaces it — `close` on a
  // half-open socket can take minutes to arrive.
  private abandonSocket(): void {
    const sock = this.ws
    this.ws = null
    if (!sock) return
    sock.onopen = null
    sock.onmessage = null
    sock.onclose = null
    sock.onerror = null
    try {
      sock.close()
    } catch {
      // Already dying — nothing to do.
    }
  }

  // The watchdog decided the socket is dead: drop it and take the normal
  // reconnect path instead of waiting for the OS to notice.
  private forceReconnect(): void {
    this.abandonSocket()
    this.onDrop()
  }

  private scheduleReconnect(): void {
    this.clearReconnect()
    const base = this.backoff
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS)
    const delay = Math.max(0, Math.round(base + base * BACKOFF_JITTER * (Math.random() * 2 - 1)))
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  // Keepalive + pong watchdog. A phone that rebinds NAT, swaps 4G↔Wi-Fi or wakes
  // from iOS suspend keeps a socket that still reads OPEN for minutes before the
  // OS reports `close`, so we decide it is dead ourselves. State is a FLAG, not a
  // wall-clock gap: a hidden page has its timers throttled to about one a minute,
  // and "nothing arrived for 50s" would convict a healthy socket we simply never
  // pinged.
  private startPing(): void {
    this.stopPing()
    this.pongPending = false
    this.pingTimer = setInterval(() => {
      if (!this.isOpen()) return
      if (this.pongPending) {
        // The previous ping never came back and the next one is already due —
        // ~50s of silence. Half-open; don't wait for the OS to work it out.
        this.forceReconnect()
        return
      }
      this.pongPending = true
      this.send({ type: 'ping' })
    }, PING_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private clearProbe(): void {
    if (this.probeTimer) clearTimeout(this.probeTimer)
    this.probeTimer = null
  }

  private isNetworkOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false
  }

  private isPairingPhase(): boolean {
    return this.phase.value === 'need-pair' || this.phase.value === 'pairing'
  }

  // --- foreground / network probes ------------------------------------------

  private bindEnvListeners(): void {
    if (this.listenersBound) return
    this.listenersBound = true
    document.addEventListener('visibilitychange', () => this.onVisibilityChange())
    // The radio came back: the pending backoff (up to 10s) is dead time the user
    // is staring at, so drop it and reopen now, from the shortest delay again.
    window.addEventListener('online', () => {
      this.backoff = BACKOFF_MIN_MS
      this.clearReconnect()
      if (this.phase.value === 'offline') this.phase.value = 'reconnecting'
      if (!this.stopped && !this.isOpen()) this.open()
    })
    window.addEventListener('offline', () => {
      this.clearReconnect()
      if (!this.isPairingPhase()) this.phase.value = 'offline'
      // Drop the socket too: it cannot survive the radio going down, and holding
      // it keeps `canSend()` true for one more tap.
      if (this.ws) this.forceReconnect()
    })
  }

  private onVisibilityChange(): void {
    if (document.hidden) {
      // Deliberately do NOT close on hide: a backgrounded PWA that keeps its
      // socket keeps receiving the turn it is watching (and iOS may not run our
      // timers at all — reconnecting on every glance would be worse).
      return
    }
    if (this.phase.value === 'ready' && this.isOpen()) {
      // Suspended sockets look OPEN. Ask now, with a short deadline, instead of
      // trusting the 25s interval. Re-arm the watchdog flag at the same time:
      // whatever it holds was decided before the suspend, and the probe below is
      // what decides now.
      this.pongPending = false
      this.send({ type: 'ping' })
      this.clearProbe()
      this.probeTimer = setTimeout(() => {
        this.probeTimer = null
        if (this.phase.value !== 'ready') return
        this.forceReconnect()
      }, VISIBILITY_PROBE_MS)
      return
    }
    if (this.stopped || this.isOpen() || this.isPairingPhase()) return
    // Not connected and the user is looking at the app: retry at once. Done even
    // when `navigator.onLine` still says offline — the flag lies on some phones
    // and this is the one moment a wasted attempt costs nothing.
    this.backoff = BACKOFF_MIN_MS
    this.clearReconnect()
    this.open()
  }

  private send(frame: Record<string, unknown>): void {
    if (this.isOpen()) this.ws?.send(JSON.stringify(frame))
  }

  private onFrame(data: unknown): void {
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(typeof data === 'string' ? data : String(data))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      frame = parsed as Record<string, unknown>
    } catch {
      return
    }
    // ANY frame proves the pipe is alive end-to-end, not just a `pong` — a busy
    // session streams chunks far more often than we ping. Both the watchdog flag
    // and the foreground probe settle here.
    this.pongPending = false
    this.clearProbe()
    const type = typeof frame.type === 'string' ? frame.type : ''
    switch (type) {
      case 'paired':
        return this.onPaired(frame)
      case 'authed':
        return this.onReady()
      case 'rpc-result':
        return this.onRpcResult(frame)
      case 'event':
        return this.onEventFrame(frame)
      case 'error':
        return this.onErrorFrame(frame)
      case 'pong':
        return
      default:
        return
    }
  }

  private onReady(): void {
    this.backoff = BACKOFF_MIN_MS
    this.revoked.value = false
    this.lastError.value = null
    this.phase.value = 'ready'
    for (const sessionId of this.subs) this.send({ type: 'subscribe', sessionId })
    this.readySignal.value++
  }

  private onPaired(frame: Record<string, unknown>): void {
    const token = typeof frame.token === 'string' ? frame.token : ''
    const device = frame.device as RemoteDevice | undefined
    if (token) this.token = token
    this.onReady()
    if (this.pairResolve && device) this.pairResolve(device)
    this.pairResolve = null
    this.pairReject = null
  }

  private onRpcResult(frame: Record<string, unknown>): void {
    const id = typeof frame.id === 'number' ? frame.id : -1
    const pend = this.pending.get(id)
    if (!pend) return
    this.pending.delete(id)
    if (frame.ok === true) {
      pend.resolve(frame.value)
      return
    }
    const err = frame.error as { code?: number; message?: string } | undefined
    if (err?.code === CODE_UNAUTHORIZED) this.markRevoked()
    pend.reject(new Error(err?.message ?? 'Lỗi RPC'))
  }

  private onEventFrame(frame: Record<string, unknown>): void {
    const event = frame.event as GatewayEvent | undefined
    if (!event || typeof event.type !== 'string') return
    for (const l of this.listeners) l(event)
  }

  private onErrorFrame(frame: Record<string, unknown>): void {
    const code = typeof frame.code === 'number' ? frame.code : 0
    const message = typeof frame.message === 'string' ? frame.message : 'Lỗi'
    this.lastError.value = message
    if (code === CODE_UNAUTHORIZED) {
      this.markRevoked()
      this.failPair(message)
      return
    }
    // Any error while a pair attempt is outstanding = pairing failed.
    if (this.pairReject) {
      this.failPair(message)
      this.phase.value = 'need-pair'
    }
  }

  private markRevoked(): void {
    this.token = null
    this.revoked.value = true
    this.phase.value = 'need-pair'
  }

  private failPair(message: string): void {
    if (this.pairReject) this.pairReject(new Error(message))
    this.pairResolve = null
    this.pairReject = null
  }

  // Settle every in-flight request with the marker error, so callers can tell a
  // lost socket from a refusal by the desktop (see DisconnectError).
  private rejectAllPending(): void {
    for (const [, pend] of this.pending) pend.reject(new DisconnectError())
    this.pending.clear()
  }

  // ── Public API ──────────────────────────────────────────────────────────

  // Complete pairing over the open (unauthenticated) socket. Resolves with the
  // minted device once the gateway replies `paired`.
  pair(code: string, label: string, platform: string): Promise<RemoteDevice> {
    if (!this.isOpen()) return Promise.reject(new DisconnectError('Chưa kết nối tới desktop'))
    this.failPair('Ghép nối bị thay thế')
    this.phase.value = 'pairing'
    this.lastError.value = null
    return new Promise<RemoteDevice>((resolve, reject) => {
      this.pairResolve = resolve
      this.pairReject = reject
      this.send({ type: 'pair', code, label, platform })
    })
  }

  // `timeoutMs: null` disables the stopwatch — for turn-driving calls
  // (sessions.sendMessage) whose reply only lands when the whole turn finishes.
  // A dropped socket still settles them via rejectAllPending.
  request<T>(method: string, params: unknown, opts?: { timeoutMs?: number | null }): Promise<T> {
    if (!this.canSend()) return Promise.reject(new DisconnectError('Chưa kết nối'))
    const id = ++this.rpcId
    const timeoutMs = opts?.timeoutMs === undefined ? RPC_TIMEOUT_MS : opts.timeoutMs
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              if (this.pending.delete(id)) reject(new Error('Hết thời gian chờ'))
            }, timeoutMs)
      const clear = (): void => {
        if (timer) clearTimeout(timer)
      }
      this.pending.set(id, {
        resolve: (v) => {
          clear()
          resolve(v as T)
        },
        reject: (e) => {
          clear()
          reject(e)
        },
      })
      this.send({ type: 'rpc', id, method, params })
    })
  }

  // Drop the device token on this phone and fall back to the pairing screen. The
  // desktop keeps its record until the user revokes it there (Settings → Devices);
  // this is the phone-side half of "not my device any more".
  forget(): void {
    this.token = null
    this.subs.clear()
    this.revoked.value = false
    this.phase.value = 'need-pair'
    this.ws?.close()
  }

  subscribe(sessionId: string): void {
    this.subs.add(sessionId)
    if (this.phase.value === 'ready') this.send({ type: 'subscribe', sessionId })
  }

  unsubscribe(sessionId: string): void {
    this.subs.delete(sessionId)
    if (this.phase.value === 'ready') this.send({ type: 'unsubscribe', sessionId })
  }
}

export const gateway = new Gateway()
