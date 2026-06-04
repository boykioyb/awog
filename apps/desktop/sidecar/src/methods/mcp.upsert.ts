import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { McpServerConfigSchema } from '../mcp/schema.js'
import { loadServer, saveServer } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'

const Params = z.object({
  server: McpServerConfigSchema,
  mode: z.enum(['create', 'update']),
})

register('mcp.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.server

  if (incoming.transport === 'sse') {
    // SSE deprecated by MCP spec — replaced by Streamable HTTP. We expose
    // http only (handles both spec-classic and Streamable HTTP responses).
    throw new RpcError(-32602, 'sse transport not supported — use http instead')
  }
  if (incoming.transport === 'stdio' && !incoming.command) {
    throw new RpcError(-32602, 'stdio transport requires command')
  }
  if (incoming.transport === 'http' && !incoming.url) {
    throw new RpcError(-32602, 'http transport requires url')
  }

  const existing = await loadServer(incoming.id)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `mcp server id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `mcp server not found: ${incoming.id}`)
  }

  await saveServer(incoming)

  // Lifecycle reconcile: stop if disabled, start if enabled+autoStart.
  if (!incoming.enabled) {
    await mcpManager.stop(incoming.id)
  } else if (incoming.autoStart) {
    // Restart to pick up new args/env if it was running.
    if (existing) {
      await mcpManager.restart(incoming.id).catch(() => {
        // Failures land in 'error' state; UI sees via mcp.status event.
      })
    } else {
      await mcpManager.start(incoming.id).catch(() => {
        // ditto
      })
    }
  }

  return { server: mcpManager.getSnapshot(incoming) }
})
