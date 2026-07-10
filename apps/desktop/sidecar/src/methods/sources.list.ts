import { register } from '../transport/rpc.js'
import { listSources } from '../sources/store.js'

// Read-only: return every persisted Source config. Mirrors mcp.list minus the
// runtime snapshot layer (sources have no long-lived process — status is the
// persisted connectionStatus). See ADR 0060 (P0).
register('source.list', async () => {
  const sources = await listSources()
  return { sources }
})
