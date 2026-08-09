import { createServer, type Server as HttpServer } from 'node:http'
import { ipcMain, type BrowserWindow } from 'electron'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { engine } from './engine'
import { log } from './logger'
import { remotePwaDir } from './paths'
import { createStaticHandler } from './remote-gateway-http'
import { DeviceStore } from './remote-gateway-devices'
import { findTailnetAddress, isTailnetAddress } from './remote-gateway-tailnet'
import { handleLocalMethod, isLocalMethod } from './remote-gateway-catalog'
import {
  REMOTE_ALLOWLIST,
  RemoteRejected,
  eventSessionId,
  isEventForwardable,
  isMethodAllowed,
  sanitizeRemoteParams,
} from './remote-gateway-policy'

// Remote Gateway (mobile-remote-control, ADR 0067). Lives in Electron main — the
// process that owns the network + holds NO API key (invariant #1). Bridges a
// WebSocket bound ONLY to the Tailscale interface (F5) ⇄ engine.request /
// engine.onEvent, gated by a device token (F6), a method allowlist (F4),
// param-pick sanitization (F1/F3), event-egress filtering (F2) and per-device
// budget (F8). See spec §Contract kỹ thuật.

const PORT = 47600
const IFACE_POLL_MS = 15_000
const MAX_TEXT_BYTES = 100_000
const MAX_CONNS_PER_DEVICE = 3
// No concurrent-turn cap: a single user drives many sessions/projects in parallel
// from the phone. Cost is bounded by each session's own budget + device revoke +
// auth lockout, not by throttling turns. Sends/hour stays only as a runaway guard.
const MAX_SENDS_PER_HOUR = 600
// Session lifecycle writes (create/rename/delete/checklist/titling). Cheap next to
// a turn, but still worth a runaway guard — titling is a model call.
const MAX_WRITES_PER_HOUR = 300
const MAX_PAYLOAD_BYTES = 1_000_000 // F-3: cap WS frame size before parse
const AUTH_DEADLINE_MS = 10_000 // F-2: terminate a socket that never authenticates
const MAX_UNAUTH_CONNS = 16 // F-2: cap concurrent un-authenticated sockets
const MAX_AUTH_FAILS = 10 // F-4: failed auth/pair before lockout
const AUTH_LOCKOUT_MS = 60_000 // F-4

type ConnState = {
  deviceId: string | null
  subs: Set<string>
  ip: string
  authTimer: ReturnType<typeof setTimeout> | null
}
type DeviceBudget = { sends: number[]; writes: number[] }

// Turn-driving calls (feed the model) vs session-lifecycle writes — each gets its
// own hourly window below.
const TURN_DRIVING = new Set(['sessions.sendMessage', 'sessions.steer'])
const LIFECYCLE_WRITES = new Set([
  'sessions.upsert',
  'sessions.delete',
  'sessions.updateTodos',
  'sessions.generateTitle',
])

type GatewayStatus = {
  // User opt-in (persisted). False → nothing is listening, whatever the tailnet does.
  enabled: boolean
  tailnet: 'connected' | 'disconnected'
  host: string | null
  port: number
  bound: boolean
}

class RemoteGateway {
  private wss: WebSocketServer | null = null

  private httpServer: HttpServer | null = null

  private staticHandler: ReturnType<typeof createStaticHandler> | null = null

  private boundAddress: string | null = null

  private readonly store = new DeviceStore()

  private readonly conns = new Map<WebSocket, ConnState>()

  private readonly budgets = new Map<string, DeviceBudget>()

  // F-4: per-IP auth/pair failure lockout.
  private readonly authFails = new Map<string, { count: number; until: number }>()

  // F-6: refuse remote RPC until the allowlist is validated against the sidecar
  // registry (fail-closed during the boot window).
  private validated = false

  private engineUnsub: (() => void) | null = null

  private ifaceTimer: ReturnType<typeof setInterval> | null = null

  private getWindow: () => BrowserWindow | null = () => null

