// SSH port-forwarding over a live SSH connection (ADR 0063 P4). Forwards run
// OVER an existing connId — the host must already be connected (v1 coupling:
// closing the SSH connection closes all its forwards). Active forwards are
// tracked in a sidecar-side Map keyed by a generated forwardId.
//
//   local   — a local net.Server; each inbound socket is tunnelled via the ssh2
//             client's forwardOut to destHost:destPort.
//   dynamic — a local SOCKS5 proxy (CONNECT, no-auth). EXPERIMENTAL: implemented
//             but not yet verified against a live server (see startDynamic).
//   remote  — client.forwardIn asks the server to listen; matching inbound
//             connections (`tcp connection` events) are piped to a local socket.
//
// SECURITY (invariant 6): bindHost defaults to 127.0.0.1 for local/dynamic —
// never 0.0.0.0. A caller wanting a public bind must set bindHost explicitly.

import { connect, createServer, type Server, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { emit } from '../transport/stdio.js'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import {
  sanitizeMessage,
  sshManager,
  type Ssh2Channel,
  type Ssh2Client,
  type TcpConnectionListener,
} from './manager.js'
import type { PortForward } from './schema.js'

const DEFAULT_BIND_HOST = '127.0.0.1'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

type LocalForward = Extract<PortForward, { type: 'local' }>
type RemoteForward = Extract<PortForward, { type: 'remote' }>
type DynamicForward = Extract<PortForward, { type: 'dynamic' }>

interface ActiveForward {
  forwardId: string
  connId: string
  forward: PortForward
  status: 'active' | 'error'
  error?: string
  // local/dynamic hold a Node server; remote holds the bound port + its listener.
  server?: Server
  boundPort?: number
  listener?: TcpConnectionListener
}

const forwards = new Map<string, ActiveForward>()

let forwardSeq = 0
function genForwardId(): string {
  return `fwd-${Date.now().toString(36)}-${(forwardSeq += 1).toString(36)}`
}

// Close all forwards belonging to a connection when it tears down. The ssh2
// client is already gone, so we only close local servers (no unforwardIn).
sshManager.onTeardown((connId) => {
  let changed = false
  for (const fwd of [...forwards.values()]) {
    if (fwd.connId !== connId) continue
    forwards.delete(fwd.forwardId)
    closeResources(fwd)
    changed = true
  }
  if (changed) emit('ssh:forward-changed', { connId })
})

// ─── Bridging ────────────────────────────────────────────────────────────────

// ssh2 channels are Node Duplex streams at runtime; the sidecar's minimal
// Ssh2Channel typing (manager.ts) models only the shell/exec surface, so we
// assert the Duplex shape at this single pipe boundary to keep backpressure.
function bridge(socket: Socket, channel: Ssh2Channel, initial?: Buffer): void {
  const duplex = channel as unknown as Duplex
  if (initial && initial.length > 0) duplex.write(initial)
  socket.pipe(duplex)
  duplex.pipe(socket)
  const destroy = (): void => {
    socket.destroy()
    duplex.destroy()
  }
  socket.on('error', destroy)
  duplex.on('error', destroy)
}

// ─── Listen helpers ──────────────────────────────────────────────────────────

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening)
      reject(new RpcError(-32000, sanitizeMessage(err)))
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolvePromise()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function markError(fwd: ActiveForward, err: unknown): void {
  fwd.status = 'error'
  fwd.error = sanitizeMessage(err)
  log.warn('ssh: port-forward error', { forwardId: fwd.forwardId, err: fwd.error })
  emit('ssh:forward-changed', { connId: fwd.connId })
}

function closeResources(fwd: ActiveForward): void {
  if (fwd.server) {
    try {
      fwd.server.close()
    } catch {
      // already closed
    }
    delete fwd.server
  }
}

// ─── local ───────────────────────────────────────────────────────────────────

