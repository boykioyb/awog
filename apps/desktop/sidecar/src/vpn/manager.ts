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
  refCount: number // P3 — always 0 in P1
  startedAt: number
  keepalive: boolean // profile flag, consumed in P2
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

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    const t = setTimeout(resolvePromise, ms)
    t.unref?.()
  })
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

class VpnManager {
  private runtimes = new Map<string, VpnRuntimeRecord>()

  // Sync lock closing the race between up() entry and record creation (both are
  // async-gapped). While an id is here it is treated as `connecting`.
  private starting = new Set<string>()

  // ─── Public API ────────────────────────────────────────────────────────────

  async up(id: string): Promise<{ status: VpnRuntimeStatus }> {
    // 1. Idempotency (no second prompt for an in-flight / live tunnel).
    const existing = this.runtimes.get(id)
    if (existing && (existing.status === 'up' || existing.status === 'connecting')) {
      return { status: existing.status }
    }
    if (this.starting.has(id)) return { status: 'connecting' }
    // Clear a latched error/down record before a fresh bring-up (design §1.1).
    if (existing) this.cleanup(id)
    this.starting.add(id)

    try {
      return await this.bringUp(id)
    } finally {
      this.starting.delete(id)
    }
  }

  async down(id: string): Promise<void> {
    const record = this.runtimes.get(id)
    if (!record) return // no-op
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

  // P1 stub: bring the tunnel up. P3 adds ref-count + park-sharing so N SSH hosts
  // reuse one tunnel with a single prompt.
  async ensureUp(id: string): Promise<void> {
    await this.up(id)
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
    this.starting.clear()
  }

  // ─── up() control flow (design §1.4) ───────────────────────────────────────

  private async bringUp(id: string): Promise<{ status: VpnRuntimeStatus }> {
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
      return { status: 'up' }
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
    // WAIT / AUTH / GET_CONFIG / ASSIGN_IP / ADD_ROUTES … are progress — ignored.
  }

  private async onConnected(id: string): Promise<void> {
    const record = this.runtimes.get(id)
    if (!record || record.status === 'up') return
    record.status = 'up'
    record.upAt = Date.now()
    if (record.pid === undefined) {
      const pid = await readPidFile(record.pidFile)
      if (pid !== undefined) record.pid = pid
    }
    // The pw-file's job is done the moment openvpn is up — remove the secret.
    await safeUnlink(record.pwFile)
    this.settleReady(id)
    this.emitStatus(record)
    void this.persistStatus(id, 'up')
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
    if (record.status === 'up') {
      // Unexpected drop (network loss / killed externally). P1 reports; keepalive
      // restart is P2.
      record.status = 'down'
      this.emitStatus(record)
      void this.persistStatus(id, 'down')
      this.cleanup(id)
    } else {
      this.fail(id, new Error('management connection closed before the tunnel came up'), 'error')
    }
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
