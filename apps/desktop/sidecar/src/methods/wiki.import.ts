import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { importWikiDocs } from '../wiki/store.js'
import { invalidateWikiCache } from '../wiki/inject.js'

// Import reads files the user picked from anywhere on disk (OS dialog / drag-drop)
// — the consent-scoped exception to workspace-only reads (ADR 0073 D-8). The
// guards (extension allowlist, size cap, page cap, symlink refusal) live in
// wiki/store.ts#importWikiDocs; this method only bounds the request itself.
const Params = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().optional(),
  space: z.string().max(200).optional(),
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  overwrite: z.boolean().optional(),
})

register('wiki.import', async (raw) => {
  const params = Params.parse(raw)
  const report = await importWikiDocs(params)
  invalidateWikiCache()
  return report
})