async function startLocal(fwd: ActiveForward, client: Ssh2Client, f: LocalForward): Promise<void> {
  const bindHost = f.bindHost ?? DEFAULT_BIND_HOST
  const server = createServer((socket) => {
    socket.on('error', () => socket.destroy())
    client.forwardOut(
      socket.remoteAddress || DEFAULT_BIND_HOST,
      socket.remotePort || 0,
      f.destHost,
      f.destPort,
      (err, stream) => {
        if (err) {
          socket.destroy()
          return
        }
        bridge(socket, stream)
      },
    )
  })
  fwd.server = server
  await listen(server, f.bindPort, bindHost)
  server.on('error', (err) => markError(fwd, err))
}

// ─── dynamic (SOCKS5 CONNECT, no-auth) ───────────────────────────────────────

// SOCKS5 reply: VER, REP, RSV, ATYP=IPv4, BND.ADDR=0.0.0.0, BND.PORT=0.
function replySocks(socket: Socket, rep: number): void {
  socket.write(Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
}

// Minimal SOCKS5 CONNECT handler with partial-read buffering. Only the no-auth
// method + the CONNECT command are supported (BIND/UDP-ASSOCIATE are rejected).
function handleSocks5(socket: Socket, client: Ssh2Client): void {
  let stage: 'greeting' | 'request' | 'piping' = 'greeting'
  let buf = Buffer.alloc(0)

  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk])

    if (stage === 'greeting') {
      if (buf.length < 2) return
      if (buf[0] !== 0x05) {
        socket.destroy()
        return
      }
      const nmethods = buf[1]
      if (buf.length < 2 + nmethods) return
      const hasNoAuth = buf.subarray(2, 2 + nmethods).includes(0x00)
      buf = buf.subarray(2 + nmethods)
      if (!hasNoAuth) {
        socket.write(Buffer.from([0x05, 0xff]))
        socket.destroy()
        return
      }
      socket.write(Buffer.from([0x05, 0x00]))
      stage = 'request'
      // fall through: the request may be in the same chunk
    }

    if (stage === 'request') {
      if (buf.length < 4) return
      if (buf[0] !== 0x05) {
        socket.destroy()
        return
      }
      const cmd = buf[1]
      const atyp = buf[3]
      let host: string
      let addrEnd: number
      if (atyp === 0x01) {
        if (buf.length < 4 + 4 + 2) return
        host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`
        addrEnd = 4 + 4
      } else if (atyp === 0x03) {
        if (buf.length < 5) return
        const len = buf[4]
        if (buf.length < 5 + len + 2) return
        host = buf.subarray(5, 5 + len).toString('utf8')
        addrEnd = 5 + len
      } else if (atyp === 0x04) {
        if (buf.length < 4 + 16 + 2) return
        const parts: string[] = []
        for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16))
        host = parts.join(':')
        addrEnd = 4 + 16
      } else {
        replySocks(socket, 0x08) // address type not supported
        socket.destroy()
        return
      }
      const port = buf.readUInt16BE(addrEnd)
      if (cmd !== 0x01) {
        replySocks(socket, 0x07) // command not supported
        socket.destroy()
        return
      }
      stage = 'piping'
      socket.removeListener('data', onData)
      const leftover = buf.subarray(addrEnd + 2)
      client.forwardOut(
        socket.remoteAddress || DEFAULT_BIND_HOST,
        socket.remotePort || 0,
        host,
        port,
        (err, stream) => {
          if (err) {
            replySocks(socket, 0x05) // connection refused
            socket.destroy()
            return
          }
          replySocks(socket, 0x00) // succeeded
          bridge(socket, stream, leftover)
        },
      )
    }
  }

  socket.on('data', onData)
  socket.on('error', () => socket.destroy())
}

async function startDynamic(
  fwd: ActiveForward,
  client: Ssh2Client,
  f: DynamicForward,
): Promise<void> {
  const bindHost = f.bindHost ?? DEFAULT_BIND_HOST
  log.warn('ssh: SOCKS5 dynamic forward is experimental (not yet verified live)')
  const server = createServer((socket) => {
    socket.on('error', () => socket.destroy())
    handleSocks5(socket, client)
  })
  fwd.server = server
  await listen(server, f.bindPort, bindHost)
  server.on('error', (err) => markError(fwd, err))
}

// ─── remote ────────────────────────────────────────────────────────────────

async function startRemote(
  fwd: ActiveForward,
  client: Ssh2Client,
  f: RemoteForward,
): Promise<void> {
  const bindHost = f.bindHost ?? DEFAULT_BIND_HOST
  const boundPort = await new Promise<number>((resolvePromise, reject) => {
    client.forwardIn(bindHost, f.bindPort, (err, port) =>
      err ? reject(new RpcError(-32000, sanitizeMessage(err))) : resolvePromise(port),
    )
  })
  fwd.boundPort = boundPort

  // Multiple remote forwards share one client, so each listener handles only the
  // connections arriving on its bound port and ignores the rest.
  const listener: TcpConnectionListener = (details, accept, rejectConnection) => {
    if (details.destPort !== boundPort) return
    const local = connect(f.destPort, f.destHost)
    let accepted = false
    local.once('connect', () => {
      accepted = true
      bridge(local, accept())
    })
    local.once('error', () => {
      if (!accepted) rejectConnection()
      local.destroy()
    })
  }
  client.on('tcp connection', listener)
  fwd.listener = listener
}

// ─── Public API (called by ssh.forward.* method files) ───────────────────────

export async function startForward(
  connId: string,
  forward: PortForward,
): Promise<{ forwardId: string }> {
  const record = sshManager.getRecord(connId)
  if (!record) throw new RpcError(-32602, 'Unknown connection')

  // Invariant 6 hardening (F6): a local/dynamic forward opens a listener on THIS
  // machine — refuse a non-loopback bind so a crafted/saved config can't turn it
  // into a LAN-reachable open proxy/pivot. (remote binds on the SSH server side.)
  if (
    (forward.type === 'local' || forward.type === 'dynamic') &&
    forward.bindHost &&
    !LOOPBACK_HOSTS.has(forward.bindHost)
  ) {
    throw new RpcError(-32602, 'non-loopback bindHost is not allowed for local/dynamic forwards')
  }

  const forwardId = genForwardId()
  const fwd: ActiveForward = { forwardId, connId, forward, status: 'active' }
  try {
    if (forward.type === 'local') {
      await startLocal(fwd, record.client, forward)
    } else if (forward.type === 'dynamic') {
      await startDynamic(fwd, record.client, forward)
    } else {
      await startRemote(fwd, record.client, forward)
    }
  } catch (err) {
    closeResources(fwd)
    throw err instanceof RpcError ? err : new RpcError(-32000, sanitizeMessage(err))
  }

  forwards.set(forwardId, fwd)
  emit('ssh:forward-changed', { connId })
  return { forwardId }
}

export function stopForward(forwardId: string): { ok: true } {
  const fwd = forwards.get(forwardId)
  if (!fwd) throw new RpcError(-32602, 'Unknown forward')
  forwards.delete(forwardId)

  // Cancel the server-side listen for remote forwards while the client is alive.
  if (fwd.forward.type === 'remote' && fwd.listener && fwd.boundPort !== undefined) {
    const record = sshManager.getRecord(fwd.connId)
    if (record) {
      const bindHost = fwd.forward.bindHost ?? DEFAULT_BIND_HOST
      try {
        record.client.removeListener('tcp connection', fwd.listener)
        record.client.unforwardIn(bindHost, fwd.boundPort, () => {})
      } catch (err) {
        log.warn('ssh: unforwardIn failed', { err: sanitizeMessage(err) })
      }
    }
  }

  closeResources(fwd)
  emit('ssh:forward-changed', { connId: fwd.connId })
  return { ok: true }
}

export function listForwards(connId?: string): {
  forwards: Array<{
    forwardId: string
    connId: string
    forward: PortForward
    status: 'active' | 'error'
    error?: string
  }>
} {
  return {
    forwards: [...forwards.values()]
      .filter((f) => connId === undefined || f.connId === connId)
      .map((f) => ({
        forwardId: f.forwardId,
        connId: f.connId,
        forward: f.forward,
        status: f.status,
        ...(f.error !== undefined ? { error: f.error } : {}),
      })),
  }
}
