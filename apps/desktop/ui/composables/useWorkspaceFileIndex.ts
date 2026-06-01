import { ref, type Ref } from 'vue'
import type { FsEntry } from '~/types'
import { SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

// Flat workspace file index backing the composer's `@file` fuzzy mention.
// Cached per workspaceRoot at module scope so every composer that opens against
// the same project shares one fetch (and the result survives remounts). The
// list is loaded lazily on first `@` and refreshed cheaply on demand.

type FileIndexEntry = {
  files: Ref<FsEntry[]>
  loaded: boolean
  inFlight: Promise<void> | null
}

const cache = new Map<string, FileIndexEntry>()

const entryFor = (workspaceRoot: string): FileIndexEntry => {
  let entry = cache.get(workspaceRoot)
  if (!entry) {
    entry = { files: ref<FsEntry[]>([]), loaded: false, inFlight: null }
    cache.set(workspaceRoot, entry)
  }
  return entry
}

export const useWorkspaceFileIndex = () => {
  const sidecar = useSidecar()

  const fetchFiles = async (workspaceRoot: string, entry: FileIndexEntry): Promise<void> => {
    try {
      const res = await sidecar.request<{ files: FsEntry[]; truncated: boolean }>('fs.listFiles', {
        workspaceRoot,
      })
      entry.files.value = res.files
      entry.loaded = true
    } catch (err) {
      // Browser dev (no Tauri shell) — leave the index empty, mention shows nothing.
      if (err instanceof SidecarUnavailableError) return
      throw err
    } finally {
      entry.inFlight = null
    }
  }

  // Returns the shared reactive file list for a workspace, kicking off the fetch
  // on first call. Safe to call repeatedly — in-flight requests are deduped.
  const ensureLoaded = (workspaceRoot: string): Ref<FsEntry[]> => {
    const entry = entryFor(workspaceRoot)
    if (!entry.loaded && !entry.inFlight) {
      entry.inFlight = fetchFiles(workspaceRoot, entry).catch(() => undefined)
    }
    return entry.files
  }

  // Force a re-fetch (e.g. after the user creates files). Keeps the same ref.
  const refresh = (workspaceRoot: string): Ref<FsEntry[]> => {
    const entry = entryFor(workspaceRoot)
    entry.loaded = false
    entry.inFlight = fetchFiles(workspaceRoot, entry).catch(() => undefined)
    return entry.files
  }

  return { ensureLoaded, refresh }
}
