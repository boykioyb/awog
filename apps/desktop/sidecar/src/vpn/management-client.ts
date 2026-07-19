// OpenVPN management-interface client — VPN Manager P1 (design §3).
//
// A thin line-framer over a loopback net.Socket (TCP form, cross-platform). One
// instance per live tunnel. Two message classes share the socket:
//   - `>`-prefixed lines  = the ASYNC notification bus (STATE / PASSWORD / HOLD /
//                           LOG / FATAL) — routed to the on* handlers.
//   - everything else     = the FIFO reply to the last `command()` we sent,
//                           terminated by SUCCESS:/ERROR:/END.
//
// SECURITY: on connect openvpn prints `ENTER PASSWORD:` and we answer with the
// random per-run management password (invariant #6). VPN credentials pushed via
// pushUserPass / pushKeyPassphrase are q()-escaped (\ and ") and stripped of \r\n
// (management control-channel injection guard) and go ONLY into `username` /
// `password` commands — never a file, log, event, or RPC response (invariant #1).

import net from 'node:net'

// How long start() waits for the `ENTER PASSWORD:` prompt before proceeding anyway.
// openvpn prompts within milliseconds of connect; the grace only guards a build that
// somehow never prompts, so it never leaves the connect hung.
const PASSWORD_HANDSHAKE_GRACE_MS = 2_000

