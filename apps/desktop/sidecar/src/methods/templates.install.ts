import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { installTemplate } from '../templates/store.js'
import { invalidateRulesCache } from '../rules/inject.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

const Params = z.object({
  templateId: z.string().min(1).max(120),
  targetProjectId: z.string().min(1).max(64),
  conflictPolicy: z.enum(['skip', 'overwrite']).optional(),
})

register('templates.install', async (raw) => {
  const p = Params.parse(raw)
  const result = await installTemplate(p.templateId, p.targetProjectId, p.conflictPolicy ?? 'skip')
  // Newly-installed rules/hooks should take effect immediately.
  if (result.installed.some((i) => i.kind === 'rule')) invalidateRulesCache()
  if (result.installed.some((i) => i.kind === 'hook')) invalidateHookCache()
  return { result }
})