  async start(getWindow: () => BrowserWindow | null): Promise<void> {
    this.getWindow = getWindow
    this.staticHandler = createStaticHandler(remotePwaDir())
    await this.store.load()
    // Boot-validate the allowlist against the sidecar registry (F4): a typo'd
    // method name is a fail-fast here, not a silent fail-open at runtime.
    void this.validateAllowlist()
    this.registerIpc()
    // Forward allowlisted, subscription-scoped engine events to phones (F2).
    this.engineUnsub = engine.onEvent((event) => this.fanoutEvent(event.type, event.payload))
    this.bindIfPossible()
    this.ifaceTimer = setInterval(() => this.bindIfPossible(), IFACE_POLL_MS)
  }

  stop(): void {
    if (this.ifaceTimer) clearInterval(this.ifaceTimer)
    this.ifaceTimer = null
    this.engineUnsub?.()
    this.engineUnsub = null
    this.closeServer()
  }

  private async validateAllowlist(): Promise<void> {
    try {
      const res = (await engine.request('system.methods', null)) as { methods: string[] }
      const known = new Set(res.methods)
      const missing = REMOTE_ALLOWLIST.filter((m) => !known.has(m))
      if (missing.length > 0) {
        log.error('remote-gateway allowlist mismatch — refusing to serve remote', { missing })
        this.validated = false
        this.closeServer() // fail-closed: a bad allowlist must not serve anything
      } else {
        this.validated = true // F-6: remote RPC allowed from here on
      }
    } catch (err) {
      // Engine not ready yet — retry shortly; until validated we still bind, but a
      // mismatch (if any) is caught before the first real client is likely to act.
      log.warn('remote-gateway allowlist validation deferred', {
        message: err instanceof Error ? err.message : String(err),
      })
      setTimeout(() => void this.validateAllowlist(), 2_000)
    }
  }

  // --- bind (F5) -----------------------------------------------------------

  private bindIfPossible(): void {
    // Opt-in gate: a network listener must never appear because Tailscale happens
    // to be running — only because the user turned remote control on.
    if (!this.store.isEnabled()) {
      if (this.boundAddress !== null) this.closeServer()
      return
    }
    const addr = findTailnetAddress()
    if (!addr) {
      if (this.boundAddress !== null) {
        log.warn('remote-gateway: tailnet interface gone — closing')
        this.closeServer()
      }
      this.emitStatus()
      return
    }
    if (this.boundAddress === addr && this.wss) return // already bound correctly
    this.closeServer()
    this.openServer(addr)
  }

