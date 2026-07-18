// VpnManager runtime — VPN Manager P1 (design §1). Structural sibling of
// SshManager: a singleton holding a Map<vpnId, record>, sidecar-side control, and
// a SIGTERM/SIGINT shutdown. Difference from SSH: the controlled openvpn process
// is ROOT and DETACHED — we never own its stdio and cannot kill(2) it; all
// liveness/stop go through the loopback management socket + the --writepid file.
//
// SECURITY (see design §5):
//   - VPN creds resolve from the keychain into memory (`cred` closure) and go ONLY
//     into the management `username`/`password` commands — never a file, log,
//     event, RPC response, or trace (invariant #1).
//   - The management socket binds 127.0.0.1 + a random port + a random per-run
//     pw-file (0600 in a 0700 dir), unlinked right after CONNECTED (invariant #6).
//   - The wire shape (VpnRuntimeState) NEVER carries ports, pw-file paths, or
//     secrets.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { emit } from '../transport/stdio.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { installHint, resolveOpenvpnBinary } from './binary.js'
import { validateOvpnConfig } from './ovpn-config.js'
import { bindTestFreePort, buildOpenvpnArgv, runtimePaths, writePwFile } from './launch.js'
import { ManagementClient } from './management-client.js'
import { ElevationCancelled, selectAdapter } from './elevation/adapter.js'
import { listProfiles, loadProfile, saveProfile } from './store.js'
import { loadVpnCredential } from './credentials.js'
import type { VpnCredential, VpnProfileConfig, VpnStatus } from './schema.js'

export type VpnRuntimeStatus = 'down' | 'connecting' | 'up' | 'error'

// The ONLY shape that crosses the wire (vpn.status result + vpn:status-changed
// event). NEVER ports, pw-file paths, or secrets.
export interface VpnRuntimeState {
  id: string
  status: VpnRuntimeStatus
  refCount: number
  pid?: number
  upAt?: number
  error?: string
}

interface ReadyPark {
  resolve: () => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

interface VpnRuntimeRecord {
  id: string
  status: VpnRuntimeStatus
  mgmtPort: number
  pwFile: string
  pidFile: string
  logFile: string
  refCount: number // P3 — number of SSH connections sharing this tunnel
  startedAt: number
  keepalive: boolean // profile flag (P2) — auto-restart on unexpected process death
  autoDown: boolean // profile flag (P3) — tear down when refCount hits 0
  stopping: boolean // set by down() so onClose finalizes cleanly
  logWindowStart: number // vpn:log rate-limit window
  logCount: number
  mgmt?: ManagementClient
  pid?: number
  upAt?: number
  lastError?: string
  ready?: ReadyPark
  downResolve?: () => void
}

const CONNECT_TIMEOUT_MS = 60_000
const MGMT_CONNECT_TIMEOUT_MS = 5_000
const MGMT_CONNECT_RETRY_MS = 200
const DOWN_GRACE_MS = 5_000
const MAX_LOG_LINES_PER_SEC = 20

// P2 keepalive — auto-restart backoff after an UNEXPECTED process death (design
// §7.2 / spec P2 case 2). Each entry is one attempt; a fresh up() re-elevates, so
// this WILL re-prompt for admin. Chain length = number of attempts before we latch
// `error`.
const RESTART_BACKOFFS_MS = [3_000, 10_000, 30_000] as const

// P2 keepalive — health poll interval for the belt-and-suspenders liveness check
// (design §1.6). Skipped on win32 (process.kill(pid,0) semantics differ there).
const HEALTH_POLL_MS = 15_000

// P2 keepalive — openvpn STATE names that mean "the tunnel dropped and openvpn's
// OWN ping-restart is re-establishing it WITHOUT the process exiting" (case 1).
// Seen only AFTER the first CONNECTED (initial-connect progress states are ignored
// while status is still `connecting`). No re-elevation / re-spawn on these.
const RECONNECT_STATES = new Set(['RECONNECTING', 'WAIT'])

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    const t = setTimeout(resolvePromise, ms)
    t.unref?.()
  })
}

