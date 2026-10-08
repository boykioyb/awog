// Engine client for the `awog` CLI. Two ways in (ADR 0093):
//
//   1. ATTACH — read ~/.awog/engine.endpoint (socket path + per-boot token
//      written by the running engine), connect the unix socket, authenticate
//      with `engine.hello`. Preferred: one engine owns ~/.awog, so the CLI
//      shares sessions/tasks with the app instead of racing its writers.
//   2. SPAWN  — no endpoint (app not running): spawn a short-lived engine as a
//      child on plain stdio, same codec. It dies with the CLI.
//
// Both paths end in the same Engine shape: rpc() + onEvent() + close().

import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface EngineEvent {
  type: string
  payload: unknown
}

interface EndpointFile {
  socketPath: string
  token: string
  pid: number
}

export interface Engine {
  rpc<T = unknown>(method: string, params?: unknown): Promise<T>
 onEvent(fn: (evt: EngineEvent) => void): () => void
  /** Subscribe this connection to event prefixes (socket only; spawned engines
   *  already emit everything — call is a no-op there). */
  subscribe(prefixes: string[]): void
  /** True when attached to the app's running engine (vs a spawned child). */
  attached: boolean
  close(): Promise<void>
}

interface Wire {
  write(obj: object): void
  onLine(fn: (line: string) => void): void
}

function socketWire(socket: Socket): Wire {
  return {
    write: (obj) => socket.write(`${JSON.stringify(obj)}\n`),
    onLine: (fn) => {
      let buf = ''
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (line.length) fn(line)
        }
      })
    },
  }
}

function stdioWire(child: ChildProcess): Wire {
  if (!child.stdin || !child.stdout) throw new Error('engine stdio not piped')
  const stdin = child.stdin
  const stdout = child.stdout
  return {
    write: (obj) => stdin.write(`${JSON.stringify(obj)}\n`),
    onLine: (fn) => {
      const rl = createInterface({ input: stdout })
      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (trimmed.length) fn(trimmed)
      })
    },
  }
}

function engineOver(
  wire: Wire,
  opts: { attached: boolean; closer: () => Promise<void> },
): Engine {
  let rid = 1
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  const listeners: Array<(evt: EngineEvent) => void> = []

  wire.onLine((line) => {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return
    const m = msg as Record<string, unknown>

    // host-request → must always be answered or the engine hangs (browser_*).
    if (m.method === 'host-request' && m.params && typeof m.params === 'object') {
      const hp = m.params as Record<string, unknown>
      wire.write({
        jsonrpc: '2.0',
        method: 'host-response',
        params: {
          rid: hp.rid,
          error: {
            code: -32601,
            message: `host method unavailable in awog CLI: ${String(hp.hostMethod)}`,
          },
        },
      })
      return
    }

    if (m.method === 'event' && m.params && typeof m.params === 'object') {
      const ep = m.params as Record<string, unknown>
      const evt: EngineEvent = { type: String(ep.type), payload: ep.payload }
      for (const fn of listeners) fn(evt)
      return
    }

    if (typeof m.id === 'number') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.error && typeof m.error === 'object' && !Array.isArray(m.error)) {
        const e = m.error as Record<string, unknown>
        p.reject(new Error(`${String(e.code)}: ${String(e.message)}`))
      } else {
        p.resolve(m.result)
      }
    }
  })

  return {
    attached: opts.attached,
    rpc<T = unknown>(method: string, params = null): Promise<T> {
      const { promise, resolve: res, reject: rej } = Promise.withResolvers<T>()
      const id = rid++
      const timer = setTimeout(() => {
        pending.delete(id)
        rej(new Error(`engine timeout: ${method}`))
      }, 600_000)
      pending.set(id, {
        resolve: res as (v: unknown) => void,
        reject: rej,
        timer,
      })
      wire.write({ jsonrpc: '2.0', id, method, params })
      return promise
    },
    onEvent(fn) {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    subscribe(prefixes) {
      wire.write({
        jsonrpc: '2.0',
        method: 'events.subscribe',
        params: { prefixes },
      })
    },
    close: opts.closer,
  }
}

// ── Attach path ──────────────────────────────────────────────────────────────

