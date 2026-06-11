import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { writeHookScript } from '../hooks/script.js'

const Params = z.object({
  command: z.string(),
  source: z
    .enum(['global', 'project', 'claude-project', 'claude-local', 'claude-user'])
    .optional(),
  projectId: z.string().optional(),
  content: z.string(),
})

register('hooks.write-script', async (raw) => {
  const params = Params.parse(raw)
  const path = await writeHookScript(
    params.command,
    params.source ?? 'global',
    params.projectId,
    params.content,
  )
  return { path }
})
