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

  // Wired by VpnManager BEFORE start() so no async event is missed.
  onState?: (fields: string[]) => void // fields[1] is the state name (CONNECTED / EXITING / …)

  onAuthNeeded?: (kind: 'Auth' | 'Private Key') => void

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
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '') // some builds emit CRLF
      this.buf = this.buf.slice(i + 1)
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    if (line.startsWith('ENTER PASSWORD:')) {
      // Socket auth must be answered before any command reply is meaningful.
      this.write(this.mgmtPassword)
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
    }
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
        if (/^Need 'Auth'/.test(rest)) this.onAuthNeeded?.('Auth')
        else if (/^Need 'Private Key'/.test(rest)) this.onAuthNeeded?.('Private Key')
        else if (/^Verification Failed/.test(rest)) this.onAuthFailed?.(rest)
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

  // Subscribe to real-time state THEN release the hold (order matters — releasing
  // first could miss the credential query per design §3.3).
  async start(): Promise<void> {
    await this.command('state on')
    this.write('hold release')
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
}
