// Typed wrapper for the `storage.*` RPCs (disk accounting for ~/.awog/sessions).
// Shape mirrors apps/desktop/sidecar/src/storage/scan.ts.
import { useSidecar } from './useSidecar'

// Named `Storage…` on purpose: `useSessionsData.ts` already exports a
// `SessionUsage` (token/cost usage), and two composables exporting the same
// name makes Nuxt's auto-import pick one arbitrarily.
export interface StorageSessionUsage {
  id: string
  title: string
  projectId: string | null
  updatedAt: string | null
  transcriptBytes: number
  snapshotBytes: number
  attachmentBytes: number
  otherBytes: number
  totalBytes: number
}

export interface ProjectUsage {
  projectId: string | null
  sessionCount: number
  transcriptBytes: number
  snapshotBytes: number
  attachmentBytes: number
  otherBytes: number
  totalBytes: number
}

export interface StorageScan {
  totalBytes: number
  transcriptBytes: number
  snapshotBytes: number
  attachmentBytes: number
  otherBytes: number
  orphanBytes: number
  orphanCount: number
  orphanNames: string[]
  projects: ProjectUsage[]
  sessions: StorageSessionUsage[]
}

export interface PruneResult {
  freedBytes: number
  /** Sessions pruned, or files deleted — whichever the call asked for. */
  count: number
}

// The engine is bundled but only picks a rebuild up when the app RESTARTS, so a
// hot-reloaded UI can be talking to an older sidecar for a while. That one is
// still sending the pre-rename `sessionCount`; normalise here so nothing
// downstream has to know two shapes — it surfaced as a toast reading
// "freed 6.3 GB from 0 sessions".
type RawPrune = { freedBytes?: number; count?: number; sessionCount?: number }
const normalizePrune = (r: RawPrune): PruneResult => ({
  freedBytes: r.freedBytes ?? 0,
  count: r.count ?? r.sessionCount ?? 0,
})

export function useStorageApi() {
  const sidecar = useSidecar()
  return {
    // Walks the whole tree — seconds on a multi-GB store, so call it on open and
    // after a cleanup, never on a timer.
    scan: () => sidecar.request<StorageScan>('storage.scan', {}),
    pruneSnapshots: (olderThanDays: number) =>
      sidecar.request<RawPrune>('storage.pruneSnapshots', { olderThanDays }).then(normalizePrune),
    deleteOrphans: () =>
      sidecar.request<RawPrune>('storage.deleteOrphans', {}).then(normalizePrune),
    deleteSession: (id: string) => sidecar.request<unknown>('sessions.delete', { id }),
  }
}
