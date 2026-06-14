import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { scanImportCandidates } from '../migration/migrate.js'

// Scan `.claude`/`.agents` for config importable into `.awog`. Scope is
// exclusive: a projectId scans ONLY that project's legacy dirs; without one it
// scans ONLY global (~/.claude, ~/.agents) (ADR 0035 / config-import-assistant).
const Params = z.object({ projectId: z.string().min(1).max(64).optional() }).optional()

register('migration.scan', async (raw) => {
  const params = Params.parse(raw)
  const candidates = await scanImportCandidates(params?.projectId)
  return { candidates }
})
