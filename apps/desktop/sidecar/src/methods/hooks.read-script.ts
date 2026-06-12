import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { readHookScript } from '../hooks/script.js'

const Params = z.object({
  command: z.string(),
  source: z.enum(['global', 'project']).optional(),
  projectId: z.string().optional(),
})

register('hooks.read-script', async (raw) => {
  const params = Params.parse(raw)
  const script = await readHookScript(params.command, params.source ?? 'global', params.projectId)
  return { script }
})