  private openServer(addr: string): void {
    try {
      // One HTTP server bound to the tailnet IP serves the PWA static assets AND
      // carries the WS upgrade (same origin). ws attaches via { server }.
      const httpServer = createServer((req, res) => this.staticHandler?.(req, res))
      httpServer.on('error', (err) => log.error('remote-gateway http error', { message: err.message }))
      const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_PAYLOAD_BYTES })
      wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress ?? ''
        // Second line after bind (F5): even a mis-detected interface can't serve a
        // non-tailnet peer.
        if (!isTailnetAddress(ip)) {
          ws.terminate()
          return
        }
        this.onConnection(ws, ip)
      })
      wss.on('error', (err) => log.error('remote-gateway ws error', { message: err.message }))
      httpServer.listen(PORT, addr, () =>
        log.info('remote-gateway listening', { host: addr, port: PORT }),
      )
      this.httpServer = httpServer
      this.wss = wss
      this.boundAddress = addr
    } catch (err) {
      log.error('remote-gateway bind failed', {
        message: err instanceof Error ? err.message : String(err),
      })
      this.boundAddress = null
    }
    this.emitStatus()
  }

  private closeServer(): void {
    for (const ws of this.conns.keys()) ws.terminate()
    this.conns.clear()
    this.wss?.close()
    this.wss = null
    this.httpServer?.close()
    this.httpServer = null
    this.boundAddress = null
    this.emitStatus()
  }

  // --- connection lifecycle ------------------------------------------------

  private onConnection(ws: WebSocket, ip: string): void {
    // F-2: cap concurrent un-authenticated sockets so a tailnet peer can't exhaust
    // main by opening connections that never authenticate.
    const unauth = [...this.conns.values()].filter((s) => !s.deviceId).length
    if (unauth >= MAX_UNAUTH_CONNS) {
      ws.terminate()
      return
    }
    // F-2: a socket that doesn't pair/auth within the deadline is dropped.
    const authTimer = setTimeout(() => {
      const st = this.conns.get(ws)
      if (st && !st.deviceId) ws.terminate()
    }, AUTH_DEADLINE_MS)
    this.conns.set(ws, { deviceId: null, subs: new Set(), ip, authTimer })
    ws.on('message', (data) => void this.onMessage(ws, data))
    ws.on('close', () => this.onClose(ws))
    ws.on('error', () => ws.terminate())
  }

  private onClose(ws: WebSocket): void {
    // Concurrent-turn counts settle in handleRpc's `finally` when engine.request
    // resolves/rejects (a mid-turn disconnect still settles), so closing just drops
    // the connection.
    const st = this.conns.get(ws)
    if (st?.authTimer) clearTimeout(st.authTimer)
    this.conns.delete(ws)
  }

  // Mark a connection authenticated: bind the device id + cancel the auth deadline.
  private markAuthed(state: ConnState, deviceId: string): void {
    state.deviceId = deviceId
    if (state.authTimer) {
      clearTimeout(state.authTimer)
      state.authTimer = null
    }
  }

  // --- auth failure lockout (F-4) ------------------------------------------

  private isLockedOut(ip: string): boolean {
    const e = this.authFails.get(ip)
    return !!e && Date.now() < e.until
  }

  private recordAuthFail(ip: string): void {
    const e = this.authFails.get(ip) ?? { count: 0, until: 0 }
    e.count += 1
    if (e.count >= MAX_AUTH_FAILS) {
      e.until = Date.now() + AUTH_LOCKOUT_MS
      e.count = 0
    }
    this.authFails.set(ip, e)
  }

  private send(ws: WebSocket, frame: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }

  private async onMessage(ws: WebSocket, data: RawData): Promise<void> {
    const state = this.conns.get(ws)
    if (!state) return
    let frame: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(data.toString())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad frame')
      frame = parsed as Record<string, unknown>
    } catch {
      this.send(ws, { type: 'error', code: -32700, message: 'malformed frame' })
      return
    }
    const type = typeof frame.type === 'string' ? frame.type : ''
    try {
      switch (type) {
        case 'pair':
          return await this.handlePair(ws, state, frame)
        case 'auth':
          return await this.handleAuth(ws, state, frame)
        case 'ping':
          return this.send(ws, { type: 'pong' })
        case 'subscribe':
          return this.handleSubscribe(state, frame, true)
        case 'unsubscribe':
          return this.handleSubscribe(state, frame, false)
        case 'rpc':
          return await this.handleRpc(ws, state, frame)
        default:
          this.send(ws, { type: 'error', code: -32600, message: `unknown frame: ${type}` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.send(ws, { type: 'error', code: -32000, message })
    }
  }

  // --- pairing + auth (F6) -------------------------------------------------

  private async handlePair(
    ws: WebSocket,
    state: ConnState,
    frame: Record<string, unknown>,
  ): Promise<void> {
    if (state.deviceId) {
      this.send(ws, { type: 'error', code: -32001, message: 'already authenticated' })
      return
    }
    if (this.isLockedOut(state.ip)) {
      this.send(ws, { type: 'error', code: -32008, message: 'too many attempts' })
      ws.close()
      return
    }
    const code = typeof frame.code === 'string' ? frame.code : ''
    const label = typeof frame.label === 'string' ? frame.label : 'Thiết bị'
    const platform = typeof frame.platform === 'string' ? frame.platform : 'web'
    const result = await this.store.completePairing(code, label, platform)
    if (!result) {
      this.recordAuthFail(state.ip)
      this.send(ws, { type: 'error', code: -32002, message: 'mã ghép nối không hợp lệ / hết hạn' })
      return
    }
    this.authFails.delete(state.ip)
    this.markAuthed(state, result.device.id)
    this.send(ws, { type: 'paired', token: result.token, device: result.device })
    this.emitDevicesChanged()
  }

  private async handleAuth(
    ws: WebSocket,
    state: ConnState,
    frame: Record<string, unknown>,
  ): Promise<void> {
    if (this.isLockedOut(state.ip)) {
      this.send(ws, { type: 'error', code: -32008, message: 'too many attempts' })
      ws.close()
      return
    }
    const token = typeof frame.token === 'string' ? frame.token : ''
    const deviceId = await this.store.verifyToken(token)
    if (!deviceId) {
      this.recordAuthFail(state.ip)
      this.send(ws, { type: 'error', code: -32003, message: 'unauthorized' })
      ws.close()
      return
    }
    // Connection cap per device (F8).
    const active = [...this.conns.values()].filter((s) => s.deviceId === deviceId).length
    if (active >= MAX_CONNS_PER_DEVICE) {
      this.send(ws, { type: 'error', code: -32004, message: 'too many connections' })
      ws.close()
      return
    }
    this.authFails.delete(state.ip)
    this.markAuthed(state, deviceId)
    this.send(ws, { type: 'authed', ok: true })
    this.emitDevicesChanged() // lastSeenAt refreshed
  }

  private handleSubscribe(
    state: ConnState,
    frame: Record<string, unknown>,
    add: boolean,
  ): void {
    if (!state.deviceId) return
    const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : ''
    if (!sessionId) return
    if (add) state.subs.add(sessionId)
    else state.subs.delete(sessionId)
  }

  // --- rpc (F1/F3/F4 + F8) -------------------------------------------------

  private async handleRpc(
    ws: WebSocket,
    state: ConnState,
    frame: Record<string, unknown>,
  ): Promise<void> {
    const id = frame.id
    if (!state.deviceId) {
      this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32003, message: 'unauthorized' } })
      return
    }
    // F-6: refuse until the allowlist has been validated against the registry.
    if (!this.validated) {
      this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32009, message: 'gateway initializing' } })
      return
    }
    const method = typeof frame.method === 'string' ? frame.method : ''
    // Gateway-LOCAL method: composed + field-picked here, never forwarded raw
    // (see remote-gateway-catalog.ts). Not on the engine allowlist by design.
    if (isLocalMethod(method)) {
      try {
        const value = await handleLocalMethod(method, (m, p) => engine.request(m, p))
        this.send(ws, { type: 'rpc-result', id, ok: true, value })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'error'
        this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32000, message } })
      }
      return
    }
    if (!isMethodAllowed(method)) {
      this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32601, message: 'method not allowed' } })
      return
    }
    const budget = this.budgetFor(state.deviceId)
    // F8 + text cap for turn-driving calls.
    if (TURN_DRIVING.has(method)) {
      const text = (frame.params as { text?: unknown } | undefined)?.text
      if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
        this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32005, message: 'message too large' } })
        return
      }
      if (!this.spend(budget, 'sends', MAX_SENDS_PER_HOUR)) {
        this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32007, message: 'hourly send limit reached' } })
        return
      }
    } else if (LIFECYCLE_WRITES.has(method)) {
      if (!this.spend(budget, 'writes', MAX_WRITES_PER_HOUR)) {
        this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32007, message: 'hourly write limit reached' } })
        return
      }
    }
    let params: unknown
    try {
      params = await sanitizeRemoteParams(method, frame.params, (m, p) => engine.request(m, p))
    } catch (err) {
      const message = err instanceof RemoteRejected ? err.message : 'invalid params'
      this.send(ws, { type: 'rpc-result', id, ok: false, error: { code: -32602, message } })
      return
    }
    try {
      const value = await engine.request(method, params)
      this.send(ws, { type: 'rpc-result', id, ok: true, value })
    } catch (err) {
      const e = err as { code?: number; message?: string }
      this.send(ws, {
        type: 'rpc-result',
        id,
        ok: false,
        error: { code: typeof e.code === 'number' ? e.code : -32000, message: e.message ?? 'error' },
      })
    }
  }

  private budgetFor(deviceId: string): DeviceBudget {
    let b = this.budgets.get(deviceId)
    if (!b) {
      b = { sends: [], writes: [] }
      this.budgets.set(deviceId, b)
    }
    return b
  }

  // Sliding one-hour window: drop stale stamps, then take a slot if one is free.
  private spend(budget: DeviceBudget, bucket: 'sends' | 'writes', limit: number): boolean {
    const now = Date.now()
    const kept = budget[bucket].filter((t) => now - t < 3_600_000)
    if (kept.length >= limit) {
      budget[bucket] = kept
      return false
    }
    kept.push(now)
    budget[bucket] = kept
    return true
  }

  // --- event egress (F2) ---------------------------------------------------

  private fanoutEvent(type: string, payload: unknown): void {
    if (this.conns.size === 0 || !isEventForwardable(type)) return
    const sessionId = eventSessionId(payload)
    if (!sessionId) return
    const frame = { type: 'event', event: { type, payload } }
    for (const [ws, state] of this.conns) {
      if (state.deviceId && state.subs.has(sessionId)) this.send(ws, frame)
    }
  }

  // --- renderer IPC (Settings → Devices) -----------------------------------

  private status(): GatewayStatus {
    // Report the tailnet independently of the binding: while remote control is
    // off nothing is bound, but the panel should still say whether Tailscale is
    // up — otherwise enabling it looks broken.
    const addr = this.boundAddress ?? findTailnetAddress()
    return {
      enabled: this.store.isEnabled(),
      tailnet: addr ? 'connected' : 'disconnected',
      host: addr,
      port: PORT,
      bound: this.wss !== null,
    }
  }

  // Turn remote control on/off. Off closes every live socket immediately — a
  // revoke-all in one switch — and the poll below stops re-binding.
  private async setEnabled(on: boolean): Promise<void> {
    if (on === this.store.isEnabled()) return
    await this.store.setEnabled(on)
    log.info('remote-gateway enabled changed', { enabled: on })
    if (on) this.bindIfPossible()
    else this.closeServer()
    this.emitStatus()
  }

  private emitStatus(): void {
    this.getWindow()?.webContents.send('gateway:status-changed', this.status())
  }

  private emitDevicesChanged(): void {
    this.getWindow()?.webContents.send('gateway:devices-changed', this.store.list())
  }

  private registerIpc(): void {
    ipcMain.handle('gateway:status', () => this.status())
    ipcMain.handle('gateway:setEnabled', async (_e, on: boolean) => {
      await this.setEnabled(on === true)
      return this.status()
    })
    ipcMain.handle('gateway:listDevices', () => this.store.list())
    ipcMain.handle('gateway:createPairing', () => {
      if (!this.store.isEnabled()) throw new Error('remote control is off')
      if (!this.boundAddress) throw new Error('tailnet not connected')
      const { code, expiresAt } = this.store.createPairing()
      return { code, expiresAt, host: this.boundAddress, port: PORT }
    })
    ipcMain.handle('gateway:revokeDevice', async (_e, id: string) => {
      const ok = await this.store.revoke(id)
      // Force-close every live socket of the revoked device (F4/AC-SEC-5) — no
      // waiting for token expiry. Clear deviceId first (F-8) so an in-flight frame
      // racing the terminate can't still pass the auth check.
      for (const [ws, state] of this.conns) {
        if (state.deviceId === id) {
          state.deviceId = null
          ws.terminate()
        }
      }
      this.emitDevicesChanged()
      return ok
    })
  }
}

const gateway = new RemoteGateway()

export function startRemoteGateway(getWindow: () => BrowserWindow | null): void {
  void gateway.start(getWindow)
}

export function stopRemoteGateway(): void {
  gateway.stop()
}
