import { register } from '../transport/rpc.js'
import { listSessions } from '../sessions/store.js'

register('sessions.list', async () => {
  const sessions = await listSessions()
  return { sessions }
})
