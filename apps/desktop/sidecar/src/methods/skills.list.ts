import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSkills } from '../skills/store.js'

const Params = z
  .object({
    // Project tiers (.claude/skills, .agents/skills) are scanned for every id
    // listed here. Empty / omitted → only the three user-level tiers run.
    projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .optional()

register('skills.list', async (raw) => {
  const params = Params.parse(raw) ?? {}
  const skills = await listSkills(params.projectIds ?? [])
  return { skills }
})
