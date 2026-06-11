import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadRule, saveRule } from '../rules/store.js'
import { invalidateRulesCache } from '../rules/inject.js'

const Params = z.object({
  id: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
  enabled: z.boolean(),
})

register('rules.toggle', async (raw) => {
  const params = Params.parse(raw)
  const rule = await loadRule(params.id, params.source ?? 'global', params.projectId)
  if (!rule) throw new RpcError(-32602, `rule not found: ${params.id}`)
  rule.enabled = params.enabled
  await saveRule(rule)
  invalidateRulesCache()
  return { id: params.id, enabled: params.enabled }
})
