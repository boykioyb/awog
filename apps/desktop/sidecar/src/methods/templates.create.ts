import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { createTemplate, type CreateEntityRef } from '../templates/store.js'

const EntitySchema = z.object({
  kind: z.enum(['agent', 'skill', 'hook', 'rule', 'command']),
  id: z.string().min(1).max(256),
  source: z.enum(['global', 'project']),
  projectId: z.string().min(1).max(64).optional(),
})

const Params = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  sourceProjectId: z.string().min(1).max(64).optional(),
  entities: z.array(EntitySchema).max(500),
})

register('templates.create', async (raw) => {
  const p = Params.parse(raw)
  const template = await createTemplate({
    name: p.name,
    description: p.description,
    ...(p.sourceProjectId ? { sourceProjectId: p.sourceProjectId } : {}),
    entities: p.entities as CreateEntityRef[],
  })
  return { template }
})
