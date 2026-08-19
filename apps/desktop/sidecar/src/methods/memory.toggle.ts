import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadFact, saveFact } from '../memory/store.js'
import { invalidateMemoryCache } from '../memory/inject.js'

const Params = z.object({
  id: z.string().min(1).max(120),
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  enabled: z.boolean(),
})

// Toggling rewrites the file (the flag lives in its frontmatter), so load the
// current fact first — a save built from the toggle params alone would blank body
// and description.
register('memory.toggle', async (raw) => {
  const params = Params.parse(raw)
  const existing = await loadFact(params.id, params.source, params.projectId)
  if (!existing) throw new RpcError(-32602, `Memory not found: ${params.id}`)
  const fact = await saveFact({ ...existing, enabled: params.enabled })
  invalidateMemoryCache()
  return { fact }
})
