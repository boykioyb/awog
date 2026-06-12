import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { importCandidates, type ImportRef } from '../migration/migrate.js'
import { invalidateRulesCache } from '../rules/inject.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

// Copy selected `.claude`/`.agents` items into `.awog` (ADR 0035 D-5). Imported
// hooks land untrusted; secret values are never copied.
const RefSchema = z.object({
  kind: z.enum(['agent', 'skill', 'hook', 'rule', 'command']),
  id: z.string().min(1).max(256),
  targetScope: z.enum(['global', 'project']),
  projectId: z.string().min(1).max(64).optional(),
})

const Params = z.object({
  projectId: z.string().min(1).max(64).optional(),
  items: z.array(RefSchema).max(500),
})

register('migration.import', async (raw) => {
  const { projectId, items } = Params.parse(raw)
  const result = await importCandidates(items as ImportRef[], projectId)
  // Make freshly-imported rules/hooks take effect on the next turn/dispatch.
  if (result.imported.some((i) => i.kind === 'rule')) invalidateRulesCache()
  if (result.imported.some((i) => i.kind === 'hook')) invalidateHookCache()
  return { result }
})
