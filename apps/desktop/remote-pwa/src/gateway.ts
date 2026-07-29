import { ref } from 'vue'
import type { GatewayEvent, RemoteDevice } from './types'

// Single WebSocket client to the Remote Gateway (Electron main, ADR 0067). Same
// origin as the served PWA — `ws://${location.host}`. Handles the pair/auth
// handshake, id-matched RPC, event fan-in, auto-reconnect with backoff, and ping
// keepalive. All app-facing state is exposed as reactive refs.

export type Phase =
  | 'connecting'
  | 'need-pair'
  | 'pairing'
  | 'authing'
  | 'ready'
  | 'reconnecting'

const TOKEN_KEY = 'awog.remote.token'
const PING_MS = 25_000
const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 10_000
const RPC_TIMEOUT_MS = 30_000

// Gateway error codes we treat specially (see remote-gateway.ts handlers).
const CODE_UNAUTHORIZED = -32003

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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = BACKOFF_MIN_MS
  private stopped = false

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
    this.open()
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
    this.phase.value = this.phase.value === 'reconnecting' ? 'reconnecting' : 'connecting'
    let sock: WebSocket
    try {
      sock = new WebSocket(this.wsUrl())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = sock
    sock.onopen = () => this.onOpen()
    sock.onmessage = (e) => this.onFrame(e.data)
    sock.onclose = () => this.onClose()
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

  private onClose(): void {
    this.stopPing()
    this.ws = null
    this.rejectAllPending('Mất kết nối tới desktop')
    if (this.stopped) return
    if (this.phase.value === 'ready') this.phase.value = 'reconnecting'
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    this.clearReconnect()
    const delay = this.backoff
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAX_MS)
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.isOpen()) this.send({ type: 'ping' })
    }, PING_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
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

  private rejectAllPending(message: string): void {
    for (const [, pend] of this.pending) pend.reject(new Error(message))
    this.pending.clear()
  }

  // ── Public API ──────────────────────────────────────────────────────────

  // Complete pairing over the open (unauthenticated) socket. Resolves with the
  // minted device once the gateway replies `paired`.
  pair(code: string, label: string, platform: string): Promise<RemoteDevice> {
    if (!this.isOpen()) return Promise.reject(new Error('Chưa kết nối tới desktop'))
    this.failPair('Ghép nối bị thay thế')
    this.phase.value = 'pairing'
    this.lastError.value = null
    return new Promise<RemoteDevice>((resolve, reject) => {
      this.pairResolve = resolve
      this.pairReject = reject
      this.send({ type: 'pair', code, label, platform })
    })
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.phase.value !== 'ready' || !this.isOpen()) {
      return Promise.reject(new Error('Chưa kết nối'))
    }
    const id = ++this.rpcId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Hết thời gian chờ'))
      }, RPC_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.send({ type: 'rpc', id, method, params })
    })
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
