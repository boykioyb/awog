import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listTeams } from '../teams/store.js'

// Liệt kê team specs hai tầng (session-teams §9): global ~/.awog/teams + theo
// từng project được đưa trong `projectIds` — cùng khuôn danh bạ của
// agents.list / workflows.list.
const Params = z
  .object({
    projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .optional()

register('teams.list', async (raw) => {
  const params = Params.parse(raw)
  const teams = await listTeams(params?.projectIds ?? [])
  return { teams }
})
