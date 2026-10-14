import { createInterface, type Interface } from 'node:readline'
import { log } from '../util/logger.js'

export type LineHandler = (line: string) => void | Promise<void>

// stdout hỏng = host (Electron main) đã chết: thôi ghi và đi đường tắt máy như khi
// stdin đóng. Có listener thì EPIPE của stdout không thành `uncaughtException` — xem
// logger.ts về vòng EPIPE → log → EPIPE từng làm sidecar mồ côi đứng 100% CPU.
let stdoutBroken = false
let onHostGone: (() => void) | null = null
process.stdout.on('error', () => {
  if (stdoutBroken) return
  stdoutBroken = true
  onHostGone?.()
})

export function send(obj: object): void {
  if (stdoutBroken) return
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

export function emit(type: string, payload: unknown): void {
  send({
    jsonrpc: '2.0',
    method: 'event',
    params: { type, payload },
  })
  // Second-door fan-out: external clients on the unix socket transport
  // (ADR 0093) get the same event stream, filtered by their subscription.
  eventSink?.(type, payload)
}

// Registered by transport/socket.ts at boot. One sink is enough — a second
// external transport would mean redesigning, not appending.
let eventSink: ((type: string, payload: unknown) => void) | null = null
export function setEventSink(fn: (type: string, payload: unknown) => void): void {
  eventSink = fn
}

// ─── Reverse channel: sidecar → Electron main request/response ──────────────
// The sidecar can ask the host (Electron main) to do something it can only do
// there — e.g. drive the embedded Chromium for `browser_tool`. Framed as
// `method:'host-request'` on stdout (distinct from the numeric-id forward
// requests + the no-id events), with the reply coming back as
// `method:'host-response'` on stdin. `rid` is a sidecar-local counter,
// namespaced away from the host's forward-request `id` (different frame shape,
// so the two can collide numerically with zero ambiguity).

type HostError = { code: number; message: string }
type PendingHost = { resolve: (v: unknown) => void; reject: (e: HostError) => void; timer: NodeJS.Timeout }

let hostRid = 1
const pendingHost = new Map<number, PendingHost>()

export function hostRequest(hostMethod: string, hostParams: unknown, timeoutMs = 30_000): Promise<unknown> {
  const rid = hostRid
  hostRid += 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHost.delete(rid)
      reject({ code: -32000, message: `host request timed out: ${hostMethod}` })
    }, timeoutMs)
    pendingHost.set(rid, { resolve, reject, timer })
    send({ jsonrpc: '2.0', method: 'host-request', params: { rid, hostMethod, hostParams } })
  })
}

// Resolve a pending host request from the main process's `host-response` frame.
// Called by the stdin handler in index.ts.
export function resolveHostResponse(rid: number, result: unknown, error?: HostError): void {
  const pending = pendingHost.get(rid)
  if (!pending) return
  pendingHost.delete(rid)
  clearTimeout(pending.timer)
  if (error) pending.reject(error)
  else pending.resolve(result)
}

export function startStdioLoop(
  onLine: LineHandler,
  // Called on stdin close so the caller can flush durable state (e.g. pending session
  // writes) BEFORE the process exits. When omitted we exit immediately (back-compat).
  // When provided, the handler owns the exit — we do not call process.exit here.
  onClose?: () => void | Promise<void>,
): Interface {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    // Errors are caught per-message in handler; sidecar must survive bad input.
    Promise.resolve(onLine(trimmed)).catch((err: unknown) => {
      log.error('stdio loop handler crashed', {
        err: err instanceof Error ? err.message : String(err),
      })
    })
  })

  // Host exit → stdin close (hoặc stdout EPIPE, tuỳ cái nào tới trước) → graceful
  // shutdown (ADR 0008). Chỉ một lần.
  let gone = false
  const hostGone = (reason: string): void => {
    if (gone) return
    gone = true
    log.info(`${reason}, shutting down`)
    if (onClose) void onClose()
    else process.exit(0)
  }
  rl.on('close', () => hostGone('stdin closed'))
  onHostGone = () => hostGone('stdout broken')

  return rl
}
