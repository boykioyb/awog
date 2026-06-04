import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteServer, loadServer } from '../mcp/store.js'
import { mcpManager } from '../mcp/manager.js'
import { MCP_ID_RE } from '../mcp/schema.js'
import { purgeServerSecrets } from '../mcp/secrets.js'

const Params = z.object({
  id: z.string().regex(MCP_ID_RE),
})

register('mcp.delete', async (raw) => {
  const { id } = Params.parse(raw)
  // Load config first so we can purge any `secret:` references it owns from
  // the OS keychain before unlinking the JSON file. Failure to read = treat
  // as already-deleted (skip purge).
  const config = await loadServer(id)
  await mcpManager.stop(id)
  await deleteServer(id)
  if (config) {
    await purgeServerSecrets(id, config.env, config.headers)
  }
  return { ok: true }
})
