import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { fetchRemoteTemplates } from '../templates/remote.js'

// templates.fetchRemote — import one or more template bundles from a public
// GitHub folder into ~/.awog/templates/ (ADR 0037). The folder may be a single
// bundle or a registry of bundles; each must carry a template.json.
const Params = z.object({
  url: z.string().min(1).max(2048),
  overwrite: z.boolean().optional(),
})

register('templates.fetchRemote', async (raw) => {
  const p = Params.parse(raw)
  const result = await fetchRemoteTemplates(p.url, { overwrite: p.overwrite ?? false })
  return result
})
