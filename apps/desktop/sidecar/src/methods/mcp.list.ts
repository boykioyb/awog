import { register } from '../transport/rpc.js'
import { listServers } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'
import type { McpServerSnapshot } from '../types/shared.js'

register('mcp.list', async () => {
  const configs = await listServers()
  const servers: McpServerSnapshot[] = configs.map((cfg) => mcpManager.getSnapshot(cfg))
  return { servers }
})
