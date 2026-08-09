// SSH connection engine — ADR 0063 P2. Opens interactive shells / one-shot exec
// over SSH via the `ssh2` package. Structural sibling of terminal/manager.ts
// (node-pty PTY manager): a singleton with a Map<connId, record>, sidecar-side
// id generation, lazy dynamic import with graceful fallback, an idle sweep, and
// a SIGTERM/SIGINT shutdown that kills every live connection.
//
// SECURITY (invariant 1): passwords / key passphrases / private-key material are
// resolved from the keychain into the ssh2 connect config and NEVER leave the
// sidecar — they never appear in an emitted event, an RPC response, or a log
// field. Only status / fingerprint / host / port cross the wire. Host-key
// verification is mandatory (TOFU, see known-hosts.ts) — connections are never
// auto-accepted unless the host explicitly sets `options.strictHostKey=false`.
//
// SFTP + local/remote port-forwarding are later phases; jump-host chaining is
// the only network egress added here and it uses ssh2-native forwardOut (never a
// ProxyCommand shell string — invariant, no command injection).

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { vpnManager } from '../vpn/manager.js'
import { loadHost, loadIdentity, saveHost } from './store.js'
import { loadSshCredential } from './credentials.js'
import {
  dropHostKey,
  keyTypeFromBlob,
  parkHostKey,
  resolveHostKey,
  sha256Fingerprint,
  verifyHostKey,
} from './known-hosts.js'
import type { SshConnectionStatus, SshHostConfig } from './schema.js'

// ─── Minimal ssh2 typings ────────────────────────────────────────────────────
// We deliberately do NOT depend on @types/ssh2 — only the surface P2 uses is
// modelled here (Client connect/shell/exec/forwardOut/end + events, and the
// Channel it hands back). Conservative shapes; anything unused is omitted.
//
// The `key` passed to hostVerifier is the RAW host-key wire blob (a Buffer) when
// `hostHash` is unset — verified against ssh2's source (lib/protocol/kex.js
// invokes it with the parsed `hostPubKey` Buffer). The base64 of that blob is
// exactly the known_hosts key material; its first SSH-string field is the key
// type.

export interface Ssh2Error extends Error {
  level?: string
}

type HostVerifier = (keyBlob: Buffer, verify: (valid: boolean) => void) => void

interface Ssh2Stderr {
  on(event: 'data', listener: (chunk: Buffer) => void): void
}

export interface Ssh2Channel {
  stderr: Ssh2Stderr
  on(event: 'data', listener: (chunk: Buffer) => void): Ssh2Channel
  on(event: 'close', listener: (code?: number | null, signal?: string) => void): Ssh2Channel
  on(event: 'end', listener: () => void): Ssh2Channel
  write(data: string): boolean
  setWindow(rows: number, cols: number, height: number, width: number): void
  end(): void
}

interface Ssh2ConnectConfig {
  host: string
  port: number
  username: string
  hostVerifier: HostVerifier
  readyTimeout: number
  password?: string
  privateKey?: string
  passphrase?: string
  agent?: string
  sock?: Ssh2Channel
  // ssh2 sends a keepalive request every `keepaliveInterval` ms and drops the
  // connection after `keepaliveCountMax` unanswered ones. 0 (ssh2 default) disables.
  keepaliveInterval?: number
  keepaliveCountMax?: number
  // ssh2 negotiates compression via the algorithms list; prefer zlib when the
  // host opts in (options.compression), else leave ssh2's defaults untouched.
  algorithms?: { compress?: string[] }
}

interface Ssh2ShellWindow {
  term: string
  cols: number
  rows: number
}

type ChannelCallback = (err: Ssh2Error | undefined, channel: Ssh2Channel) => void