async function readEndpoint(): Promise<EndpointFile | null> {
  try {
    const raw = await readFile(join(homedir(), '.awog', 'engine.endpoint'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<EndpointFile>
    if (typeof parsed.socketPath !== 'string' || typeof parsed.token !== 'string') return null
    return { socketPath: parsed.socketPath, token: parsed.token, pid: Number(parsed.pid) || 0 }
  } catch {
    return null
  }
}

async function attach(): Promise<Engine | null> {
  const endpoint = await readEndpoint()
  if (!endpoint) return null
  const { promise, resolve: resolveConn } = Promise.withResolvers<Engine | null>()
  const socket = connect(endpoint.socketPath)
  const bail = () => {
    socket.destroy()
    resolveConn(null)
  }
  socket.once('error', bail)
  socket.setTimeout(5_000, bail)

  const wire = socketWire(socket)
  wire.onLine((line) => {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return
    const m = msg as Record<string, unknown>
    if (m.method === 'engine.hello') {
      socket.setTimeout(0)
      resolveConn(
        engineOver(wire, {
          attached: true,
          closer: async () => {
            socket.destroy()
          },
        }),
      )
    } else if (m.method === 'engine.error') {
      process.stderr.write(`engine rejected attach: ${JSON.stringify(m.params)}\n`)
      bail()
    }
  })
  socket.on('connect', () => {
    wire.write({
      jsonrpc: '2.0',
      method: 'engine.hello',
      params: { token: endpoint.token, client: 'awog-cli' },
    })
  })
  return promise
}

// ── Spawn path ───────────────────────────────────────────────────────────────

// Resolve the engine entry. Order: explicit override → packaged bundle → repo
// layout (running from a source checkout).
function engineEntry(): string {
  if (process.env.AWOG_ENGINE_PATH) return resolve(process.env.AWOG_ENGINE_PATH)
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // Bundled: dist/node_modules/@awog/sidecar/lib/src/index.js
    join(here, 'node_modules', '@awog', 'sidecar', 'lib', 'src', 'index.js'),
    // Repo layout: apps/cli/dist/../.. → apps/desktop/sidecar/{dist-dev,dist}
    join(here, '..', '..', 'desktop', 'sidecar', 'dist-dev', 'lib', 'src', 'index.js'),
    join(here, '..', '..', 'desktop', 'sidecar', 'dist', 'lib', 'src', 'index.js'),
  ]
  const found = candidates.find((c) => existsSync(c))
  if (!found) {
    throw new Error(
      'engine entry not found — set AWOG_ENGINE_PATH or run from a checkout with the sidecar built',
    )
  }
  return resolve(found)
}

async function spawnEngine(): Promise<Engine> {
  const child = spawn(process.execPath, [engineEntry()], {
    cwd: homedir(),
    // A CLI-spawned engine is a private helper: AWOG_ATTACH_SOCKET=0 keeps it
    // off ~/.awog/engine.endpoint, which belongs to the app's engine.
    env: { ...process.env, AWOG_ATTACH_SOCKET: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // Engine logs go to its stderr. Default: swallow — RPC errors + events carry
  // everything the user needs; the JSON log stream is noise next to the chat.
  // AWOG_VERBOSE=1 relays it (dimmed) for debugging the engine itself.
  if (process.env.AWOG_VERBOSE === '1') {
    let buf = ''
    child.stderr?.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line.trim()) process.stderr.write(`\x1b[2m${line}\x1b[0m\n`)
      }
    })
  } else {
    child.stderr?.resume() // drain so the child's stderr buffer never blocks it
  }

  const closer = (): Promise<void> => {
    const { promise, resolve: resolveClose } = Promise.withResolvers<void>()
    child.once('exit', resolveClose)
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already dead */
      }
      resolveClose()
    }, 3_000)
    return promise
  }

  return engineOver(stdioWire(child), { attached: false, closer })
}

// ── Public connect ───────────────────────────────────────────────────────────

export interface ConnectOptions {
  /** Skip the attach attempt and always spawn (AWOG_NO_ATTACH / --spawn). */
  spawn?: boolean
}

export async function connectEngine(opts: ConnectOptions = {}): Promise<Engine> {
  if (!opts.spawn && !process.env.AWOG_NO_ATTACH) {
    const engine = await attach()
    if (engine) return engine
  }
  return spawnEngine()
}
