import { startStdioLoop, send } from './transport/stdio.js'
import { dispatch, RpcError } from './transport/rpc.js'
import { log } from './util/logger.js'

// Side-effect imports register methods into the RPC registry.
import './methods/ping.js'
import './methods/auth.start-oauth.js'
import './methods/auth.complete-oauth.js'
import './methods/accounts.list.js'
import './methods/accounts.remove.js'
import './methods/accounts.set-active.js'
import './methods/accounts.test.js'
import './methods/sessions.send-message.js'
import './methods/sessions.cancel.js'
import './methods/sessions.permission.js'
import './methods/sessions.list.js'
import './methods/sessions.upsert.js'
import './methods/sessions.delete.js'
import './methods/account.usage.js'
import './methods/projects.list.js'
import './methods/projects.upsert.js'
import './methods/projects.delete.js'
import './methods/projects.clone.js'
import './methods/projects.inspect.js'
import './methods/skills.list.js'
import './methods/skills.upsert.js'
import './methods/skills.delete.js'
import './methods/skills.generate.js'

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.jsonrpc === '2.0' && typeof v.id === 'number' && typeof v.method === 'string'
}

async function handleLine(line: string): Promise<void> {
  let msg: unknown
  try {
    msg = JSON.parse(line)
  } catch {
    log.warn('bad json on stdin', { line })
    return
  }

  if (!isJsonRpcRequest(msg)) {
    log.warn('bad envelope on stdin', { msg })
    return
  }

  try {
    const result = await dispatch(msg.method, msg.params)
    send({ jsonrpc: '2.0', id: msg.id, result })
  } catch (err) {
    if (err instanceof RpcError) {
      const error: { code: number; message: string; data?: unknown } = {
        code: err.code,
        message: err.message,
      }
      if (err.data !== undefined) error.data = err.data
      send({ jsonrpc: '2.0', id: msg.id, error })
      return
    }
    log.error('unhandled handler error', {
      err: err instanceof Error ? err.message : String(err),
    })
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: 'Internal error' },
    })
  }
}

// Force stdout to blocking mode so streaming chunks reach the host immediately
// instead of being batched in Node's 64KB pipe buffer. Without this, many small
// `emit()` writes coalesce and the UI sees the whole response in one burst.
const stdoutHandle = (process.stdout as unknown as {
  _handle?: { setBlocking?: (b: boolean) => void }
})._handle
if (stdoutHandle?.setBlocking) stdoutHandle.setBlocking(true)

log.info('sidecar starting', { pid: process.pid, node: process.version })
startStdioLoop(handleLine)