// ─── SFTP typings (P3) ───────────────────────────────────────────────────────
// Minimal surface consumed by ssh/sftp.ts. ssh2's Stats object carries numeric
// POSIX fields plus is*() helpers derived from the mode bits; mtime is Unix
// SECONDS (SSH-FXP attrs), converted to ms at the RPC boundary in sftp.ts.
export interface Ssh2SftpStats {
  mode: number
  size: number
  atime: number
  mtime: number
  // POSIX ownership ids — ssh2's Stats carries these numeric fields (SFTP has no
  // owner/group NAMES; those are resolved best-effort via `statx`, see sftp.ts).
  uid: number
  gid: number
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

export interface Ssh2SftpDirEntry {
  filename: string
  longname: string
  attrs: Ssh2SftpStats
}

export interface Ssh2SftpReadStream {
  on(event: 'data', listener: (chunk: Buffer) => void): Ssh2SftpReadStream
  on(event: 'end' | 'close', listener: () => void): Ssh2SftpReadStream
  on(event: 'error', listener: (err: Ssh2Error) => void): Ssh2SftpReadStream
  destroy(): void
}

export interface Ssh2TransferOptions {
  // ssh2 invokes step with (bytesTransferred, lastChunkSize, totalBytes).
  step?: (transferred: number, chunk: number, total: number) => void
}

export interface Ssh2Sftp {
  readdir(
    location: string,
    cb: (err: Ssh2Error | undefined, list: Ssh2SftpDirEntry[]) => void,
  ): void
  stat(path: string, cb: (err: Ssh2Error | undefined, stats: Ssh2SftpStats) => void): void
  lstat(path: string, cb: (err: Ssh2Error | undefined, stats: Ssh2SftpStats) => void): void
  mkdir(path: string, cb: (err: Ssh2Error | undefined) => void): void
  rename(from: string, to: string, cb: (err: Ssh2Error | undefined) => void): void
  unlink(path: string, cb: (err: Ssh2Error | undefined) => void): void
  rmdir(path: string, cb: (err: Ssh2Error | undefined) => void): void
  // Change permission bits natively over SFTP (no shell) — used by sftpChmod.
  chmod(path: string, mode: number, cb: (err: Ssh2Error | undefined) => void): void
  fastGet(
    remotePath: string,
    localPath: string,
    options: Ssh2TransferOptions,
    cb: (err: Ssh2Error | undefined) => void,
  ): void
  fastPut(
    localPath: string,
    remotePath: string,
    options: Ssh2TransferOptions,
    cb: (err: Ssh2Error | undefined) => void,
  ): void
  createReadStream(path: string, options?: { start?: number; end?: number }): Ssh2SftpReadStream
  // Convenience writer (P2, ADR 0064): write a whole buffer/string to a remote
  // path in one call. Used by sftpWriteContent for the agent ssh_write_file tool.
  writeFile(
    path: string,
    data: string | Buffer,
    options: { encoding?: BufferEncoding; mode?: number; flag?: string },
    cb: (err: Ssh2Error | undefined) => void,
  ): void
  on(event: 'error' | 'close' | 'end', listener: () => void): void
}

// ─── Port-forwarding typings (P4) ────────────────────────────────────────────
// ssh2 emits `tcp connection` for each incoming connection on a forwardIn bind.
// `destIP`/`destPort` identify the bound listener the connection arrived on.
export interface Ssh2TcpConnectionDetails {
  srcIP: string
  srcPort: number
  destIP: string
  destPort: number
}

export type TcpConnectionListener = (
  details: Ssh2TcpConnectionDetails,
  accept: () => Ssh2Channel,
  rejectConnection: () => void,
) => void

export interface Ssh2Client {
  connect(config: Ssh2ConnectConfig): Ssh2Client
  end(): Ssh2Client
  shell(window: Ssh2ShellWindow, callback: ChannelCallback): boolean
  exec(command: string, callback: ChannelCallback): boolean
  forwardOut(
    srcIP: string,
    srcPort: number,
    dstIP: string,
    dstPort: number,
    callback: ChannelCallback,
  ): boolean
  // SFTP subsystem (P3). One session per client, cached by connId in sftp.ts.
  sftp(callback: (err: Ssh2Error | undefined, sftp: Ssh2Sftp) => void): boolean
  // Remote forwarding (P4). forwardIn asks the server to listen on
  // bindAddr:bindPort; the callback yields the actual bound port (bindPort=0 →
  // server-assigned). Incoming connections surface as `tcp connection` events.
  forwardIn(
    bindAddr: string,
    bindPort: number,
    callback: (err: Ssh2Error | undefined, port: number) => void,
  ): boolean
  unforwardIn(
    bindAddr: string,
    bindPort: number,
    callback: (err: Ssh2Error | undefined) => void,
  ): boolean
  on(event: 'ready' | 'close' | 'end', listener: () => void): Ssh2Client
  on(event: 'error', listener: (err: Ssh2Error) => void): Ssh2Client
  on(event: 'tcp connection', listener: TcpConnectionListener): Ssh2Client
  removeListener(event: 'tcp connection', listener: TcpConnectionListener): Ssh2Client
  once(event: 'ready' | 'close' | 'end', listener: () => void): Ssh2Client
  once(event: 'error', listener: (err: Ssh2Error) => void): Ssh2Client
}

type Ssh2ClientCtor = new () => Ssh2Client

interface Ssh2Module {
  Client: Ssh2ClientCtor
}

// ─── Module loader (lazy, graceful fallback) ─────────────────────────────────

let modulePromise: Promise<Ssh2Module | null> | null = null

async function getSsh2(): Promise<Ssh2Module | null> {
  if (!modulePromise) {
    // String-join hides the specifier from tsc's static resolver — ssh2 is
    // resolved at runtime from the bundled node_modules (mirrors keychain.ts /
    // terminal/manager.ts). ssh2 is CommonJS, so accept either the interop
    // named export or the default (module.exports) shape.
    const modPath = ['ssh', '2'].join('')
    modulePromise = import(modPath)
      .then((mod) => {
        const shape = mod as unknown as {
          Client?: Ssh2ClientCtor
          default?: { Client?: Ssh2ClientCtor }
        }
        const Client = shape.Client ?? shape.default?.Client
        if (typeof Client !== 'function') {
          log.warn('ssh: ssh2 loaded but Client constructor missing')
          return null
        }
        return { Client }
      })
      .catch((err: unknown) => {
        log.warn('ssh: ssh2 import failed — SSH disabled', {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      })
  }
  return modulePromise
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 20_000
// Reap HEADLESS connections (the agent's exec/SFTP pool — `record.stream` unset)
// with zero data activity for this long. An INTERACTIVE shell is exempt: it is a
// terminal tab the user owns, and reaping it killed shells that were merely left
// open — plus quiet long-running commands. Same rule as the PTY manager, which
// dropped its idle sweep entirely.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const IDLE_SWEEP_MS = 60 * 1000
// Default SSH keepalive for EVERY connection (interactive + headless agent). Ping
// every 15s and drop after 3 unanswered (~45s), so a connection survives NAT /
// server idle timeouts between tool calls (or during a quiet interactive shell) AND
// a dead one is detected fast instead of surfacing as a mid-turn tool error. A host
// may override via options.keepaliveIntervalMs, or set it to 0 to disable entirely.
const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000
const DEFAULT_KEEPALIVE_COUNT_MAX = 3
// ssh.exec bounds (F3): cap buffered output per stream and give a non-terminating
// command a wall-clock ceiling so a remote can't OOM or hang the RPC.
const EXEC_OUTPUT_CAP = 5_000_000
const EXEC_TIMEOUT_MS = 60_000

// Expand a leading "~" in a key path — no shell is invoked (mirrors
// terminal.create): glob/$VAR are intentionally NOT expanded.
function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

// ssh2 error messages carry no secret (only host/level/reason). Keep concise and
// drop the stack so nothing verbose reaches the UI.
export function sanitizeMessage(err: unknown): string {
  if (err instanceof Error) {
    const level = (err as Ssh2Error).level
    return level ? `${err.message} (${level})` : err.message
  }
  return String(err)
}

interface ResolvedAuth {
  password?: string
  privateKey?: string
  passphrase?: string
  agent?: string
}

// A live command capture on an interactive shell (SSH terminal co-pilot, ADR 0064).
// While set on a record, the connect() data handler routes every chunk through
// `feed`, which (a) accumulates for sentinel-marker detection, (b) returns the text
// to STILL show the user with the marker lines removed. runInShell installs one.
interface ShellCapture {
  feed(chunk: string): string
}

export interface SshConnectionRecord {
  connId: string
  hostId: string
  client: Ssh2Client
  jumpClient?: Ssh2Client
  // The VpnProfile this connection acquired via vpnManager.ensureUp (ADR 0065 P3).
  // Present ONLY when the host has a vpnId AND the ensureUp succeeded — teardown
  // release()s exactly this ref (so a connection that never acquired never releases).
  vpnId?: string
  // Interactive shell channel — present ONLY for a `connect()` (terminal) session.
  // A headless agent connection (connectHeadless, ADR 0064 P2) opens no shell:
  // exec + SFTP run on `client` directly, so `stream` is absent there.
  stream?: Ssh2Channel
  // Set while runInShell is driving this shell (co-pilot). At most one at a time.
  capture?: ShellCapture
  createdAt: number
  lastActivityAt: number
}

// ── PTY output cleanup (co-pilot capture) ────────────────────────────────────
// Strip ANSI CSI + OSC escapes and CRs so the captured command output is readable
// for the model. Heuristic — a PTY stream is full of cursor/color control codes.
// (Sidecar has no ESLint; control-char regex is intentional here.)
const ANSI_CSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OSC_RE = /\][^]*(?:|\\)/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_OSC_RE, '').replace(ANSI_CSI_RE, '').replace(/\r/g, '')
}

// Pull the command's output out of the raw PTY capture: cut at the sentinel marker
// (matched by its numeric exit code, so the ECHOED `printf …%d…` command — literal
// %d — is NOT mistaken for it), then drop the echoed input lines (the marker-cmd
// echo + the first line that echoes the command the user typed). Heuristic; good
// enough for discrete commands (interactive TUIs like vim never emit a marker → the
// caller times out).
function extractShellOutput(raw: string, command: string, nonce: string): string {
  const clean = stripAnsi(raw)
  const marker = new RegExp('__AWOG_END_' + nonce + '_(-?\\d+)__')
  const m = marker.exec(clean)
  const body = m ? clean.slice(0, m.index) : clean
  const sig = '__AWOG_END_' + nonce
  const cmdTrim = command.trim()
  const out: string[] = []
  let droppedCmd = false
  for (const line of body.split('\n')) {
    if (line.includes(sig)) continue // echoed printf-marker command line
    if (!droppedCmd && cmdTrim && line.trimEnd().endsWith(cmdTrim)) {
      droppedCmd = true // echoed input line (PTY echoes what we typed)
      continue
    }
    out.push(line)
  }
  return out.join('\n').trim()
}

// Factory for the ssh2 hostVerifier of one hop. The interactive path uses the
// parking verifier (prompt the UI on unknown/changed); the headless agent path
// (ADR 0064 P2) supplies a fail-closed one (accept only an exact match).
type MakeHostVerifier = (connId: string, host: SshHostConfig) => HostVerifier

export interface SshConnectionRef {
  connId: string
  hostId: string
}

class SshManager {
  private connections = new Map<string, SshConnectionRecord>()

