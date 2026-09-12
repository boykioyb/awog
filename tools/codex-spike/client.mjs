// Client JSON-RPC tối thiểu cho `codex app-server` (NDJSON qua stdio).
// Dùng chung bởi probe.mjs và turn.mjs. Xem README.md.
import { spawn } from 'node:child_process'

export function connect({ bin = process.env.CODEX_BIN, onNotification, onRequest } = {}) {
  if (!bin) throw new Error('CODEX_BIN chưa được set')
  const child = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let buf = ''
  let nextId = 1

  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      // server -> client request (có cả id lẫn method): phải trả lời, nếu không turn treo.
      if (msg.id !== undefined && msg.method) {
        const result = onRequest?.(msg) ?? {}
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
        continue
      }
      if (msg.id !== undefined) {
        const resolve = pending.get(msg.id)
        pending.delete(msg.id)
        resolve?.(msg)
        continue
      }
      onNotification?.(msg)
    }
  })
  child.stderr.resume()

  const call = (method, params) => {
    const id = nextId++
    const p = new Promise((resolve) => pending.set(id, resolve))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    return p
  }

  const initialize = () =>
    call('initialize', {
      clientInfo: { name: 'awog-spike', title: 'AWOG spike', version: '0.0.1' },
      // experimentalApi là điều kiện để server nhận ThreadStartParams.dynamicTools.
      capabilities: { experimentalApi: true, requestAttestation: false },
    })

  return { call, initialize, close: () => child.kill() }
}