// Probe a (possibly root-owned) pid we do NOT own, WITHOUT signalling it. On
// macOS/Linux a signal-0 from a non-root sidecar to a root process throws EPERM =
// the process EXISTS (alive); ESRCH = no such process (dead). Do NOT misread EPERM
// as death (design §1.6). Unreliable on win32 — the caller skips the poll there.
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // already gone
  }
}

async function readPidFile(path: string): Promise<number | undefined> {
  try {
    const raw = await readFile(path, 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

// Our runtime errors carry no secret (creds are pushed over the socket, never
// interpolated into an error). Keep the message short + single-line for the UI.
function sanitizeVpnError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return (msg.split('\n').find((l) => l.trim().length > 0) ?? msg).trim().slice(0, 300)
}

// openvpn --verb 3 lines are L1-untrusted: strip control chars + cap length. (At
// verb 3 openvpn does not print credentials; it masks passwords.)
function sanitizeLogLine(line: string): string {
  // Drop C0/C1 control chars (\u0000-\u001f, \u007f) so a crafted log line
  // can't inject terminal/UI control sequences; then cap length.
  return line.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
}

// Derive the wire state for a profile that has NO live record (persisted status).
export function persistedStateOf(profile: VpnProfileConfig): VpnRuntimeState {
  const status: VpnRuntimeStatus = profile.status ?? 'down'
  return {
    id: profile.id,
    status,
    refCount: 0,
    ...(profile.statusError ? { error: profile.statusError } : {}),
  }
}

interface RestartEntry {
  attempt: number
  timer: NodeJS.Timeout | null
}

class VpnManager {
  private runtimes = new Map<string, VpnRuntimeRecord>()

  // Shared in-flight bring-up per id (P3). Concurrent callers — a manual up() and N
  // ssh.ensureUp() — await the SAME promise, so a VPN is elevated ONCE (one admin
  // prompt). Registered synchronously before the first await, so it also closes the
  // race between bringUp() entry and record creation.
  private inflight = new Map<string, Promise<void>>()

  // P2 keepalive — a pending auto-restart chain per id (after an unexpected process
  // death). Lives OUTSIDE the record (which is torn down between attempts). Cleared
  // by down()/manual up()/shutdown().
  private restarts = new Map<string, RestartEntry>()

  // P2 keepalive — single shared health-poll interval (design §1.6). Started when a
  // tunnel goes up, self-clears when none remain up. Never on win32.
  private healthTimer: NodeJS.Timeout | null = null

  // ─── Public API ────────────────────────────────────────────────────────────

  async up(id: string): Promise<{ status: VpnRuntimeStatus }> {
    // 1. Idempotency (no second prompt for a live / in-flight / self-healing tunnel).
    const existing = this.runtimes.get(id)
    if (existing && (existing.status === 'up' || existing.status === 'connecting')) {
      return { status: existing.status }
    }
    // A concurrent bring-up is already parked (record not yet created) — join it.
    const inflight = this.inflight.get(id)
    if (inflight) {
      await inflight
      return { status: this.runtimes.get(id)?.status ?? 'error' }
    }
    // Explicit bring-up supersedes any pending auto-restart, then goes fresh.
    this.cancelRestart(id)
    await this.beginBringUp(id)
    return { status: 'up' }
  }

  async down(id: string): Promise<void> {
    // A manual down cancels any pending keepalive restart chain.
    const hadRestart = this.cancelRestart(id)
    const record = this.runtimes.get(id)
    if (!record) {
      // No live tunnel — but a restart may have been mid-backoff; reflect the cancel
      // so the UI leaves the transient 'connecting'.
      if (hadRestart) {
        this.emitBareStatus(id, 'down', 0)
        void this.persistStatus(id, 'down')
      }
      return
    }
    record.stopping = true
    const { mgmt } = record
    if (mgmt) {
      const closed = new Promise<void>((resolvePromise) => {
        record.downResolve = resolvePromise
      })
      mgmt.stop() // signal SIGTERM — the only clean stop a non-root sidecar has
      await Promise.race([closed, delay(DOWN_GRACE_MS)])
    }
    // Finalize (if onClose didn't already tear it down).
    if (this.runtimes.has(id)) {
      record.status = 'down'
      this.emitStatus(record)
      void this.persistStatus(id, 'down')
      this.cleanup(id)
    }
  }

  // Sync snapshot of the LIVE map (filtered by id). Persisted profiles with no
  // live record are merged in by the vpn.status method (async).
  status(id?: string): { states: VpnRuntimeState[] } {
    const records = [...this.runtimes.values()].filter((r) => (id ? r.id === id : true))
    return { states: records.map((r) => this.toState(r)) }
  }

  isUp(id: string): boolean {
    return this.runtimes.get(id)?.status === 'up'
  }

  // P3 — "1 VPN, many SSH". Bring the tunnel up (once) and take a reference so N
  // SSH hosts on the same VPN share ONE process + ONE admin prompt. Throws if the
  // bring-up fails so ssh.connect can surface it (and NOT leak a ref — no increment
  // happens on the failure paths).
  async ensureUp(id: string): Promise<void> {
    const existing = this.runtimes.get(id)
    if (existing?.status === 'up') {
      existing.refCount += 1
      this.emitStatus(existing) // refCount changed → UI updates "N sessions"
      return
    }
    // A bring-up is parked (initial or shared) → await the SAME one, then take a ref.
    const inflight = this.inflight.get(id)
    if (inflight) {
      await inflight
      const rec = this.runtimes.get(id)
      if (rec?.status !== 'up') throw new Error('VPN did not come up')
      rec.refCount += 1
      this.emitStatus(rec)
      return
    }
    // Self-heal reconnect in flight (live process, no bring-up call): the tunnel
    // exists and openvpn is re-establishing it — take a ref optimistically. Routing
    // returns within seconds and ssh2's own connect timeout covers the gap; the ref
    // is preserved across the reconnect (same record) so it never leaks.
    if (existing?.status === 'connecting') {
      existing.refCount += 1
      this.emitStatus(existing)
      return
    }
    // down / absent / latched error → fresh bring-up, then refCount = 1.
    this.cancelRestart(id)
    await this.beginBringUp(id)
    const rec = this.runtimes.get(id)
    if (rec?.status !== 'up') throw new Error('VPN failed to come up')
    rec.refCount += 1 // was 0 on a fresh record
    this.emitStatus(rec)
  }

  // P3 — drop one SSH reference. When it hits 0 AND the profile opted into autoDown,
  // tear the tunnel down; otherwise keep it up. NEVER throws (called from SSH
  // teardown, which must not break).
  release(id: string): void {
    const record = this.runtimes.get(id)
    if (!record) return
    record.refCount = Math.max(0, record.refCount - 1)
    this.emitStatus(record)
    if (record.refCount === 0 && record.autoDown && record.status === 'up') {
      void this.down(id).catch((err) => {
        log.warn('vpn: auto-down after refCount=0 failed', { id, err: sanitizeVpnError(err) })
      })
    }
  }

  // SIGTERM/SIGINT: best-effort SIGTERM every live tunnel via the socket, then
  // release sidecar-side resources. The elevated openvpn may outlive us (design
  // §7.2) — P1 accepts that and marks down on next start.
  shutdown(): void {
    for (const record of this.runtimes.values()) {
      try {
        record.mgmt?.stop()
      } catch {
        // ignore
      }
      try {
        record.mgmt?.destroy()
      } catch {
        // ignore
      }
      if (record.ready) clearTimeout(record.ready.timer)
    }
    this.runtimes.clear()
    this.inflight.clear()
    for (const entry of this.restarts.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.restarts.clear()
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  // ─── up() control flow (design §1.4) ───────────────────────────────────────

  // Shared raw bring-up registered in `inflight` so concurrent callers (a manual
  // up() + N ssh.ensureUp()) await ONE elevation. Clears a latched error/down
  // record first. Does NOT cancel a pending auto-restart — the restart path calls
  // this directly and owns its own bookkeeping; user-facing up()/ensureUp() cancel
  // the restart before calling this.
  private beginBringUp(id: string): Promise<void> {
    const inflight = this.inflight.get(id)
    if (inflight) return inflight
    const existing = this.runtimes.get(id)
    if (existing) this.cleanup(id) // only ever a down/error record reaches here
    const promise = this.bringUp(id).finally(() => {
      this.inflight.delete(id)
    })
    this.inflight.set(id, promise)
    return promise
  }

  private async bringUp(id: string): Promise<void> {
    // 2. Load + validate.
    const profile = await loadProfile(id)
    if (!profile) throw new RpcError(-32602, `vpn profile not found: ${id}`)

    const binary = await resolveOpenvpnBinary()
    if (!binary) throw new Error(`OpenVPN unavailable — ${installHint()}`)

    const { configPath, dir } = await validateOvpnConfig(profile.configPath)
    const cred = await loadVpnCredential(id) // in-memory only; may be null

    // 3. Allocate runtime files (0700 dir, 0600 pw-file).
    const paths = runtimePaths(id)
    await mkdir(paths.dir, { recursive: true, mode: 0o700 })
    await safeUnlink(paths.pidFile) // drop a stale pid from a previous run
    const port = await bindTestFreePort()
    const mgmtPw = randomBytes(24).toString('base64url')
    await writePwFile(paths.pwFile, mgmtPw)

    // 4. Create the connecting record + arm the readiness park.
    const record: VpnRuntimeRecord = {
      id,
      status: 'connecting',
      mgmtPort: port,
      pwFile: paths.pwFile,
      pidFile: paths.pidFile,
      logFile: paths.logFile,
      refCount: 0,
      startedAt: Date.now(),
      keepalive: profile.keepalive,
      autoDown: profile.autoDown,
      stopping: false,
      logWindowStart: 0,
      logCount: 0,
    }
    this.runtimes.set(id, record)
    this.emitStatus(record)
    void this.persistStatus(id, 'connecting')

    const readyPromise = new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.fail(id, new Error('VPN connection timed out'), 'error')
      }, CONNECT_TIMEOUT_MS)
      timer.unref?.()
      record.ready = { resolve: resolvePromise, reject, timer }
    })

    // 5. Build argv + spawn elevated. A prompt cancel → clean `down`, not `error`.
    const argv = buildOpenvpnArgv({
      configPath,
      ovpnDir: dir,
      port,
      pwFile: paths.pwFile,
      pidFile: paths.pidFile,
      logFile: paths.logFile,
    })
    const adapter = selectAdapter()

    try {
      const { pid } = await adapter.spawnElevated(binary, argv)
      if (pid !== undefined) record.pid = pid

      // 6. Attach management (retry ECONNREFUSED ≤5s), register handlers, release hold.
      await this.attachManagement(record, port, mgmtPw, cred)

      // 8. Resolve on the first CONNECTED (handlers drive readyPromise).
      await readyPromise
    } catch (err) {
      // 9. Failure paths: prompt cancel → down; everything else → latched error.
      this.fail(id, err, err instanceof ElevationCancelled ? 'down' : 'error')
      if (err instanceof ElevationCancelled) {
        throw new Error('VPN elevation was cancelled')
      }
      throw err instanceof RpcError ? err : new Error(sanitizeVpnError(err))
    }
  }

  private async attachManagement(
    record: VpnRuntimeRecord,
    port: number,
    mgmtPw: string,
    cred: VpnCredential | null,
  ): Promise<void> {
    const mgmt = new ManagementClient()
    const deadline = Date.now() + MGMT_CONNECT_TIMEOUT_MS
    for (;;) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await mgmt.connect(port, mgmtPw)
        break
      } catch (err) {
        if (Date.now() >= deadline) {
          throw new Error(`management socket unreachable: ${sanitizeVpnError(err)}`)
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(MGMT_CONNECT_RETRY_MS)
      }
    }
    record.mgmt = mgmt

    // Register handlers BEFORE start() (design §3.3) or we miss the cred query.
    mgmt.onState = (fields) => this.onStateLine(record.id, fields)
    mgmt.onAuthNeeded = (kind) => this.onAuthNeeded(record.id, kind, cred)
    mgmt.onAuthFailed = () => this.onAuthFailed(record.id)
    mgmt.onFatal = (reason) => this.onFatal(record.id, reason)
    mgmt.onLog = (line) => this.onLog(record.id, line)
    mgmt.onClose = () => this.onMgmtClose(record.id)

    await mgmt.start() // state on → hold release
  }

  // ─── Management event handlers ─────────────────────────────────────────────

  private onStateLine(id: string, fields: string[]): void {
    const state = fields[1]
    if (state === 'CONNECTED') void this.onConnected(id)
    else if (state === 'EXITING') this.onExiting(id)
    else this.onReconnectingState(id, state)
    // During the INITIAL connect the progress states (WAIT / AUTH / GET_CONFIG /
    // ASSIGN_IP / ADD_ROUTES …) are ignored by onReconnectingState (status is still
    // `connecting`); they only matter once the tunnel has been up.
  }

  // P2 case 1 — openvpn's own ping-restart is re-establishing the tunnel WITHOUT the
  // process exiting (the management socket stays connected). Flip the visible status
  // back to `connecting` so the UI shows "reconnecting"; the next CONNECTED flips it
  // back to `up`. NO re-elevation, NO re-spawn — this is the primary keepalive value.
  private onReconnectingState(id: string, state: string): void {
    const record = this.runtimes.get(id)
    if (!record) return
    if (record.status === 'up' && RECONNECT_STATES.has(state)) {
      record.status = 'connecting'
      this.emitStatus(record)
      void this.persistStatus(id, 'connecting')
    }
  }

  private async onConnected(id: string): Promise<void> {
    const record = this.runtimes.get(id)
    if (!record || record.status === 'up') return
    record.status = 'up'
    // Keep the ORIGINAL connect time across self-heal reconnects (only set once).
    if (record.upAt === undefined) record.upAt = Date.now()
    if (record.pid === undefined) {
      const pid = await readPidFile(record.pidFile)
      if (pid !== undefined) record.pid = pid
    }
    // The pw-file's job is done the moment openvpn is up — remove the secret.
    await safeUnlink(record.pwFile)
    this.settleReady(id)
    this.emitStatus(record)
    void this.persistStatus(id, 'up')
    // Start the belt-and-suspenders liveness poll now that a tunnel is up.
    this.ensureHealthPoll()
  }

  private onAuthNeeded(id: string, kind: 'Auth' | 'Private Key', cred: VpnCredential | null): void {
    const record = this.runtimes.get(id)
    if (!record?.mgmt) return
    if (kind === 'Auth') {
      if (!cred?.username || !cred.password) {
        this.fail(id, new Error('VPN requires a username and password, but none is stored'), 'error')
        return
      }
      record.mgmt.pushUserPass(cred.username, cred.password)
    } else {
      if (!cred?.keyPassphrase) {
        this.fail(id, new Error('VPN private key needs a passphrase, but none is stored'), 'error')
        return
      }
      record.mgmt.pushKeyPassphrase(cred.keyPassphrase)
    }
  }

  private onAuthFailed(id: string): void {
    // Do NOT echo the server-supplied reason (L1-untrusted) and do NOT loop.
    this.fail(id, new Error('VPN authentication failed'), 'error')
  }

  private onFatal(id: string, reason: string): void {
    this.fail(id, new Error(`VPN fatal error: ${sanitizeLogLine(reason)}`), 'error')
  }

  private onLog(id: string, line: string): void {
    const record = this.runtimes.get(id)
    if (!record) return
    const now = Date.now()
    if (now - record.logWindowStart > 1000) {
      record.logWindowStart = now
      record.logCount = 0
    }
    if (record.logCount >= MAX_LOG_LINES_PER_SEC) return
    record.logCount += 1
    emit('vpn:log', { id, line: sanitizeLogLine(line) })
  }

  private onExiting(id: string): void {
    // EXITING precedes the socket close; let onMgmtClose finalize state. Just
    // release a down() waiter early so teardown doesn't wait the full grace.
    this.runtimes.get(id)?.downResolve?.()
  }

  private onMgmtClose(id: string): void {
    const record = this.runtimes.get(id)
    if (!record) return
    record.downResolve?.()
    if (record.stopping) return // down() owns the finalize
    // `upAt` (not `status`) is the "was it ever up" signal — during a self-heal the
    // status is transiently `connecting` but upAt is already set, so a mid-reconnect
    // process death still routes to the keepalive path (not the initial-fail path).
    if (record.upAt !== undefined) {
      this.handleUnexpectedDrop(id)
    } else {
      this.fail(id, new Error('management connection closed before the tunnel came up'), 'error')
    }
  }

  // ─── P2 keepalive — unexpected drop → auto-restart (design §7.2) ────────────

  // The tunnel dropped unexpectedly (process died / socket closed while it had been
  // up). Tear the dead record down, then: if keepalive is on, auto-restart with
  // backoff (this WILL re-prompt for admin); otherwise report a clean `down`. Any
  // SSH refs are dropped — the SSH connections are broken too and their teardown
  // release()s into the now-absent record (no-op), so the restarted tunnel starts
  // fresh at refCount 0 (no leak, no stale count).
  private handleUnexpectedDrop(id: string): void {
    const record = this.runtimes.get(id)
    if (!record) return
    const { keepalive } = record
    this.cleanup(id)
    if (keepalive) {
      this.beginRestart(id)
    } else {
      this.emitBareStatus(id, 'down', 0)
      void this.persistStatus(id, 'down')
    }
  }

  private beginRestart(id: string): void {
    this.restarts.set(id, { attempt: 0, timer: null })
    // Show 'connecting' during the backoff so the UI reads "reconnecting", not down.
    this.emitBareStatus(id, 'connecting', 0)
    void this.persistStatus(id, 'connecting')
    this.scheduleNextRestart(id)
  }

  private scheduleNextRestart(id: string): void {
    const entry = this.restarts.get(id)
    if (!entry) return
    if (entry.attempt >= RESTART_BACKOFFS_MS.length) {
      // Chain exhausted — latch error.
      this.restarts.delete(id)
      const message = `VPN auto-restart failed after ${RESTART_BACKOFFS_MS.length} attempts`
      this.emitBareStatus(id, 'error', 0, message)
      void this.persistStatus(id, 'error', message)
      return
    }
    const timer = setTimeout(() => void this.runRestartAttempt(id), RESTART_BACKOFFS_MS[entry.attempt])
    timer.unref?.()
    entry.timer = timer
    entry.attempt += 1
  }

  private async runRestartAttempt(id: string): Promise<void> {
    const entry = this.restarts.get(id)
    if (!entry) return // cancelled by down() / manual up()
    entry.timer = null
    // A manual bring-up may have already revived it while we waited.
    const live = this.runtimes.get(id)
    if (live && (live.status === 'up' || live.status === 'connecting')) {
      this.restarts.delete(id)
      return
    }
    try {
      await this.beginBringUp(id) // re-elevates (admin prompt); shares `inflight`
      this.restarts.delete(id)
    } catch {
      // down() may have cancelled during the await — only reschedule if still armed.
      if (this.restarts.has(id)) this.scheduleNextRestart(id)
    }
  }

  // true if a pending restart chain was cancelled (used by down() to reflect it).
  private cancelRestart(id: string): boolean {
    const entry = this.restarts.get(id)
    if (!entry) return false
    if (entry.timer) clearTimeout(entry.timer)
    this.restarts.delete(id)
    return true
  }

  // ─── P2 keepalive — health poll (design §1.6) ──────────────────────────────

  private ensureHealthPoll(): void {
    if (this.healthTimer || process.platform === 'win32') return
    this.healthTimer = setInterval(() => this.pollHealth(), HEALTH_POLL_MS)
    this.healthTimer.unref?.()
  }

  private pollHealth(): void {
    let anyUp = false
    // Snapshot: handleUnexpectedDrop mutates the map (cleanup deletes the record).
    for (const record of [...this.runtimes.values()]) {
      if (record.status !== 'up' || record.pid === undefined) continue
      if (isProcessAlive(record.pid)) {
        anyUp = true
        continue
      }
      // Process gone but the socket didn't close — drive the same drop path.
      log.warn('vpn: health poll found the openvpn process gone', { id: record.id })
      this.handleUnexpectedDrop(record.id)
    }
    if (!anyUp && this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  // Emit a wire status for an id that has NO live record (restart transitions).
  private emitBareStatus(
    id: string,
    status: VpnRuntimeStatus,
    refCount: number,
    error?: string,
  ): void {
    const state: VpnRuntimeState = { id, status, refCount, ...(error ? { error } : {}) }
    emit('vpn:status-changed', state)
  }

  // ─── State helpers ─────────────────────────────────────────────────────────

  private toState(record: VpnRuntimeRecord, error?: string): VpnRuntimeState {
    const err = error ?? record.lastError
    return {
      id: record.id,
      status: record.status,
      refCount: record.refCount,
      ...(record.pid !== undefined ? { pid: record.pid } : {}),
      ...(record.upAt !== undefined ? { upAt: record.upAt } : {}),
      ...(err ? { error: err } : {}),
    }
  }

  private emitStatus(record: VpnRuntimeRecord, error?: string): void {
    emit('vpn:status-changed', this.toState(record, error))
  }

  // Idempotent terminal failure: latch `error` (or clean `down` on prompt cancel),
  // reject the readiness park, emit + persist, and release resources.
  private fail(id: string, err: unknown, kind: 'error' | 'down'): void {
    const record = this.runtimes.get(id)
    if (!record) return
    const message = sanitizeVpnError(err)
    record.status = kind
    if (kind === 'error') record.lastError = message
    this.settleReady(id, err instanceof Error ? err : new Error(message))
    this.emitStatus(record, kind === 'error' ? message : undefined)
    void this.persistStatus(id, kind, kind === 'error' ? message : undefined)
    this.cleanup(id)
  }

  private settleReady(id: string, err?: Error): void {
    const record = this.runtimes.get(id)
    const ready = record?.ready
    if (!record || !ready) return
    clearTimeout(ready.timer)
    delete record.ready
    if (err) ready.reject(err)
    else ready.resolve()
  }

  // Resource release only (NO status emit — the caller emits the right terminal
  // status). Idempotent (mirrors SshManager.teardown).
  private cleanup(id: string): void {
    const record = this.runtimes.get(id)
    if (!record) return
    this.runtimes.delete(id)
    if (record.ready) {
      clearTimeout(record.ready.timer)
      record.ready.reject(new Error('VPN connection torn down'))
      delete record.ready
    }
    record.mgmt?.destroy()
    void safeUnlink(record.pwFile)
    void safeUnlink(record.pidFile)
  }

  // Best-effort persist of last-known status onto the profile JSON (design §1.1).
  // Never throws — a persist failure must not break up()/down(). VpnRuntimeStatus
  // is a subset-equal of the schema's VpnStatus, so it maps 1:1.
  private async persistStatus(id: string, status: VpnStatus, error?: string): Promise<void> {
    try {
      const profile = await loadProfile(id)
      if (!profile) return
      const now = new Date().toISOString()
      const updated: VpnProfileConfig = { ...profile, status, updatedAt: now }
      if (status === 'up') {
        updated.lastUpAt = now
        delete updated.statusError
      } else if (error) {
        updated.statusError = error.slice(0, 2000)
      } else {
        delete updated.statusError
      }
      await saveProfile(updated)
    } catch (err) {
      log.warn('vpn: failed to persist status', { id, err: sanitizeVpnError(err) })
    }
  }
}

export const vpnManager = new VpnManager()

// Merge live runtime states with persisted status for profiles that have no live
// record (design §4 — vpn.status "includes persisted status"). Used by the
// vpn.status method so the manager's status() can stay a sync map snapshot.
export async function vpnStatusStates(id?: string): Promise<VpnRuntimeState[]> {
  const live = vpnManager.status(id).states
  const liveIds = new Set(live.map((s) => s.id))
  if (id) {
    if (liveIds.has(id)) return live
    const profile = await loadProfile(id)
    return profile ? [persistedStateOf(profile)] : []
  }
  const profiles = await listProfiles()
  const persisted = profiles.filter((p) => !liveIds.has(p.id)).map(persistedStateOf)
  return [...live, ...persisted]
}

// Kill live VPN control sockets with the sidecar (mirrors sshManager). The
// elevated openvpn is SIGTERM'd via the socket first (best-effort).
process.once('SIGTERM', () => vpnManager.shutdown())
process.once('SIGINT', () => vpnManager.shutdown())