  private idCounter = 0

  private sweepTimer: ReturnType<typeof setInterval> | null = null

  // Subsystems (SFTP session cache, active port-forwards) subscribe here so they
  // can release per-connId resources when a connection tears down. Hooks must
  // not throw — a hook failure never blocks connection teardown.
  private teardownHooks = new Set<(connId: string) => void>()

  private genId(): string {
    return `ssh-${Date.now().toString(36)}-${(this.idCounter += 1).toString(36)}`
  }

  // Public accessor for the live ssh2 client behind a connId (used by the SFTP +
  // port-forward subsystems). Returns undefined when the connection is unknown /
  // already torn down — callers throw 'Unknown connection'.
  getRecord(connId: string): SshConnectionRecord | undefined {
    return this.connections.get(connId)
  }

  onTeardown(fn: (connId: string) => void): void {
    this.teardownHooks.add(fn)
  }

  private fireTeardown(connId: string): void {
    for (const fn of this.teardownHooks) {
      try {
        fn(connId)
      } catch (err) {
        log.warn('ssh: teardown hook failed', { err: sanitizeMessage(err) })
      }
    }
  }

  private async getSsh2OrThrow(): Promise<Ssh2Module> {
    const mod = await getSsh2()
    if (!mod) throw new Error('SSH unavailable: ssh2 not installed')
    return mod
  }

