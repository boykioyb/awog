import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSkills } from '../skills/store.js'

const Params = z.object({
  // Project tiers (.claude/skills, .agents/skills) are scanned for every id
  // listed here. Empty / omitted → only the three user-level tiers run.
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
})

register('skills.list', async (raw) => {
  // Tauri-rust forwards a JSON null when the UI omits params; zod's `.optional()`
  // only tolerates `undefined`, so normalize null → {} first.
  const params = Params.parse(raw ?? {})
  const { skills, reports } = await listSkills(params.projectIds ?? [])
  return { skills, reports }
})
