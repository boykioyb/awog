import { computed, ref, watch } from 'vue'
import { SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'
import type { ConfigKind } from '~/stores/templates'

// Config-import assistant (ADR 0035): a project's `.claude`/`.agents` dirs are
// import sources, not live-scanned tiers. This composable scans them via
// `migration.scan` and copies selected items into `.awog` via `migration.import`
// (non-destructive — sources are left untouched, existing entries are skipped).
// Drives the "import from .claude/.agents" banner on the project overview.

export type ImportCandidate = {
  kind: ConfigKind
  id: string
  name: string
  fromLabel: string
  targetScope: 'global' | 'project'
  projectId?: string
  // Already present in the target `.awog` tier → deselected by default + skipped.
  alreadyExists: boolean
}

export function useConfigImport(projectId: () => string | null | undefined) {
  const sc = useSidecar()
  const candidates = ref<ImportCandidate[]>([])
  const scanning = ref(false)
  const importing = ref(false)

  // Only the not-yet-imported items are worth surfacing (existing ones are skipped).
  const importable = computed(() => candidates.value.filter((c) => !c.alreadyExists))

  async function scan(): Promise<void> {
    const pid = projectId()
    if (!pid || !sc.available) {
      candidates.value = []
      return
    }
    scanning.value = true
    try {
      const res = await sc.request<{ candidates: ImportCandidate[] }>('migration.scan', {
        projectId: pid,
      })
      candidates.value = res.candidates
    } catch (err) {
      if (!(err instanceof SidecarUnavailableError))
        console.warn('[config-import] scan failed', err)
      candidates.value = []
    } finally {
      scanning.value = false
    }
  }

  // Import every not-already-existing candidate into `.awog`; returns the count
  // actually imported, then re-scans so the banner reflects the new state.
  async function importAll(): Promise<number> {
    const pid = projectId()
    const items = importable.value
    if (!pid || !items.length || importing.value) return 0
    importing.value = true
    try {
      const refs = items.map((c) => ({
        kind: c.kind,
        id: c.id,
        targetScope: c.targetScope,
        ...(c.projectId ? { projectId: c.projectId } : {}),
      }))
      const res = await sc.request<{ result: { imported: unknown[] } }>('migration.import', {
        projectId: pid,
        items: refs,
      })
      await scan()
      return res.result.imported.length
    } catch (err) {
      console.warn('[config-import] import failed', err)
      return 0
    } finally {
      importing.value = false
    }
  }

  // Re-scan when the bound project changes (immediate for the initial view).
  watch(projectId, () => void scan(), { immediate: true })

  return { candidates, importable, scanning, importing, scan, importAll }
}
