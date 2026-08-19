import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSkills } from '../skills/store.js'
import { awaitKindMigration } from '../migration/claude-home.js'

const Params = z.object({
  // The project tier ({project}/.claude/skills) is scanned for every id listed
  // here. Empty / omitted → only the global tier runs.
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
})

register('skills.list', async (raw) => {
  // Tauri-rust forwards a JSON null when the UI omits params; zod's `.optional()`
  // only tolerates `undefined`, so normalize null → {} first.
  const params = Params.parse(raw ?? {})
  // Wait out the boot migration for THIS kind only (ADR 0070) — without this a list served while
  // entries are still moving would show a half-drained store. Resolved and
  // free after the first boot that finds nothing to migrate.
  await awaitKindMigration('skills')
  const { skills, reports } = await listSkills(params.projectIds ?? [])
  return { skills, reports }
})
