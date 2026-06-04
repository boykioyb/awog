import { createInterface, type Interface } from 'node:readline'
import { log } from '../util/logger.js'

export type LineHandler = (line: string) => void | Promise<void>

// Output sink: where outgoing JSON-RPC envelopes (responses + `event`
// notifications) are written. Default = NDJSON to stdout — used when the engine
// runs standalone (`pnpm dev`) or under any stdin/stdout host. Electron's
// utilityProcess CANNOT pipe stdin, so `parentport.ts` overrides this sink with
// `parentPort.postMessage`; the JSON-RPC envelope shape is identical either way.
type OutputSink = (obj: object) => void

let sink: OutputSink = (obj) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

export function setOutputSink(next: OutputSink): void {
  sink = next
}

export function send(obj: object): void {
  sink(obj)
}

export function emit(type: string, payload: unknown): void {
  send({
    jsonrpc: '2.0',
    method: 'event',
    params: { type, payload },
  })
}

export function startStdioLoop(onLine: LineHandler): Interface {
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

  // Tauri exit → stdin close → graceful shutdown (ADR 0008).
  rl.on('close', () => {
    log.info('stdin closed, shutting down')
    process.exit(0)
  })

  return rl
}
