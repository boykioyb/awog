import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { deleteSkill } from '../skills/store.js'

const USER_SOURCES = ['global', 'user-claude', 'user-agents'] as const
const PROJECT_SOURCES = ['project-claude', 'project-agents'] as const

const Params = z.object({
  id: z.string().min(1),
  source: z.enum([...USER_SOURCES, ...PROJECT_SOURCES]),
  projectId: z.string().min(1).max(64).optional(),
})

register('skills.delete', async (raw) => {
  const params = Params.parse(raw)
  const isProject = (PROJECT_SOURCES as readonly string[]).includes(params.source)
  if (isProject && !params.projectId) {
    throw new RpcError(-32602, `Source ${params.source} requires projectId`)
  }
  await deleteSkill(params.id, params.source, params.projectId)
  return { ok: true }
})
