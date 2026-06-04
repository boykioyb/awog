import { setOutputSink } from './stdio.js'
import { log } from '../util/logger.js'

// parentPort transport — used when the engine runs as an Electron
// `utilityProcess.fork` child. Electron forbids piping stdin to a utility
// process (`stdio[0]` must be `'ignore'`), so the JSON-RPC carrier switches
// from NDJSON-over-stdin/stdout to MessagePort `postMessage`. The envelope
// shape ({ jsonrpc, id, method, params } / { jsonrpc, id, result|error } /
// { method: 'event', params }) is identical to the stdio transport — only the
// carrier differs. See docs/features/electron-migration.md §5.

export type MessageHandler = (msg: unknown) => void | Promise<void>

// process.parentPort is injected by Electron's utilityProcess runtime. Typed
// locally so the engine package never depends on `electron`.
type ParentPort = {
  on(event: 'message', listener: (e: { data: unknown }) => void): void
  on(event: 'close', listener: () => void): void
  postMessage(message: unknown): void
}

export function getParentPort(): ParentPort | undefined {
  return (process as unknown as { parentPort?: ParentPort }).parentPort
}

export function startParentPortLoop(port: ParentPort, onMessage: MessageHandler): void {
  // Route all outgoing envelopes through the MessagePort instead of stdout.
  setOutputSink((obj) => port.postMessage(obj))

  port.on('message', (e) => {
    // Errors are handled per-message; the engine must survive bad input.
    Promise.resolve(onMessage(e.data)).catch((err: unknown) => {
      log.error('parentPort handler crashed', {
        err: err instanceof Error ? err.message : String(err),
      })
    })
  })

  // Main process quit / window torn down → port closes → graceful shutdown
  // (mirrors the stdin-close behaviour of the stdio transport, ADR 0008).
  port.on('close', () => {
    log.info('parentPort closed, shutting down')
    process.exit(0)
  })
}
