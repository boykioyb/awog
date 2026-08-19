import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listCommands } from '../commands/store.js'
import { migrateToClaudeHome } from '../migration/claude-home.js'

const Params = z.object({
  projectIds: z.array(z.string()).optional(),
})

register('commands.list', async (raw) => {
  const params = Params.parse(raw ?? {})
  // Wait out the boot migration (ADR 0070) — without this a list served while
  // entries are still moving would show a half-drained store. Resolved and
  // free after the first boot that finds nothing to migrate.
  await migrateToClaudeHome()
  const { commands, reports } = await listCommands(params.projectIds ?? [])
  return { commands, reports }
})
