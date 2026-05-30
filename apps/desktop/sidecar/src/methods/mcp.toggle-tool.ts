// Toggle deny state for a single tool inside an MCP server. Persists into
// the config's `deniedTools` array. Runtime filtering (when an agent calls
// the tool) is wired in mcpManager separately — this method just owns the
// persisted list.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadServer, saveServer } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'
import { MCP_ID_RE } from '../mcp/schema.js'

const Params = z.object({
  id: z.string().regex(MCP_ID_RE),
  toolName: z.string().min(1).max(200),
  denied: z.boolean(),
})

register('mcp.toggle-tool', async (raw) => {
  const { id, toolName, denied } = Params.parse(raw)
  const config = await loadServer(id)
  if (!config) throw new RpcError(-32602, `mcp server not found: ${id}`)

  const current = new Set(config.deniedTools ?? [])
  const wasDenied = current.has(toolName)
  if (denied === wasDenied) {
    return { server: mcpManager.getSnapshot(config) }
  }
  if (denied) current.add(toolName)
  else current.delete(toolName)

  const next = { ...config, deniedTools: current.size > 0 ? [...current].sort() : undefined }
  await saveServer(next)
  return { server: mcpManager.getSnapshot(next) }
})
