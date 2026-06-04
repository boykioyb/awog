import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { deleteProject } from '../projects/store.js'

const Params = z.object({
  id: z.string().min(1),
})

// Logical delete only: removes ~/.awog/projects/<id>.json. The codebase folder
// on disk (project.path) is never touched — that is the user's data.
register('projects.delete', async (raw) => {
  const params = Params.parse(raw)
  await deleteProject(params.id)
  return { ok: true }
})
