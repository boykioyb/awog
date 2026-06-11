import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadRule, saveRule } from '../rules/store.js'
import { invalidateRulesCache } from '../rules/inject.js'
import type { Rule } from '../types/shared.js'

const Params = z.object({
  rule: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    body: z.string().default(''),
    enabled: z.boolean().default(true),
    source: z
      .enum(['global', 'project', 'claude-project', 'claude-rules', 'claude-user'])
      .optional(),
    projectId: z.string().optional(),
  }),
  mode: z.enum(['create', 'update']),
})

register('rules.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.rule
  const source = incoming.source ?? 'global'

  // Imported (claude-*) rules: edit-in-place writes the body back to the Claude
  // Code source file (CLAUDE.md / .claude/rules). No create/existence dance.
  const isImported = source !== 'global' && source !== 'project'
  if (isImported) {
    await saveRule(incoming as Rule)
    invalidateRulesCache()
    return { rule: { ...incoming, source } }
  }

  if (source === 'project' && !incoming.projectId) {
    throw new RpcError(-32602, 'Project rule requires a projectId')
  }
  const existing = await loadRule(incoming.id, source, incoming.projectId)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `rule id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `rule not found: ${incoming.id}`)
  }

  await saveRule(incoming as Rule)
  invalidateRulesCache()
  return { rule: { ...incoming, source } }
})
