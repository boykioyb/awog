import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadServer } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'
import { MCP_ID_RE } from '../mcp/schema.js'

const Params = z.object({
  id: z.string().regex(MCP_ID_RE),
})

register('mcp.restart', async (raw) => {
  const { id } = Params.parse(raw)
  const config = await loadServer(id)
  if (!config) throw new RpcError(-32602, `mcp server not found: ${id}`)
  if (!config.enabled) {
    throw new RpcError(-32602, 'cannot restart a disabled server')
  }
  await mcpManager.restart(id)
  return { server: mcpManager.getSnapshot(config) }
})