  // Resolve secret auth material from the keychain / key file. The returned
  // object never leaves the sidecar (folded into the ssh2 connect config only).
  private async resolveAuth(host: SshHostConfig): Promise<ResolvedAuth> {
    if (host.authMethod === 'password') {
      const cred = await loadSshCredential('host', host.id)
      if (!cred || cred.type !== 'password') {
        throw new Error('No password stored for this host')
      }
      return { password: cred.password }
    }

    if (host.authMethod === 'key') {
      if (!host.identityId) throw new Error('Host uses key auth but has no identity')
      const identity = await loadIdentity(host.identityId)
      if (!identity) throw new Error(`Identity not found: ${host.identityId}`)

      if (identity.inlineStored) {
        const cred = await loadSshCredential('identity', identity.id)
        if (!cred || cred.type !== 'inline-key') {
          throw new Error('No inline key stored for this identity')
        }
        return {
          privateKey: cred.privateKey,
          ...(cred.passphrase ? { passphrase: cred.passphrase } : {}),
        }
      }

      if (!identity.keyPath) throw new Error('Identity has neither inline key nor keyPath')
      const privateKey = await readFile(expandHome(identity.keyPath), 'utf8')
      const cred = await loadSshCredential('identity', identity.id)
      const passphrase = cred?.type === 'passphrase' ? cred.passphrase : undefined
      return { privateKey, ...(passphrase ? { passphrase } : {}) }
    }

    // agent — pass SSH_AUTH_SOCK if present; ssh2 fails clearly if no agent.
    return process.env.SSH_AUTH_SOCK ? { agent: process.env.SSH_AUTH_SOCK } : {}
  }

  // hostVerifier bound to a connId: computes the fingerprint, checks known_hosts,
  // and either accepts, parks a prompt, or (opt-in) auto-accepts with a warning.
  // Returns undefined synchronously so ssh2 waits for the async decision.
  private makeHostVerifier(connId: string, host: SshHostConfig): HostVerifier {
    return (keyBlob, verify) => {
      void this.decideHostKey(connId, host, keyBlob, verify)
    }
  }

  private async decideHostKey(
    connId: string,
    host: SshHostConfig,
    keyBlob: Buffer,
    verify: (valid: boolean) => void,
  ): Promise<void> {
    try {
      const keyType = keyTypeFromBlob(keyBlob)
      const keyBase64 = keyBlob.toString('base64')
      const fingerprint = sha256Fingerprint(keyBlob)
      const status = await verifyHostKey(host.host, host.port, keyType, keyBase64)
      if (status === 'match') {
        verify(true)
        return
      }
      // Explicit opt-out only — never auto-accept by default.
      if (host.options?.strictHostKey === false) {
        log.warn('ssh: host key auto-accepted (strictHostKey=false)', {
          host: host.host,
          port: host.port,
          status,
        })
        verify(true)
        return
      }
      parkHostKey(connId, { verify, host: host.host, port: host.port, keyType, keyBase64 })
      emit('ssh:host-key-prompt', {
        connId,
        host: host.host,
        port: host.port,
        keyType,
        fingerprint,
        status,
      })
    } catch (err) {
      log.error('ssh: host key verification failed', { err: sanitizeMessage(err) })
      verify(false) // fail closed
    }
  }

  // Fail-closed host-key verifier for a HEADLESS (agent) connection (ADR 0064 P2):
  // accept ONLY an exact known_hosts match; NEVER park a prompt (there is no
  // interactive UI on the tool path). On a non-match / verify error it records a
  // user-facing reason (surfaced by connectHeadless) and rejects the handshake —
  // an unknown/changed key is NEVER auto-accepted here (invariant, no strictHostKey
  // opt-out either: the agent path must be trusted out-of-band via the SSH tab).
  private makeStrictHostVerifier(
    host: SshHostConfig,
    onReject: (reason: string) => void,
  ): HostVerifier {
    return (keyBlob, verify) => {
      void (async () => {
        try {
          const keyType = keyTypeFromBlob(keyBlob)
          const keyBase64 = keyBlob.toString('base64')
          const status = await verifyHostKey(host.host, host.port, keyType, keyBase64)
          if (status === 'match') {
            verify(true)
            return
          }
          onReject(
            status === 'changed'
              ? `Host key for ${host.host}:${host.port} has CHANGED since it was trusted (possible man-in-the-middle). Open this host in the SSH tab to review and re-trust its key before the agent can connect.`
              : `Host key for ${host.host}:${host.port} is not trusted yet. Open this host once in the SSH tab and accept its key, then retry.`,
          )
          verify(false)
        } catch (err) {
          onReject(`Host key verification failed for ${host.host}:${host.port}: ${sanitizeMessage(err)}`)
          verify(false)
        }
      })()
    }
  }

