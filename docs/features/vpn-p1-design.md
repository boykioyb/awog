# VPN Manager — Phase 1 Implementation Design Note

**Scope:** P1 from [docs/features/vpn-manager.md](../features/vpn-manager.md) §Phân pha — the runtime that spawns `openvpn`, elevates once per bring-up, controls it over the OpenVPN management interface, and exposes `vpn.up` / `vpn.down` / `vpn.status` + `vpn:status-changed`. Builds on the P0 scaffolding already in `apps/desktop/sidecar/src/vpn/` (`schema.ts`, `store.ts`, `credentials.ts`) and mirrors `apps/desktop/sidecar/src/ssh/manager.ts`.

Out of scope for P1 (do **not** build here): keepalive/auto-restart (P2), `SshHost.vpnId` + ref-count + `ensureUp`-before-`ssh.connect` (P3), `.ovpn` import UI (P4). The `refCount` field and `ensureUp()` method are stubbed so P3 slots in without a rewrite.

---

## 0. Cross-cutting decisions (read first)

| Question | P1 decision | Runner-up (why not now) |
|---|---|---|
| Control channel | **Management interface over TCP `127.0.0.1:<randomPort>` + random per-run password file**, one `ManagementClient` for all 3 OSes. | Linux unix-socket + `--management-client-user` (SO_PEERCRED, no pw file) — materially better on Linux; deferred to P2 hardening to keep **one** client code path (KISS). Flagged in Open Questions. |
| macOS elevate | **`osascript … do shell script "…" with administrator privileges`** with the TN2065 `& echo $!` background idiom (returns openvpn's pid). | `sudo-prompt` lib wraps the same thing; hand-rolled spawn keeps the arg-array/allowlist invariants explicit. |
| Linux elevate | **`pkexec openvpn …`** (polkit GUI agent → works from a windowless Electron/AppImage). | `sudo` has no GUI path without an askpass helper. |
| Windows elevate | **`powershell Start-Process -Verb RunAs`** — one UAC per bring-up. | OpenVPN **Interactive Service** (named pipe) achieves *zero* UAC but needs a one-time "OpenVPN Administrators" group-add + a UTF-16LE pipe protocol → **P2**. See §2.3. |
| Off-disk creds | VPN username/password/passphrase pushed live via `--management-query-passwords`; never a file, log, event, or RPC response. | — |

**Model:** *one admin prompt per VPN bring-up*, identical on all three OSes. A VPN that is `up` stays up and (in P3) serves N SSH hosts with **no** further prompt. Windows cannot do "prompt once at *setup*, silent forever" in P1 — that requires the Interactive Service (P2). Per-*bring-up* UAC on Windows is exactly the same UX contract as macOS/Linux, so P1 ships RunAs.

---

## 1. `VpnManager` runtime (`vpn/manager.ts`)

Structural sibling of `SshManager`: a singleton holding a `Map`, sidecar-side control, graceful binary fallback, and a SIGTERM/SIGINT shutdown. Difference from SSH: the controlled process is **root and detached** — we never own its stdio and cannot `kill(2)` it; all liveness/stop go through the management socket + pidfile.

### 1.1 Per-profile state machine

```
        vpn.up                connect + hold release + creds       CONNECTED
 down ──────────► connecting ──────────────────────────────────────► up
   ▲   │                │                                             │
   │   │ prompt cancel  │ auth-failed / >FATAL / spawn error /        │ vpn.down
   │   │ / bad config   │ mgmt unreachable / connect timeout          │ (SIGTERM)
   │   ▼                ▼                                             ▼
   └── error ◄──────────┴──── socket close / >STATE:…,EXITING ───► down
```

- `connecting` is entered synchronously by `up()`; every terminal transition emits `vpn:status-changed` and best-effort persists `status`/`statusError`/`lastUpAt` onto the profile JSON (like `SshManager.persistStatus`).
- `error` is a **latched** state surfaced to UI; the next `vpn.up` clears it. No auto-retry loop in P1 (auth failure especially — see §3 gotcha).

### 1.2 Record + map

```ts
type VpnRuntimeStatus = 'down' | 'connecting' | 'up' | 'error'

interface VpnRuntimeRecord {
  id: string
  status: VpnRuntimeStatus
  mgmtPort: number
  mgmt?: ManagementClient        // live only while connecting/up
  pid?: number                   // real openvpn pid (macOS: echo $!; else pidfile)
  pwFile: string                 // ~/.awog/vpn-run/<id>/mgmt.pw  (0600, unlinked after CONNECTED)
  pidFile: string                // ~/.awog/vpn-run/<id>/openvpn.pid
  refCount: number               // P3 — always 0 in P1
  startedAt: number
  upAt?: number
  lastError?: string
  keepalive: boolean             // profile flag, consumed in P2
  // park() plumbing for up(): resolve on CONNECTED, reject on terminal failure
  ready?: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
}

class VpnManager {
  private runtimes = new Map<string, VpnRuntimeRecord>()   // key = vpnId (one process per profile)
}
```

### 1.3 Public methods

```ts
up(id: string): Promise<{ status: VpnRuntimeStatus }>
down(id: string): Promise<void>
status(id?: string): { states: VpnRuntimeState[] }        // sync snapshot from the map
isUp(id: string): boolean
ensureUp(id: string): Promise<void>                        // P1 stub → up(); P3 adds ref-count + park sharing
shutdown(): void                                           // SIGTERM/SIGINT: SIGTERM every live tunnel via mgmt
```

`VpnRuntimeState` (the wire shape for `vpn.status` and the event): `{ id, status, pid?, upAt?, refCount, error? }` — **never** ports, pw-file paths, or secrets.

### 1.4 `up()` control flow (the core)

1. **Guard idempotency.** If a record exists and is `up`/`connecting`, return its status (no second prompt).
2. **Load + validate** the profile (`loadProfile`), the openvpn binary (`resolveOpenvpnBinary()` — throw `"OpenVPN unavailable"` + install hint if missing, CRUD stays alive per ADR §1), and the `.ovpn` (`validateOvpnConfig()` — §5). Resolve creds from keychain into memory (`loadVpnCredential`).
3. **Allocate runtime files.** `mkdir ~/.awog/vpn-run/<id>` mode `0700`; pick a free port (`bindTestFreePort()`); write `mgmt.pw` = `crypto.randomBytes(24).toString('base64url')` atomically (tmp→`chmod 0600`→rename).
4. **Set `connecting`**, create the record, install the `ready` park promise with a wall-clock timeout (`CONNECT_TIMEOUT_MS = 60_000`).
5. **Build argv** (`buildOpenvpnArgv()` — §3) and **spawn elevated** via the OS adapter: `const { pid } = await adapter.spawnElevated(binary, argv)`. A prompt cancel rejects here → set `error`/`down`, cleanup, throw. Capture `pid` if the adapter returns one (macOS); else read it from `pidFile` after CONNECTED.
6. **Attach management** (`ManagementClient.connect(port, pw)` with ECONNREFUSED retry/backoff ≤5 s — openvpn may not be listening the instant osascript returns). On connect: authenticate socket → `state on` → `hold release`; register `onState`/`onPassword`/`onLog`/`onClose` handlers.
7. **Push creds** on each `>PASSWORD:Need …` prompt from the in-memory secret (never disk). `>PASSWORD:Verification Failed` → reject `ready` with a sanitized auth error, transition `error`, **do not loop**.
8. **Resolve on readiness:** first `>STATE:…,CONNECTED,…` line → `unlink(pwFile)`, record `upAt`, backfill `pid` from `pidFile`, `resolve(ready)`, emit `up`. Return `{ status: 'up' }`.
9. **Failure paths** (socket close, `>FATAL:`, timeout): reject `ready`, transition `error` (or `down` on clean EXITING), cleanup.

### 1.5 `down()` and cleanup

- `down()`: if no live record → no-op. Else `mgmt.stop()` (sends `signal SIGTERM` over the socket — the **only** way a non-root sidecar stops a root process). Wait for `>STATE:…,EXITING` + socket close, with a grace window; then `cleanup()`.
- `cleanup(id)`: destroy mgmt socket, unlink `pwFile`/`pidFile`, `runtimes.delete(id)`, emit `down`. Idempotent (mirrors `SshManager.teardown`).
- **Fallback stop** (mgmt socket unreachable but pid known): the *only* clean kill is a second admin prompt — `adapter.killElevated(pid)` (optional adapter method). P1 surfaces this as an `error` state with a message rather than silently orphaning; wire the second prompt behind a UI "Force stop" in P2. Do **not** attempt `process.kill(pid)` from the sidecar — it throws `EPERM`.

### 1.6 Liveness without owning the pid

Primary signal = the management socket (`>STATE:` stream + socket `close`). Belt-and-suspenders health poll: `process.kill(pid, 0)` — on macOS/Linux a non-root probe of a root pid throws **`EPERM` = alive**, `ESRCH` = gone (do not misread EPERM as death). On Windows use the pidfile + a `tasklist`/`Get-Process` check (Node's `kill(pid,0)` semantics differ). Keepalive/auto-restart that consumes this is **P2** — P1 only reports.

---

## 2. `ElevationAdapter` contract + 3 implementations

One interface; the adapter's sole job is to **launch `binary argv…` as root and return once the prompt is answered** (not when connected — readiness is `ManagementClient`'s job). It never controls or stops the tunnel.

```ts
// vpn/elevation/adapter.ts
export class ElevationCancelled extends Error {}          // user dismissed the prompt

export interface ElevationAdapter {
  readonly platform: NodeJS.Platform
  // Resolves after the elevation prompt is ANSWERED and openvpn is spawned.
  // `pid` is the REAL openvpn pid when the OS lets us capture it (macOS), else
  // undefined → read it from the --writepid file after CONNECTED.
  spawnElevated(binary: string, argv: string[]): Promise<{ pid?: number }>
  // Optional: stop a root pid via a SECOND admin prompt (mgmt-unreachable fallback).
  killElevated?(pid: number): Promise<void>
}

export function selectAdapter(): ElevationAdapter {
  switch (process.platform) {
    case 'darwin': return macosAdapter
    case 'linux':  return linuxAdapter
    case 'win32':  return windowsAdapter
    default: throw new Error(`VPN elevation unsupported on ${process.platform}`)
  }
}
```

**Invariant for all three:** spawn the *elevation wrapper* (`osascript`/`pkexec`/`powershell.exe`) with an **arg array**, never a shell string at the Node boundary. Only macOS has an unavoidable inner shell string (the AppleScript), which is a dedicated injection surface (§5).

### 2.1 macOS (`vpn/elevation/macos.ts`) — **recommended, no helper**

Spawn `osascript` as an arg array; the AppleScript runs the command as root via Authorization Services (SecurityAgent dialog). Use the TN2065 `& echo $!` idiom so `do shell script` returns immediately with openvpn's pid. **Never** add `--daemon` (double-fork → `$!` is the pre-fork pid).

```ts
// argv already validated + built by buildOpenvpnArgv(); shellCmd = single-quoted join
const shellCmd =
  `${q(binary)} ${argv.map(q).join(' ')} >/dev/null 2>&1 & echo $!`   // q() = shell single-quote+escape
const appleScript = `do shell script ${asStr(shellCmd)} with administrator privileges`
const child = spawn('osascript', ['-e', appleScript])                 // arg-array at Node boundary
// stdout of osascript = the openvpn pid; non-zero exit / userCanceledErr(-128) → ElevationCancelled
```

- **Keeps control:** after osascript returns we have only pid + the management socket — no stdout/stdin. All monitoring is the management socket; `--writepid`/`--log` are recovery aids.
- **Stops:** `mgmt.write('signal SIGTERM')`. `killElevated(pid)` = a second `do shell script "kill <pid>" with administrator privileges`.
- **Auth cache:** identical script re-runs within ~5 min don't re-prompt; a retry with a new port/pw-file path is a *different* script and re-prompts (fine).
- **Packaging rule (hard):** Hardened Runtime + notarization, **App Sandbox OFF** — the sandbox silently suppresses the admin dialog. Not Mac App Store.
- **Device:** `--dev utun` (built-in; no kext). Reject TAP profiles.

### 2.2 Linux (`vpn/elevation/linux.ts`) — **recommended: `pkexec`, not `sudo`**

```ts
const child = spawn('pkexec', [binary, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
// exit 126 = dialog dismissed → ElevationCancelled ; 127 = denied/error ; else = openvpn's own exit
```

- **Why pkexec:** routes through the session polkit agent → GUI password dialog from a windowless app. The default `org.freedesktop.policykit.exec` action is `auth_admin` = prompt every invocation = "one prompt per bring-up". **No custom `.policy` file** in P1 (a `.policy` is a persistent privileged component → forbidden until P2).
- **Gotcha:** pkexec sanitizes env (drops `LD_*`, `DISPLAY`, `XAUTHORITY`) and runs in **root's home**, not cwd. Relative `ca/cert/key` in the `.ovpn` break → always pass absolute `--config` **plus `--cd <ovpn-dir>`** (both already in the argv builder).
- **Keeps control:** pkexec keeps the child attached (we *could* read stdout), but drive everything via the management interface for parity. Real openvpn pid ≠ Node's `child.pid` (that's pkexec's) → read `--writepid`.
- **Stops:** `mgmt signal SIGTERM`. Never `pkexec kill` in the normal path.
- **Failure mode:** no polkit agent running (bare WM / headless) → pkexec falls back to a TTY text agent and *fails*. Detect (exit with no dialog) and surface "enable a polkit authentication agent".
- **Device:** built-in tun (`--dev tun` maps to a kernel tun). `--script-security 1`.

### 2.3 Windows (`vpn/elevation/windows.ts`) — **RunAs; cannot do "silent forever" without the service**

**Honest constraint:** Windows has no sudo-style credential cache. The only way to get *zero* UAC is the pre-installed OpenVPN **Interactive Service** (named pipe `\\.\pipe\openvpn\service`) — which additionally needs the user in the local **"OpenVPN Administrators"** group because AWOG's `.ovpn` lives outside `config_dir`, plus a UTF-16LE pipe protocol. That is **P2**.

**P1 = `Start-Process -Verb RunAs`** (one UAC per `vpn.up`, i.e. per bring-up — the same contract as mac/Linux). `child_process.spawn('openvpn.exe')` directly fails with `ERROR_ELEVATION_REQUIRED` (errno 740); there is no spawn flag for UAC, so shell out to PowerShell:

```ts
const psArgs = argv.map(a => `'${a.replace(/'/g, "''")}'`).join(',')   // PS single-quote escape
const cmd = `Start-Process -FilePath '${binary.replace(/'/g, "''")}' -Verb RunAs -ArgumentList @(${psArgs})`
const child = spawn('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd])
// user declines UAC → powershell exits non-zero → ElevationCancelled
```

- **Keeps control:** the elevated child detaches (different token) → Node gets no stdio/handle, and `-PassThru .Id` / `-Wait` are unreliable across the elevation boundary. Track lifecycle off the **management socket + `--writepid`**, never the Node child object.
- **Stops:** `mgmt signal SIGTERM` (you cannot `taskkill` an elevated process from user space).
- **Device:** `--windows-driver wintun`. If neither wintun nor tap-windows6 is installed → fail with an "install OpenVPN" hint (AWOG must not bundle/install drivers).
- **Call-out for the ADR/spec:** document that Windows P1 prompts UAC on every bring-up; "prompt-once-at-setup, silent" is the P2 Interactive-Service upgrade (uses the *dependency's* service — AWOG installs nothing).

---

## 3. `ManagementClient` (`vpn/management-client.ts`)

A thin line-framer over `net.Socket`. Cross-platform (TCP form). One instance per live tunnel.

### 3.1 openvpn launch flags (`buildOpenvpnArgv`)

```
--config   <ABS.ovpn>                 # validated: absolute, exists, readable, .ovpn, directive-vetted
--cd       <dir(ABS.ovpn)>            # so relative ca/cert/key resolve under pkexec/RunAs
--management 127.0.0.1 <PORT> <PWFILE>
--management-hold                     # hibernate until we connect + `hold release` (closes the cred-before-client race)
--management-query-passwords          # push user/pass/passphrase over the socket, never a file
--auth-nocache                        # don't cache creds (re-prompts on TLS reneg — we keep answering)
--auth-retry interact                 # treat auth-abort as terminal, not a fork/exit (community ticket #131)
--script-security 1                   # deny .ovpn up/down/route scripts (root RCE guard)
--writepid  <PIDFILE>                 # recover real pid (mac echo $! is primary; this is the fallback)
--log       <LOGFILE>                 # optional; sanitized before UI (--verb ≤ 3)
--verb 3
# + platform: macOS `--dev utun` | Windows `--windows-driver wintun` | Linux (built-in tun)
# NEVER --daemon (breaks macOS `& echo $!` pid capture)
```

### 3.2 Client skeleton

```ts
import net from 'node:net'

export class ManagementClient {
  private sock!: net.Socket
  private buf = ''
  private pending: Array<{ lines: string[]; resolve: (l: string[]) => void }> = []
  // handlers wired by VpnManager:
  onState?: (fields: string[]) => void      // fields[1] === 'CONNECTED' => ready
  onAuthNeeded?: (kind: 'Auth' | 'Private Key') => void
  onAuthFailed?: (reason: string) => void
  onLog?: (line: string) => void            // sanitize before surfacing
  onFatal?: (reason: string) => void
  onClose?: () => void

  connect(port: number, mgmtPassword: string): Promise<void> {
    return new Promise((res, rej) => {
      this.sock = net.connect(port, '127.0.0.1')
      this.sock.setEncoding('utf8')
      this.sock.once('error', rej)
      this.sock.on('connect', () => { this.mgmtPassword = mgmtPassword; res() })
      this.sock.on('data', d => this.frame(d))
      this.sock.on('close', () => this.onClose?.())
    })
  }

  private frame(d: string) {
    this.buf += d
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '')   // some builds emit CRLF
      this.buf = this.buf.slice(i + 1)
      this.handleLine(line)
    }
  }

  private handleLine(line: string) {
    if (line.startsWith('ENTER PASSWORD:')) return this.send(this.mgmtPassword)  // socket auth first
    if (line.startsWith('>')) return this.notify(line)                           // async bus
    const done = /^(SUCCESS:|ERROR:|END$)/.test(line)                            // command reply (FIFO)
    if (this.pending[0]) { this.pending[0].lines.push(line); if (done) this.pending.shift()!.resolve(this.pending) }
  }

  private notify(line: string) {
    const m = line.match(/^>([A-Z-]+):(.*)$/); if (!m) return
    const [, tag, rest] = m
    if (tag === 'STATE') { const f = rest.split(','); if (f[1] === 'CONNECTED') this.onState?.(f) }
    else if (tag === 'PASSWORD') {
      if (/^Need 'Auth'/.test(rest)) this.onAuthNeeded?.('Auth')
      else if (/^Need 'Private Key'/.test(rest)) this.onAuthNeeded?.('Private Key')
      else if (/^Verification Failed/.test(rest)) this.onAuthFailed?.(rest)
    }
    else if (tag === 'HOLD') this.send('hold release')
    else if (tag === 'LOG') this.onLog?.(rest)
    else if (tag === 'FATAL') this.onFatal?.(rest)
  }

  send(cmd: string) { this.sock.write(cmd + '\n') }

  // Off-disk credential push. q() quotes + escapes \ and " (management-notes.txt).
  pushUserPass(user: string, pass: string) {
    this.send(`username "Auth" ${q(user.replace(/[\r\n]/g, ''))}`)   // strip newline: control-channel injection guard
    this.send(`password "Auth" ${q(pass)}`)
  }
  pushKeyPassphrase(p: string) { this.send(`password "Private Key" ${q(p)}`) }

  start() { this.send('state on'); this.send('hold release') }       // subscribe THEN release hold
  stop()  { this.send('signal SIGTERM') }                            // only clean stop from a non-root sidecar
}

