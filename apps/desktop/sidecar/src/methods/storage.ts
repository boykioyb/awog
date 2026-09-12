// `storage.*` — how much disk the session store is using, and the two cleanups
// worth offering. See src/storage/scan.ts for the measured breakdown that decided
// which cleanups those are.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import {
  deleteOrphans,
  pruneSnapshots,
  scanStorage,
  type PruneResult,
  type StorageScan,
} from '../storage/scan.js'
import { activeSessionIds } from '../sessions/runner.js'

register('storage.scan', async (): Promise<StorageScan> => scanStorage())

const PruneParams = z.object({
  // 0 would mean "every session including the one open right now" — require a
  // real window so a mis-click cannot wipe the Rewind history being relied on.
  olderThanDays: z.number().int().min(1).max(3650),
  // Omit for every project; `null` targets sessions with no project.
  projectId: z.string().nullable().optional(),
})

register('storage.pruneSnapshots', async (raw): Promise<PruneResult> => {
  const params = PruneParams.parse(raw)
  const opts: Parameters<typeof pruneSnapshots>[0] = {
    olderThanDays: params.olderThanDays,
    // A session mid-turn is writing snapshots as we speak; never pull the tree
    // out from under it.
    skipIds: new Set(activeSessionIds()),
  }
  if (params.projectId !== undefined) opts.projectId = params.projectId
  return pruneSnapshots(opts)
})

register('storage.deleteOrphans', async (): Promise<PruneResult> => deleteOrphans())