  // Open one ssh2 Client and resolve when authenticated (`ready`). `sock` carries
  // the jump-host tunnel for the target hop. `makeVerifier` overrides the host-key
  // verifier per hop (headless path passes a fail-closed one); default = parking.
  private async establishClient(
    ssh2: Ssh2Module,
    host: SshHostConfig,
    connId: string,
    sock?: Ssh2Channel,
    makeVerifier?: MakeHostVerifier,
  ): Promise<Ssh2Client> {
    const auth = await this.resolveAuth(host)
    const client = new ssh2.Client()
    const buildVerifier = makeVerifier ?? ((c, h) => this.makeHostVerifier(c, h))
    const config: Ssh2ConnectConfig = {
      host: host.host,
      port: host.port,
      username: host.user,
      readyTimeout: CONNECT_TIMEOUT_MS,
      hostVerifier: buildVerifier(connId, host),
      ...(auth.password ? { password: auth.password } : {}),
      ...(auth.privateKey ? { privateKey: auth.privateKey } : {}),
      ...(auth.passphrase ? { passphrase: auth.passphrase } : {}),
      ...(auth.agent ? { agent: auth.agent } : {}),
      ...(sock ? { sock } : {}),
      // Keepalive ON by default (see DEFAULT_KEEPALIVE_*). `?? default` keeps a host
      // override, and lets an explicit 0 disable it (0 is not nullish).
      keepaliveInterval: host.options?.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: DEFAULT_KEEPALIVE_COUNT_MAX,
      ...(host.options?.compression
        ? { algorithms: { compress: ['zlib@openssh.com', 'zlib', 'none'] } }
        : {}),
    }
    return new Promise<Ssh2Client>((resolvePromise, reject) => {
      let settled = false
      client.once('ready', () => {
        if (settled) return
        settled = true
        resolvePromise(client)
      })
      client.once('error', (err) => {
        if (settled) return
        settled = true
        reject(new Error(sanitizeMessage(err)))
      })
      client.connect(config)
    })
  }

  // Establish the (optionally jump-hosted) target client. v1: at most one jump
  // hop — any jumpHostId on the bastion itself is ignored (cycle guard).
  private async establishChain(
    ssh2: Ssh2Module,
    host: SshHostConfig,
    connId: string,
    makeVerifier?: MakeHostVerifier,
  ): Promise<{ client: Ssh2Client; jumpClient?: Ssh2Client }> {
    if (!host.jumpHostId) {
      const client = await this.establishClient(ssh2, host, connId, undefined, makeVerifier)
      return { client }
    }
    if (host.jumpHostId === host.id) throw new Error('Jump host cannot reference itself')
    const jump = await loadHost(host.jumpHostId)
    if (!jump) throw new Error(`Jump host not found: ${host.jumpHostId}`)

    const jumpClient = await this.establishClient(ssh2, jump, connId, undefined, makeVerifier)
    let sock: Ssh2Channel
    try {
      sock = await new Promise<Ssh2Channel>((resolvePromise, reject) => {
        jumpClient.forwardOut('127.0.0.1', 0, host.host, host.port, (err, stream) => {
          if (err) {
            reject(new Error(sanitizeMessage(err)))
            return
          }
          resolvePromise(stream)
        })
      })
    } catch (err) {
      try {
        jumpClient.end()
      } catch {
        // already down
      }
      throw err
    }

    try {
      const client = await this.establishClient(ssh2, host, connId, sock, makeVerifier)
      return { client, jumpClient }
    } catch (err) {
      try {
        jumpClient.end()
      } catch {
        // already down
      }
      throw err
    }
  }

