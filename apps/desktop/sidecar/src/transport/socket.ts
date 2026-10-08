// External-client transport: unix domain socket next to ~/.awog (named pipe on
// Windows), same NDJSON JSON-RPC codec as stdio. This is the second door into
// the engine (ADR 0093) — the `awog` CLI shim talks here so it doesn't have to
// spawn a parallel engine and race the app's writers on ~/.awog.
//
// Discovery: `~/.awog/engine.endpoint` (chmod 600) holds the socket path + a
// per-boot `engineToken`. The first frame on a connection must be
// `{method:'engine.hello', params:{token}}`; wrong/absent token → close. The
// token distinguishes a stale endpoint left by a crashed engine and stops
// same-UID scripts from casually driving RPC — it is NOT a defence against a
// same-UID attacker (Docker-socket trust model, see ADR 0093).
//
// Events: stdio's emit() fans out here through the sink registered below.
// Connections default to NO events; `events.subscribe {prefixes}` opts a
// connection into the types it renders (e.g. 'session.', 'task.'), keeping a
// shim from absorbing the app's whole event firehose.
//
// Host channel: socket clients never see `host-request` frames — those target
// the Electron main only (browser_*). A socket client's `host-response` line is
// ignored (it has no host to answer for).

import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'
import { isSocketMethodAllowed } from './socket-policy.js'

const SOCKET_NAME = 'engine.sock'
const ENDPOINT_NAME = 'engine.endpoint'
const ENDPOINT_VERSION = 1

interface EndpointFile {
  version: number
  socketPath: string
  token: string
  pid: number
}

interface Conn {
  socket: Socket
  authed: boolean
  eventPrefixes: string[] | null // null = no events (default)
  buffer: string
}

let server: Server | null = null
let conns = new Set<Conn>()
let engineToken: string | null = null
let socketPath: string | null = null
let shuttingDown = false

// Frame handler injected by index.ts so the socket shares the exact dispatch +
// error-mapping behaviour of stdio (incl. RpcError/-32603 translation). The
// reply callback writes whatever JSON-RPC frame the handler produced.
type RequestHandler = (
  msg: { id: number; method: string; params?: unknown },
  reply: (frame: object) => void,
) => Promise<void>

let requestHandler: RequestHandler | null = null

export function setSocketRequestHandler(fn: RequestHandler): void {
  requestHandler = fn
}

// stdio.emit() calls this to fan session/task/… events out to subscribed socket
// clients. Registered from index.ts to keep stdio.ts free of a socket import.
export function emitToSockets(type: string, payload: unknown): void {
  for (const conn of conns) {
    if (!conn.authed || !conn.eventPrefixes) continue
    if (!conn.eventPrefixes.some((p) => type.startsWith(p))) continue
    writeFrame(conn.socket, {
      method: 'event',
      params: { type, payload },
    })
  }
}

function writeFrame(socket: Socket, frame: object): void {
  // Backpressure: a dead-ish client must not stall the event loop. socket.write
  // buffers internally; destroy on catastrophic failure only.
  try {
    socket.write(`${JSON.stringify(frame)}\n`)
  } catch {
    connDrop(socket)
  }
}

function connDrop(socket: Socket): void {
  for (const conn of conns) {
    if (conn.socket === socket) {
      conns.delete(conn)
      socket.destroy()
      return
    }
  }
}

// ── Per-connection line handling ─────────────────────────────────────────────