// Quote + escape a management command argument: wrap in double quotes, escape a
// literal backslash then a literal double-quote (order matters).
function q(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// Strip CR/LF from a credential value before it enters a management command —
// a newline would let a malicious credential inject a second control-channel
// command.
function stripNewlines(v: string): string {
  return v.replace(/[\r\n]/g, '')
}

interface PendingCommand {
  lines: string[]
  resolve: (lines: string[]) => void
}

export class ManagementClient {
  private sock: net.Socket | null = null

  private buf = ''

  private mgmtPassword = ''

  private pending: PendingCommand[] = []

  // The mgmt socket answers `ENTER PASSWORD:` with the socket password as the FIRST
  // line — openvpn reads whatever we write first AS the password. start() must not send
  // any command until that handshake is done, or `state on` gets read as a bad password
  // and openvpn closes the socket (the connect then hangs to timeout). These gate it.
  private passwordSent = false

  private passwordWaiters: (() => void)[] = []

  // Wired by VpnManager BEFORE start() so no async event is missed.
  onState?: (fields: string[]) => void // fields[1] is the state name (CONNECTED / EXITING / …)

  onAuthNeeded?: (kind: 'Auth' | 'Private Key') => void

  // STATIC challenge — the .ovpn has `static-challenge`, so openvpn asks for the OTP
  // together with the password up front (`Need 'Auth' ... SC:<echo>,<prompt>`). The
  // reply is a single SCRV1-encoded password (see pushUserPassWithOtp). `echo` = show
  // the code as typed.
  onStaticChallenge?: (prompt: string, echo: boolean) => void

  // DYNAMIC challenge (CRV1) — the SERVER rejected the first auth with a challenge
  // (`Verification Failed: 'Auth' ['CRV1:<flags>:<state>:<user>:<prompt>']`). The reply
  // is a CRV1-encoded password carrying the opaque `state` (see pushChallengeResponse).
  onDynamicChallenge?: (state: string, prompt: string, echo: boolean) => void

  onAuthFailed?: (reason: string) => void

  onLog?: (line: string) => void // L1-untrusted — sanitize before surfacing

  onFatal?: (reason: string) => void

  onClose?: () => void

  // Connect to the loopback management port and resolve once the TCP socket is up
  // (NOT once authenticated — the `ENTER PASSWORD:` handshake happens on the data
  // stream via handleLine). The socket-password is stored for that handshake.
  connect(port: number, mgmtPassword: string): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      const sock = net.connect(port, '127.0.0.1')
      sock.setEncoding('utf8')
      const onError = (err: Error): void => reject(err)
      sock.once('error', onError)
      sock.once('connect', () => {
        sock.removeListener('error', onError)
        this.sock = sock
        this.mgmtPassword = mgmtPassword
        sock.on('data', (d: string) => this.frame(d))
        sock.on('error', () => {
          // Post-connect errors surface as a close (onClose) — swallow here so an
          // unhandled 'error' can't crash the sidecar.
        })
        sock.on('close', () => this.onClose?.())
        resolvePromise()
      })
    })
  }

  private frame(chunk: string): void {
    this.buf += chunk
    // The `ENTER PASSWORD:` prompt is sent WITHOUT a trailing newline (it waits for input
    // on the same line), so it never becomes a complete line below. Detect + answer it on
    // the raw buffer, exactly once — otherwise the password is never sent and the first
    // command we write gets read AS the password, failing auth and dropping the socket.
    if (!this.passwordSent && this.buf.includes('ENTER PASSWORD:')) {
      this.buf = this.buf.replace('ENTER PASSWORD:', '')
      this.write(this.mgmtPassword)
      this.markPasswordSent()
    }
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '') // some builds emit CRLF
      this.buf = this.buf.slice(i + 1)
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    if (line.startsWith('ENTER PASSWORD:')) {
      // Socket auth must be answered before any command reply is meaningful. openvpn
      // reads this FIRST line as the password — release start()'s commands only now.
      this.write(this.mgmtPassword)
      this.markPasswordSent()
      return
    }
    if (line.startsWith('>')) {
      this.notify(line)
      return
    }
    // Command reply (FIFO). Terminated by SUCCESS:/ERROR:/END.
    const done = /^(SUCCESS:|ERROR:|END$)/.test(line)
    const head = this.pending[0]
    if (head) {
      head.lines.push(line)
      if (done) {
        this.pending.shift()
        head.resolve(head.lines)
      }
      return
    }
    // No pending command owns this reply. Surface an unsolicited ERROR (e.g. a bad
    // management password) so a failed handshake shows in the log instead of a bare
    // "connection closed".
    if (line.startsWith('ERROR:')) this.onLog?.(line)
  }

  private notify(line: string): void {
    const m = /^>([A-Z-]+):(.*)$/.exec(line)
    if (!m) return
    const tag = m[1]
    const rest = m[2]
    switch (tag) {
      case 'STATE': {
        // fields[1] = state name (CONNECTED / EXITING / RECONNECTING / …). Fire on
        // EVERY state so the manager can detect readiness AND clean shutdown.
        this.onState?.(rest.split(','))
        break
      }
      case 'PASSWORD': {
        if (/^Need 'Auth'/.test(rest)) {
          // `SC:<echo>,<prompt>` suffix ⇒ static challenge (OTP wanted with the
          // password). Otherwise a plain user/pass query.
          const sc = /\bSC:([01]),([\s\S]*)$/.exec(rest)
          if (sc) this.onStaticChallenge?.(sc[2] ?? '', sc[1] === '1')
          else this.onAuthNeeded?.('Auth')
        } else if (/^Need 'Private Key'/.test(rest)) {
          this.onAuthNeeded?.('Private Key')
        } else if (/^Verification Failed/.test(rest)) {
          // A server-initiated dynamic challenge rides on the auth-failure line as
          // `['CRV1:<flags>:<state>:<user_b64>:<prompt>']`. Extract state + prompt; a
          // failure WITHOUT a CRV1 payload is a real auth reject.
          const crv = /\['CRV1:([^:]*):([^:]*):([^:]*):([\s\S]*)'\]\s*$/.exec(rest)
          if (crv) this.onDynamicChallenge?.(crv[2] ?? '', crv[4] ?? '', (crv[1] ?? '').includes('E'))
          else this.onAuthFailed?.(rest)
        }
        break
      }
      case 'HOLD': {
        // openvpn is held (from --management-hold) — release it so it connects.
        this.write('hold release')
        break
      }
      case 'LOG': {
        this.onLog?.(rest)
        break
      }
      case 'FATAL': {
        this.onFatal?.(rest)
        break
      }
      default:
        break // INFO / BYTECOUNT / INFOMSG / … — ignored in P1
    }
  }

  // Low-level line write. Throws if called before connect() resolves.
  private write(cmd: string): void {
    if (!this.sock) throw new Error('management socket not connected')
    this.sock.write(`${cmd}\n`)
  }

  // Send a command and resolve with its reply lines (FIFO-ordered vs the async
  // bus). Available for callers that need a confirmed reply; the P1 happy path is
  // driven off the async bus so most control is fire-and-forget.
  command(cmd: string): Promise<string[]> {
    return new Promise<string[]>((resolvePromise) => {
      this.pending.push({ lines: [], resolve: resolvePromise })
      this.write(cmd)
    })
  }

  // Resolve once the mgmt-socket password has been sent (openvpn prompts `ENTER
  // PASSWORD:` right after connect). Falls back after a grace so a build that never
  // prompts can't hang the connect.
  private waitForPasswordSent(timeoutMs: number): Promise<void> {
    if (this.passwordSent) return Promise.resolve()
    return new Promise<void>((resolvePromise) => {
      const t = setTimeout(resolvePromise, timeoutMs)
      t.unref?.()
      this.passwordWaiters.push(() => {
        clearTimeout(t)
        resolvePromise()
      })
    })
  }

  private markPasswordSent(): void {
    this.passwordSent = true
    const waiters = this.passwordWaiters
    this.passwordWaiters = []
    for (const w of waiters) w()
  }

  // Subscribe to real-time state + log, THEN release the hold (order matters —
  // releasing first could miss the credential query per design §3.3). `log on all`
  // streams openvpn's log (+ backlog) as `>LOG:` events over the SOCKET — reliable
  // regardless of the root-owned --log file's perms — so the viewer shows what
  // "connecting…" is doing. ALL fire-and-forget after the password handshake: awaiting
  // a command reply here can hang forever if openvpn closes the socket (state/log/hold
  // status ride the async `>` bus anyway), and sending before the password is answered
  // makes openvpn read `state on` as a bad password and drop the socket.
  async start(): Promise<void> {
    await this.waitForPasswordSent(PASSWORD_HANDSHAKE_GRACE_MS)
    this.write('state on')
    this.write('log on all')
    this.write('hold release')
  }

  // Reconnect-and-reap: connect() must have run first. Wait for the mgmt password
  // handshake (proving this really IS an openvpn), then SIGTERM it. Used to kill a root
  // openvpn whose ORIGINAL mgmt client already disconnected — openvpn keeps the port
  // LISTENING, so this needs no admin prompt and can't hit the wrong pid. If no `ENTER
  // PASSWORD:` prompt arrives within the grace, it is NOT openvpn → leave it alone.
  async reap(graceMs: number): Promise<void> {
    await this.waitForPasswordSent(graceMs)
    if (!this.passwordSent) return
    this.terminate()
  }

  // The ONLY clean stop a non-root sidecar has over a root openvpn: ask it to
  // signal itself. The socket close that follows drives onClose → cleanup.
  stop(): void {
    // Best-effort — the socket may already be gone.
    try {
      this.write('signal SIGTERM')
    } catch {
      // already closed
    }
  }

  // Off-disk credential push (invariant #1). Values are \r\n-stripped + q()-escaped.
  pushUserPass(user: string, pass: string): void {
    this.write(`username "Auth" ${q(stripNewlines(user))}`)
    this.write(`password "Auth" ${q(stripNewlines(pass))}`)
  }

  pushKeyPassphrase(passphrase: string): void {
    this.write(`password "Private Key" ${q(stripNewlines(passphrase))}`)
  }

  // STATIC-challenge reply (invariant #1 — off-disk). The password field encodes BOTH
  // the password and the OTP as `SCRV1:base64(pass):base64(otp)`; base64 sidesteps any
  // char issue, and q() still quotes it for the control channel.
  pushUserPassWithOtp(user: string, pass: string, otp: string): void {
    const b64 = (s: string): string => Buffer.from(stripNewlines(s), 'utf8').toString('base64')
    this.write(`username "Auth" ${q(stripNewlines(user))}`)
    this.write(`password "Auth" ${q(`SCRV1:${b64(pass)}:${b64(otp)}`)}`)
  }

  // DYNAMIC-challenge (CRV1) reply. The password field is `CRV1::<state>::<otp>` where
  // `state` is the opaque token openvpn handed us in the challenge. Username is the
  // ORIGINAL username (openvpn re-queries Auth after the server's challenge).
  pushChallengeResponse(user: string, state: string, otp: string): void {
    this.write(`username "Auth" ${q(stripNewlines(user))}`)
    this.write(`password "Auth" ${q(`CRV1::${stripNewlines(state)}::${stripNewlines(otp)}`)}`)
  }

  // Tear down the socket + listeners (idempotent). Called by manager cleanup.
  destroy(): void {
    const sock = this.sock
    if (!sock) return
    this.sock = null
    try {
      sock.removeAllListeners()
      sock.destroy()
    } catch {
      // already destroyed
    }
  }

  // SIGTERM the (root) openvpn AND release the socket, flush-safe. Unlike stop()+
  // destroy(), sock.end(data) writes the SIGTERM command THEN half-closes gracefully,
  // so the command is flushed before the socket goes away — a plain destroy() right
  // after a write can drop it. Used by manager cleanup on FAIL/timeout: without it the
  // root openvpn keeps running as a zombie, holding a utun interface + routes that
  // break every other VPN client (the "Error calling protect() method on socket").
  terminate(): void {
    const sock = this.sock
    if (!sock) return
    this.sock = null
    try {
      sock.removeAllListeners()
      sock.end('signal SIGTERM\n')
    } catch {
      try {
        sock.destroy()
      } catch {
        // already gone
      }
    }
  }
}
