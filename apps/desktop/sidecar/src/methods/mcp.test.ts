import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { McpServerConfigSchema } from '../mcp/schema.js'
import { mcpManager } from '../mcp/manager.js'

const Params = z.object({
  server: McpServerConfigSchema,
})

register('mcp.test', async (raw) => {
  const { server } = Params.parse(raw)
  return mcpManager.test(server)
})
