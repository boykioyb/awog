import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listAgents } from '../agents/store.js'
import { migrateToClaudeHome } from '../migration/claude-home.js'

const Params = z
  .object({
    // When omitted, only the global tier (<claudeHome>/agents) is scanned. UI
    // passes the registered project ids so {project}/.claude/agents is picked up too.
    projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .optional()

register('agents.list', async (raw) => {
  const params = Params.parse(raw)
  // Wait out the boot migration (ADR 0070) — without this a list served while
  // entries are still moving would show a half-drained store. Resolved and
  // free after the first boot that finds nothing to migrate.
  await migrateToClaudeHome()
  const ids = params?.projectIds ?? []
  const { agents, reports } = await listAgents(ids)
  return { agents, reports }
})
