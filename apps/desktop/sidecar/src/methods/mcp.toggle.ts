import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadServer, saveServer } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'
import { MCP_ID_RE } from '../mcp/schema.js'

const Params = z.object({
  id: z.string().regex(MCP_ID_RE),
  enabled: z.boolean(),
})

register('mcp.toggle', async (raw) => {
  const { id, enabled } = Params.parse(raw)
  const config = await loadServer(id)
  if (!config) throw new RpcError(-32602, `mcp server not found: ${id}`)
  if (config.enabled === enabled) {
    return { server: mcpManager.getSnapshot(config) }
  }
  const next = { ...config, enabled }
  await saveServer(next)
  if (!enabled) {
    await mcpManager.stop(id)
  } else if (next.autoStart) {
    await mcpManager.start(id).catch(() => {
      // event channel surfaces error
    })
  }
  return { server: mcpManager.getSnapshot(next) }
})