function q(v: string) { return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' }
```

### 3.3 Handshake order (must not race)

connect → answer `ENTER PASSWORD:` with the mgmt pw → `state on` → `hold release` → answer `>PASSWORD:` prompts → wait `>STATE:…,CONNECTED,…`. Register handlers **before** `hold release` or you miss the credential query. Readiness = `fields[1] === 'CONNECTED'` (== "Initialization Sequence Completed": tun up + routes installed). Down signals: `>STATE:…,RECONNECTING`/`EXITING`, `>FATAL:`, or socket `close`. `--auth-nocache` means a mid-session TLS renegotiation re-emits `>PASSWORD:Need 'Auth'` — keep answering from the in-memory secret for the tunnel's life.

---

## 4. RPC surface (`methods/vpn.up.ts`, `vpn.down.ts`, `vpn.status.ts`)

Register in `index.ts` after line 107 (the P0 vpn imports), same pattern as `vpn.upsert`/`ssh.connect`. All three take `{ id }` validated by `VPN_ID_RE`.

| Method | Params | Result | Notes |
|---|---|---|---|
| `vpn.up` | `{ id }` | `{ status: VpnRuntimeStatus }` | **Parks** on the admin prompt + readiness (may take seconds). Throws `"OpenVPN unavailable"` (+hint) if binary missing; `-32602` if profile missing; rejects on prompt-cancel / auth-fail with a sanitized message. Idempotent if already up/connecting. |
| `vpn.down` | `{ id }` | `{ ok: true }` | `signal SIGTERM` + cleanup; no-op if already down. |
| `vpn.status` | `{ id? }` | `{ states: VpnRuntimeState[] }` | Sync snapshot; `id` filters to one. Includes persisted `status` for profiles with no live record. |

```ts
// methods/vpn.up.ts
const Params = z.object({ id: z.string().regex(VPN_ID_RE) })
register('vpn.up', async (raw) => {
  const { id } = Params.parse(raw)
  return vpnManager.up(id)                     // { status }
})
```

**Event `vpn:status-changed`** (via `emit()` from `transport/stdio`): `{ id, status, pid?, upAt?, error? }` — emitted on every terminal transition. Matches `ssh:status-changed`'s shape. **Never** carries ports/pw-file/secret.

**Event `vpn:log`** (P1 optional, sanitized): `{ id, line }` — strip before surfacing, rate-limit, `--verb ≤ 3`. Wire the sanitizer even if the UI ignores it in P1.

`vpn-profiles.fs-changed` already comes from the watcher (P0). `vpn.up`/`vpn.down` are **not** exposed as model tools (ADR §9).

---

## 5. Security checklist (mapped to AWOG's 8 invariants)

- **#1 Secrets never leave the sidecar.** VPN user/pass/passphrase resolve from keychain (`awog-vpn`, account `vpn/<id>`) into memory and are written only into `password/username` management commands — never a temp file, `--auth-user-pass`, `--log`, an emitted event, an RPC response, or a trace. `vpn.setCredential` returns `{ ok }` only. Escape `\`/`"` and strip `\r\n` from values (management control-channel injection). The mgmt **pw-file** is a distinct, short-lived socket secret: written `0600` in a `0700` dir, `unlink`'d right after CONNECTED. `>LOG:` / `>PASSWORD:Verification Failed:'<server-string>'` are L1-untrusted → sanitize before UI.
- **#2 Path sanitize.** `configPath` validated: absolute, `realpath`, exists, readable, matches `^/[A-Za-z0-9._/-]+\.ovpn$` (no spaces/quotes/backslash/newline). Runtime files via `sanitizeChild(id)` under `~/.awog/vpn-run/`.
- **#4 IPC boundary.** UI never imports `child_process`/`net`/`fs`; all VPN control is `vpn.*` RPC. (No change needed — enforced by putting everything in the sidecar.)
- **#6 No public port.** Management socket binds **`127.0.0.1` only** + a random per-run password + random high port. "Any local user who reaches an unauthenticated mgmt socket controls a root VPN process" — hence the pw-file is mandatory, not optional.
- **#8 No eval / no command injection.**
  - Spawn wrappers with **arg arrays**; the openvpn binary is **allowlisted by realpath** (`vpn/binary.ts`, §6) — never an operator/UI-supplied path.
  - The macOS AppleScript is the *one* shell-string surface: single-quote the binary + every arg in the `/bin/sh` layer **and** AppleScript-escape `"`/`\`. Treat it as a dedicated injection sink.
  - **`.ovpn` runs as root.** `validateOvpnConfig()` parses the file and **rejects** any of: `up`, `down`, `route-up`, `route-pre-down`, `ipchange`, `tls-verify`, `client-connect`, `client-disconnect`, `learn-address`, `auth-user-pass-verify`, `plugin`, `script-security` (> 1), and a `management*` directive (so the profile can't override our socket). Pass our own `--script-security 1` on the CLI. A hostile directive here is arbitrary **root** RCE.
- **#5 No telemetry / #7 No SSRF.** No new network egress from the sidecar — openvpn dials the VPN server per the profile; the sidecar only opens the loopback mgmt socket.

Full **infosec audit is mandatory before release** (ADR §Consequences): privileged spawn + OS route modification + VPN creds + control socket = the highest-risk surface in AWOG.

---

## 6. File-by-file implementation plan (P1)

New files under `apps/desktop/sidecar/src/vpn/` (kebab-case, `type` from zod where possible), plus 3 method files and 3 lines in `index.ts`. P0 `schema.ts`/`store.ts`/`credentials.ts` are reused unchanged.

| File | Contents |
|---|---|
| `vpn/binary.ts` | `resolveOpenvpnBinary(): Promise<string \| null>` — detect + **allowlist** by realpath (regular file + executable), lazy/memoized, graceful fallback (mirror `getPty`/`getSsh2`). Allowlist: macOS `/opt/homebrew/sbin`, `/usr/local/sbin`, `/opt/local/sbin`; Linux `/usr/sbin`, `/usr/bin`; Windows `C:\Program Files\OpenVPN\bin\openvpn.exe`, `…(x86)…`. `installHint()` per-OS. |
| `vpn/ovpn-config.ts` | `validateOvpnConfig(path): Promise<{ dir: string }>` — path sanitize + parse + directive denylist (§5 #8) + reject TAP (require tun/utun). Throws with a clear reason. |
| `vpn/launch.ts` | `buildOpenvpnArgv(profile, { port, pwFile, pidFile, logFile, ovpnDir }): string[]` — the §3.1 flags + per-platform device flag. `runtimePaths(id)`, `bindTestFreePort()`, `writePwFile()`. |
| `vpn/management-client.ts` | `ManagementClient` (§3) — framer, socket auth, FIFO, notification bus, cred push, `start()`/`stop()`, `q()`/sanitize. |
| `vpn/elevation/adapter.ts` | `ElevationAdapter` interface + `ElevationCancelled` + `selectAdapter()`. |
| `vpn/elevation/macos.ts` | `osascript` + `& echo $!` (§2.1). |
| `vpn/elevation/linux.ts` | `pkexec` + exit-code mapping + no-agent detection (§2.2). |
| `vpn/elevation/windows.ts` | `powershell Start-Process -Verb RunAs` (§2.3). |
| `vpn/manager.ts` | `VpnManager` singleton (§1) — map, `up`/`down`/`status`/`isUp`/`ensureUp`(stub)/`shutdown`, `emitStatus`, `persistStatus` (reuse `saveProfile`), `process.once('SIGTERM'/'SIGINT', …)`. Exports `vpnManager`. |
| `methods/vpn.up.ts` · `vpn.down.ts` · `vpn.status.ts` | Thin `register()` wrappers (§4). |
| `index.ts` | Add `import './methods/vpn.up.js'` / `vpn.down.js` / `vpn.status.js` after line 107. |

New runtime dir: `~/.awog/vpn-run/<id>/` (`0700`) holding `mgmt.pw` (`0600`, transient) + `openvpn.pid` + optional `openvpn.log`.

---

## 7. Open questions / risks

1. **Windows "silent forever" (highest).** P1 RunAs prompts UAC every bring-up. Achieving zero-UAC needs the OpenVPN **Interactive Service** named-pipe path (UTF-16LE `workingdir\0options\0stdin\0` message, PID reply parse) + a one-time "OpenVPN Administrators" group-add for configs outside `config_dir`. Decide in P2 whether to implement the pipe or copy the validated `.ovpn` into a `config_dir` subfolder. **Persistent privilege grant** (group membership survives reboot) needs infosec/consent sign-off.
2. **Sidecar-restart orphan adoption.** The elevated openvpn **outlives** a sidecar crash, and its mgmt pw-file was unlinked after CONNECTED. P1 decision: on restart, **mark `down`** and offer bring-up (ADR §Consequences) — we can't re-authenticate the surviving socket without the (deleted) pw. Options to evaluate: (a) keep the pw-file for the tunnel's life (small standing on-disk secret) to enable adoption via pidfile+socket; (b) accept "mark down + user re-ups" for P1. Recommend (b) for P1, revisit with keepalive in P2.
3. **Linux mgmt hardening.** Prefer `--management <sock> unix --management-client-user <user>` (SO_PEERCRED, *no* pw file) over TCP+pw. Deferred to keep one `ManagementClient`; revisit if a multi-user Linux threat model demands it.
4. **`.ovpn` directive denylist completeness.** The blocklist must stay ahead of new root-exec directives across OpenVPN versions. Consider an **allowlist** of known-safe directives instead of a denylist during infosec review.
5. **Mgmt port TOCTOU.** `bindTestFreePort()` → close → hand number to openvpn has a small race; another process could grab it. Mitigation: if openvpn never listens (mgmt `connect` keeps `ECONNREFUSED` and pid dies), surface a clear error and let the user retry (new port). Acceptable for P1.
6. **macOS packaging.** App Sandbox **must be off** or the admin dialog silently never appears. Add a build-config assertion/test so a future sandbox opt-in can't ship broken elevation.
7. **`--auth-nocache` re-prompt.** Long sessions re-emit `>PASSWORD:` on TLS renegotiation — `ManagementClient` must keep answering (already designed), but verify against a real server with short reneg intervals.
8. **Binary allowlist drift.** Homebrew path differs by arch and isn't on the sidecar `PATH`; Windows path should ideally come from the registry, not a hardcoded constant. P1 uses known absolute paths; note the maintenance cost.
9. **DNS / split-tunnel.** The community openvpn client doesn't apply pushed DNS (we intentionally run no up/down scripts). Only traffic to **pushed routes** goes through the tun. P3 SSH-over-VPN must target hosts by **IP** (or ensure the private hostname resolves without VPN-pushed DNS) — a profile/config concern, not code.