async function handleConnLine(conn: Conn, line: string): Promise<void> {
  let msg: unknown
  try {
    msg = JSON.parse(line)
  } catch {
    log.warn('socket: bad json frame', { bytes: line.length })
    return
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return
  const m = msg as Record<string, unknown>

  // Handshake — must be the first frame.
  if (!conn.authed) {
    if (m.method !== 'engine.hello') {
      writeFrame(conn.socket, {
        jsonrpc: '2.0',
        method: 'engine.error',
        params: { message: 'first frame must be engine.hello' },
      })
      connDrop(conn.socket)
      return
    }
    const params =
      m.params && typeof m.params === 'object' ? (m.params as Record<string, unknown>) : undefined
    const token = params?.token
    if (typeof token !== 'string' || token !== engineToken) {
      writeFrame(conn.socket, {
        jsonrpc: '2.0',
        method: 'engine.error',
        params: { message: 'bad engine token (stale endpoint or wrong engine)' },
      })
      connDrop(conn.socket)
      return
    }
    conn.authed = true
    writeFrame(conn.socket, {
      jsonrpc: '2.0',
      method: 'engine.hello',
      params: { ok: true, pid: process.pid, version: ENDPOINT_VERSION },
    })
    return
  }

  // Transport-level subscription management — internal, not in the RPC registry.
  if (m.method === 'events.subscribe' || m.method === 'events.unsubscribe') {
    const params =
      m.params && typeof m.params === 'object' ? (m.params as Record<string, unknown>) : undefined
    const prefixes = params?.prefixes
    if (m.method === 'events.unsubscribe') {
      conn.eventPrefixes = null
    } else if (Array.isArray(prefixes)) {
      conn.eventPrefixes = prefixes.filter((p): p is string => typeof p === 'string')
    }
    writeFrame(conn.socket, { jsonrpc: '2.0', id: m.id ?? null, result: { ok: true } })
    return
  }

  // Everything else is a forward RPC request — gated by the socket allowlist.
  if (typeof m.id === 'number' && typeof m.method === 'string') {
    if (!isSocketMethodAllowed(m.method)) {
      writeFrame(conn.socket, {
        jsonrpc: '2.0',
        id: m.id,
        error: { code: -32601, message: `Method not available on socket: ${m.method}` },
      })
      return
    }
    if (requestHandler) {
      await requestHandler(
        { id: m.id, method: m.method, params: m.params },
        (frame) => writeFrame(conn.socket, frame),
      )
    }
  }

  // A socket client's host-response or other stray frame: no-op (it has no host).
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function startSocketServer(): Promise<{ socketPath: string; endpointPath: string }> {
  const home = awogHome()
  await mkdir(home, { recursive: true, mode: 0o700 })

  const isWindows = process.platform === 'win32'
  socketPath = isWindows ? '\\\\.\\pipe\\awog-engine' : join(home, SOCKET_NAME)
  const endpointPath = join(home, ENDPOINT_NAME)
  engineToken = randomBytes(24).toString('hex')

  // Stale socket file from a crashed engine — safe to reclaim.
  if (!isWindows) await unlink(socketPath).catch(() => {})

  server = createServer((socket) => {
    const conn: Conn = { socket, authed: false, eventPrefixes: null, buffer: '' }
    conns.add(conn)
    socket.on('error', () => connDrop(socket))
    socket.on('close', () => conns.delete(conn))
    socket.on('data', (chunk) => {
      conn.buffer += chunk.toString('utf8')
      let idx: number
      while ((idx = conn.buffer.indexOf('\n')) >= 0) {
        const line = conn.buffer.slice(0, idx).trim()
        conn.buffer = conn.buffer.slice(idx + 1)
        if (line.length === 0) continue
        void handleConnLine(conn, line).catch((err: unknown) => {
          log.error('socket: line handler crashed', {
            err: err instanceof Error ? err.message : String(err),
          })
        })
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(socketPath, () => resolve())
  })
  if (!isWindows) await chmod(socketPath, 0o600)

  const endpoint: EndpointFile = {
    version: ENDPOINT_VERSION,
    socketPath: socketPath!,
    token: engineToken,
    pid: process.pid,
  }
  await writeFile(endpointPath, JSON.stringify(endpoint), { encoding: 'utf8', mode: 0o600 })
  await chmod(endpointPath, 0o600)

  log.info('socket transport listening', { socketPath })
  return { socketPath: socketPath!, endpointPath }
}

export async function stopSocketServer(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  for (const conn of conns) conn.socket.destroy()
  conns = new Set()
  if (server) {
    const s = server
    server = null
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }
  const home = awogHome()
  await unlink(join(home, ENDPOINT_NAME)).catch(() => {})
  if (socketPath && process.platform !== 'win32') await unlink(socketPath).catch(() => {})
}

// Read-back helper for the CLI/dev: which endpoint does THIS engine publish?
// (Client-side the CLI reads the file itself; this is for tests.)
export async function readEndpoint(): Promise<EndpointFile | null> {
  try {
    const raw = await readFile(join(awogHome(), ENDPOINT_NAME), 'utf8')
    return JSON.parse(raw) as EndpointFile
  } catch {
    return null
  }
}
