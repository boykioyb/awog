// Đo bề mặt read-only của app-server: không gọi model, không tốn quota.
import { connect } from './client.mjs'

const t0 = Date.now()
const { call, initialize, close } = connect({ onNotification: () => {} })

const init = await initialize()
console.log(`initialize (${Date.now() - t0}ms)\n`, JSON.stringify(init.result ?? init.error, null, 2))

const READ_ONLY = [
  'getAuthStatus',
  'account/read',
  'account/rateLimits/read',
  'model/list',
  'skills/list',
  'hooks/list',
  'mcpServerStatus/list',
]

for (const method of READ_ONLY) {
  const t = Date.now()
  const res = await call(method, {})
  const body = JSON.stringify(res.result ?? { ERROR: res.error }, null, 1)
  console.log(`\n--- ${method} (${Date.now() - t}ms) ---\n${body.slice(0, 1200)}`)
}

close()