  private openShell(client: Ssh2Client, cols: number, rows: number): Promise<Ssh2Channel> {
    return new Promise<Ssh2Channel>((resolvePromise, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          reject(new Error(sanitizeMessage(err)))
          return
        }
        resolvePromise(stream)
      })
    })
  }

  // Bring up the host's VPN (ref-counted, shared across hosts) BEFORE ssh2 dials so
  // OS routing is already in place — one admin prompt for the first host, none for
  // the rest (ADR 0065 P3). Returns the vpnId that was acquired (to release on
  // teardown), or undefined when the host has no VPN. Throws a clear error on
  // bring-up failure so the connect fails WITHOUT leaking a ref (ensureUp never
  // increments on its failure paths).
  private async acquireVpn(host: SshHostConfig): Promise<string | undefined> {
    const vpnId = host.vpnId
    if (!vpnId) return undefined
    try {
      await vpnManager.ensureUp(vpnId)
      return vpnId
    } catch (err) {
      throw new Error(`VPN "${vpnId}" could not be brought up: ${sanitizeMessage(err)}`)
    }
  }

  async connect(params: {
    hostId: string
    cols: number
    rows: number
  }): Promise<{ connId: string }> {
    const ssh2 = await this.getSsh2OrThrow()
    const host = await loadHost(params.hostId)
    if (!host) throw new Error(`SSH host not found: ${params.hostId}`)

    const connId = this.genId()
    let jumpClient: Ssh2Client | undefined
    // Set once acquireVpn succeeds; cleared once the record owns the ref. On any
    // failure BEFORE the record exists we release it here so it can't leak.
    let acquiredVpnId: string | undefined
    try {
      acquiredVpnId = await this.acquireVpn(host)
      const chain = await this.establishChain(ssh2, host, connId)
      jumpClient = chain.jumpClient
      const stream = await this.openShell(chain.client, params.cols, params.rows)

      const now = Date.now()
      const record: SshConnectionRecord = {
        connId,
        hostId: host.id,
        client: chain.client,
        stream,
        createdAt: now,
        lastActivityAt: now,
        ...(chain.jumpClient ? { jumpClient: chain.jumpClient } : {}),
        ...(acquiredVpnId ? { vpnId: acquiredVpnId } : {}),
      }
      this.connections.set(connId, record)
      acquiredVpnId = undefined // ownership transferred to the record (teardown releases)

      stream.on('data', (chunk) => {
        record.lastActivityAt = Date.now()
        const s = chunk.toString('utf8')
        // While a co-pilot command is capturing, route through feed() — it detects
        // the sentinel marker AND returns the text with marker lines removed so the
        // user still sees their command + output live but not the marker noise.
        const emitStr = record.capture ? record.capture.feed(s) : s
        if (emitStr) emit('ssh:data', { connId, chunk: emitStr })
      })
      stream.on('close', () => {
        emit('ssh:exit', { connId })
        this.teardown(connId)
      })
      chain.client.on('error', (err) => {
        this.emitStatus(connId, host.id, 'error', sanitizeMessage(err))
      })
      chain.client.on('close', () => {
        this.emitStatus(connId, host.id, 'disconnected')
        this.teardown(connId)
      })

      this.emitStatus(connId, host.id, 'connected')
      void this.persistStatus(host.id, 'connected')
      this.ensureSweep()
      return { connId }
    } catch (err) {
      // Release the VPN ref if we acquired one but never handed it to a record.
      if (acquiredVpnId) vpnManager.release(acquiredVpnId)
      try {
        jumpClient?.end()
      } catch {
        // already down
      }
      dropHostKey(connId)
      const message = sanitizeMessage(err)
      this.emitStatus(connId, host.id, 'error', message)
      void this.persistStatus(host.id, 'error', message)
      throw new Error(message)
    }
  }

  // Headless connect for the agent SSH tools (ADR 0064 P2). Same auth chain as
  // connect() but NO interactive shell + NO `ssh:data` stream — exec/SFTP run on
  // the client directly. Registered in the same `connections` map so getRecord /
  // exec / SFTP + the idle sweep + teardown all work uniformly. Host-key is
  // FAIL-CLOSED: only an exact known_hosts match connects; an unknown/changed key
  // rejects with a message telling the user to trust the host in the SSH tab first
  // (no park — there is no interactive UI on the tool path). Returns the connId.
  async connectHeadless(hostId: string): Promise<string> {
    const ssh2 = await this.getSsh2OrThrow()
    const host = await loadHost(hostId)
    if (!host) throw new Error(`SSH host not found: ${hostId}`)

    const connId = this.genId()
    // The strict verifier records a user-facing reason here; ssh2 then rejects the
    // handshake with its own generic error, so we surface THIS reason instead.
    let hostKeyError: string | undefined
    const makeVerifier: MakeHostVerifier = (_connId, h) =>
      this.makeStrictHostVerifier(h, (reason) => {
        hostKeyError = reason
      })

    let jumpClient: Ssh2Client | undefined
    let acquiredVpnId: string | undefined
    try {
      acquiredVpnId = await this.acquireVpn(host)
      const chain = await this.establishChain(ssh2, host, connId, makeVerifier)
      jumpClient = chain.jumpClient

      const now = Date.now()
      const record: SshConnectionRecord = {
        connId,
        hostId: host.id,
        client: chain.client,
        createdAt: now,
        lastActivityAt: now,
        ...(chain.jumpClient ? { jumpClient: chain.jumpClient } : {}),
        ...(acquiredVpnId ? { vpnId: acquiredVpnId } : {}),
      }
      this.connections.set(connId, record)
      acquiredVpnId = undefined // ownership transferred to the record (teardown releases)

      chain.client.on('error', (err) => {
        this.emitStatus(connId, host.id, 'error', sanitizeMessage(err))
      })
      chain.client.on('close', () => {
        this.emitStatus(connId, host.id, 'disconnected')
        this.teardown(connId)
      })

      this.emitStatus(connId, host.id, 'connected')
      void this.persistStatus(host.id, 'connected')
      this.ensureSweep()
      return connId
    } catch (err) {
      if (acquiredVpnId) vpnManager.release(acquiredVpnId)
      try {
        jumpClient?.end()
      } catch {
        // already down
      }
      dropHostKey(connId)
      // Prefer the fail-closed host-key reason over ssh2's opaque handshake error.
      const message = hostKeyError ?? sanitizeMessage(err)
      this.emitStatus(connId, host.id, 'error', message)
      void this.persistStatus(host.id, 'error', message)
      throw new Error(message)
    }
  }

  write(connId: string, data: string): void {
    const record = this.connections.get(connId)
    if (!record) throw new Error('Unknown connection')
    // A headless (agent) connection has no shell channel — reject a shell write.
    if (!record.stream) throw new Error('Connection has no interactive shell')
    record.lastActivityAt = Date.now()
    record.stream.write(data)
  }

  resize(connId: string, cols: number, rows: number): void {
    const record = this.connections.get(connId)
    if (!record) throw new Error('Unknown connection')
    if (!record.stream) throw new Error('Connection has no interactive shell')
    // ssh2 Channel.setWindow(rows, cols, heightPx, widthPx) — px hints unused.
    record.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(connId: string): void {
    // teardown ends the client → its 'close' handler emits status 'disconnected'.
    this.teardown(connId)
  }

  list(): SshConnectionRef[] {
    return [...this.connections.values()].map((r) => ({ connId: r.connId, hostId: r.hostId }))
  }

  // First live connId for a host (any kind — interactive or headless). Used by the
  // agent SSH tools to reuse an already-open connection before opening a new one:
  // exec + SFTP run on their own channels, so a shared connection is fine.
  getConnIdForHost(hostId: string): string | undefined {
    for (const record of this.connections.values()) {
      if (record.hostId === hostId) return record.connId
    }
    return undefined
  }

  async confirmHostKey(connId: string, accept: boolean, remember: boolean): Promise<void> {
    const resolved = await resolveHostKey(connId, accept, remember)
    if (!resolved) throw new Error('No pending host-key prompt for this connection')
  }

  async exec(
    connId: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const record = this.connections.get(connId)
    if (!record) throw new Error('Unknown connection')
    record.lastActivityAt = Date.now()
    return new Promise<{ stdout: string; stderr: string; code: number }>((resolvePromise, reject) => {
      record.client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(sanitizeMessage(err)))
          return
        }
        // Bound both accumulation (per-stream hard cap) and wall-clock: a remote
        // command emitting unbounded output (`cat /dev/zero`) or never exiting
        // (`tail -f`) must not OOM or hang the RPC forever. Trickle output resets
        // lastActivityAt so the idle sweep can't reap it — the timeout does.
        let stdout = ''
        let stderr = ''
        let settled = false
        const cap = (cur: string, add: string): string => {
          if (cur.length >= EXEC_OUTPUT_CAP) return cur
          const next = cur + add
          return next.length > EXEC_OUTPUT_CAP ? next.slice(0, EXEC_OUTPUT_CAP) : next
        }
        const finish = (code: number): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try {
            stream.end()
          } catch {
            // already closed
          }
          resolvePromise({ stdout, stderr, code })
        }
        const timer = setTimeout(() => finish(0), EXEC_TIMEOUT_MS)
        timer.unref?.()
        stream.on('data', (chunk) => {
          record.lastActivityAt = Date.now()
          stdout = cap(stdout, chunk.toString('utf8'))
        })
        stream.stderr.on('data', (chunk) => {
          stderr = cap(stderr, chunk.toString('utf8'))
        })
        stream.on('close', (code) => finish(typeof code === 'number' ? code : 0))
      })
    })
  }

  // Run a command IN the interactive shell the user is watching (SSH terminal
  // co-pilot, ADR 0064). Unlike exec() (a hidden separate channel), this WRITES the
  // command into the PTY so it runs LIVE in the user's terminal, then appends a
  // sentinel `printf` that echoes `$?` inside a unique marker. A capture taps the
  // same data stream (see connect()'s handler) to detect the marker → resolve with
  // the command's output + exit code, while stripping the marker lines from what the
  // user sees. One capture per shell; interactive TUIs (vim/top) never emit a marker
  // → the 60s timeout returns what was captured with exitCode -1.
  async runInShell(connId: string, command: string): Promise<{ output: string; exitCode: number }> {
    const record = this.connections.get(connId)
    if (!record) throw new Error('Unknown connection')
    const stream = record.stream
    if (!stream) throw new Error('Connection has no interactive shell')
    if (record.capture) throw new Error('A command is already running in this shell')

    const nonce = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    const markerRe = new RegExp('__AWOG_END_' + nonce + '_(-?\\d+)__')
    const markerSig = '__AWOG_END_' + nonce // matches the echoed printf line too
    record.lastActivityAt = Date.now()

    return new Promise<{ output: string; exitCode: number }>((resolvePromise) => {
      let buf = '' // full capture (capped) for marker detection + extraction
      let pending = '' // UI line-buffer so we never emit half a marker line
      let settled = false
      const finish = (exitCode: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        delete record.capture
        resolvePromise({ output: extractShellOutput(buf, command, nonce), exitCode })
      }
      const timer = setTimeout(() => finish(-1), EXEC_TIMEOUT_MS)
      timer.unref?.()

      record.capture = {
        feed(chunk: string): string {
          if (buf.length < EXEC_OUTPUT_CAP) buf += chunk
          const m = markerRe.exec(buf)
          // Emit filter: drop only whole marker-related lines (the echoed printf +
          // the marker output); KEEP the command echo + output + prompt so the user
          // watches it live. Hold an incomplete trailing line until its newline.
          pending += chunk
          let emitOut = ''
          let nl: number
          while ((nl = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, nl + 1)
            pending = pending.slice(nl + 1)
            if (!line.includes(markerSig)) emitOut += line
          }
          if (m) {
            // Command done → flush the trailing prompt tail and resolve.
            if (!pending.includes(markerSig)) emitOut += pending
            pending = ''
            finish(Number.parseInt(m[1], 10))
          }
          return emitOut
        },
      }

      // Run the command, then print the sentinel with its exit code. Two writes so
      // the command's own output lands before the marker.
      stream.write(command + '\n')
      stream.write("printf '\\n__AWOG_END_" + nonce + "_%d__\\n' \"$?\"\n")
    })
  }

  // Auth-only probe: connect, then immediately tear down. Host-key verification
  // still applies (a test can prompt via ssh:host-key-prompt on the same connId).
  async test(params: {
    hostId: string
  }): Promise<{ status: 'connected' | 'error'; error?: string }> {
    const host = await loadHost(params.hostId)
    if (!host) return { status: 'error', error: `SSH host not found: ${params.hostId}` }
    const ssh2 = await getSsh2()
    if (!ssh2) return { status: 'error', error: 'SSH unavailable: ssh2 not installed' }

    const connId = this.genId()
    let jumpClient: Ssh2Client | undefined
    try {
      const chain = await this.establishChain(ssh2, host, connId)
      jumpClient = chain.jumpClient
      try {
        chain.client.end()
      } catch {
        // already down
      }
      try {
        jumpClient?.end()
      } catch {
        // already down
      }
      void this.persistStatus(host.id, 'connected')
      return { status: 'connected' }
    } catch (err) {
      try {
        jumpClient?.end()
      } catch {
        // already down
      }
      dropHostKey(connId)
      const error = sanitizeMessage(err)
      void this.persistStatus(host.id, 'error', error)
      return { status: 'error', error }
    }
  }

  private emitStatus(
    connId: string,
    hostId: string,
    status: SshConnectionStatus,
    error?: string,
  ): void {
    emit('ssh:status-changed', { connId, hostId, status, ...(error ? { error } : {}) })
  }

  // Best-effort: persist last-known status onto the host config so the card shows
  // something on reload. Never throws (a persist failure must not break connect).
  private async persistStatus(
    hostId: string,
    status: SshConnectionStatus,
    error?: string,
  ): Promise<void> {
    try {
      const host = await loadHost(hostId)
      if (!host) return
      const now = new Date().toISOString()
      const updated: SshHostConfig = { ...host, connectionStatus: status, updatedAt: now }
      if (status === 'connected') {
        updated.lastConnectedAt = now
        delete updated.connectionError
      } else if (error) {
        updated.connectionError = error.slice(0, 2000)
      }
      await saveHost(updated)
    } catch (err) {
      log.warn('ssh: failed to persist connection status', { err: sanitizeMessage(err) })
    }
  }

  // Idempotent resource teardown (no emit). Ending the client triggers its
  // 'close' handler, which emits status + calls teardown again (no-op).
  private teardown(connId: string): void {
    const record = this.connections.get(connId)
    if (!record) return
    this.connections.delete(connId)
    // Drop this connection's VPN reference (ADR 0065 P3). release() never throws and
    // no-ops if the tunnel is already gone; when the last ref clears AND the profile
    // opted into autoDown, the VPN tears itself down.
    if (record.vpnId) vpnManager.release(record.vpnId)
    this.fireTeardown(connId)
    try {
      record.stream?.end()
    } catch {
      // already closed
    }
    try {
      record.client.end()
    } catch {
      // already closed
    }
    try {
      record.jumpClient?.end()
    } catch {
      // already closed
    }
  }

  private ensureSweep(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => {
      const now = Date.now()
      for (const record of this.connections.values()) {
        if (record.stream) continue // interactive shell — user-owned, never reaped
        if (now - record.lastActivityAt > IDLE_TIMEOUT_MS) this.teardown(record.connId)
      }
      if (this.connections.size === 0 && this.sweepTimer) {
        clearInterval(this.sweepTimer)
        this.sweepTimer = null
      }
    }, IDLE_SWEEP_MS)
    this.sweepTimer.unref?.()
  }

  shutdown(): void {
    for (const record of this.connections.values()) {
      if (record.vpnId) vpnManager.release(record.vpnId)
      this.fireTeardown(record.connId)
      try {
        record.stream?.end()
      } catch {
        // ignore
      }
      try {
        record.client.end()
      } catch {
        // ignore
      }
      try {
        record.jumpClient?.end()
      } catch {
        // ignore
      }
    }
    this.connections.clear()
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}

export const sshManager = new SshManager()

// Resolve a usable connId for a host (ADR 0064 P2): reuse a live connection if
// one exists, else open a fail-closed headless one. Used by the agent SSH tools.
export async function ensureConnId(hostId: string): Promise<string> {
  const existing = sshManager.getConnIdForHost(hostId)
  if (existing) return existing
  return sshManager.connectHeadless(hostId)
}

// Kill live SSH connections with the sidecar (mirrors terminalManager).
process.once('SIGTERM', () => sshManager.shutdown())
process.once('SIGINT', () => sshManager.shutdown())
