import type { ConfigKind, ImportCandidate, ImportResult } from '~/types'

// Config Import Assistant (ADR 0035 / config-import-assistant.md). Wraps the
// `migration.*` RPC: scans `.claude`/`.agents` for importable config and copies
// the chosen items into `.awog`, then re-hydrates the affected entity stores.
//
// Scoped per caller (banner + dialog each own one). The composable holds no
// global state — pass a projectId for a project-only scan, or omit for the
// global-only scan (Settings entry / page header).

export type ImportSelection = {
  kind: ConfigKind
  id: string
  targetScope: 'global' | 'project'
  projectId?: string
}

export const KIND_ORDER: ConfigKind[] = ['agent', 'skill', 'hook', 'rule', 'command']

export function useConfigImport() {
  const ws = useWorkspaceStore()

  const candidates = ref<ImportCandidate[]>([])
  const scanning = ref(false)
  const importing = ref(false)

  // How many candidates are not yet in `.awog` (the actionable count the banner
  // headline shows). alreadyExists items are listed but greyed in the dialog.
  const importableCount = computed(() => candidates.value.filter((c) => !c.alreadyExists).length)

  const scan = async (projectId?: string): Promise<void> => {
    const sidecar = useSidecar()
    if (!sidecar.available) {
      candidates.value = []
      return
    }
    scanning.value = true
    try {
      const res = await sidecar.request<{ candidates: ImportCandidate[] }>('migration.scan', {
        ...(projectId ? { projectId } : {}),
      })
      candidates.value = Array.isArray(res.candidates) ? res.candidates : []
    } catch (err) {
      console.warn('[migration] scan failed', err)
      candidates.value = []
    } finally {
      scanning.value = false
    }
  }

  // Re-hydrate only the entity stores whose kinds were imported so the lists
  // reflect the freshly-copied `.awog` files.
  const rehydrate = async (kinds: Set<ConfigKind>): Promise<void> => {
    const jobs: Promise<unknown>[] = []
    if (kinds.has('agent')) jobs.push(ws.hydrateAgentsFromSidecar())
    if (kinds.has('skill')) jobs.push(ws.hydrateSkillsFromSidecar())
    if (kinds.has('hook')) jobs.push(ws.hydrateHooksFromSidecar())
    if (kinds.has('rule')) jobs.push(ws.hydrateRulesFromSidecar())
    if (kinds.has('command')) jobs.push(ws.hydrateCommandsFromSidecar())
    await Promise.all(jobs)
  }

  const importItems = async (
    items: ImportSelection[],
    projectId?: string,
  ): Promise<ImportResult> => {
    const sidecar = useSidecar()
    if (!sidecar.available || items.length === 0) {
      return { imported: [], skipped: [] }
    }
    importing.value = true
    try {
      const res = await sidecar.request<{ result: ImportResult }>('migration.import', {
        ...(projectId ? { projectId } : {}),
        items,
      })
      const result = res.result ?? { imported: [], skipped: [] }
      const importedKinds = new Set(result.imported.map((i) => i.kind))
      if (importedKinds.size > 0) await rehydrate(importedKinds)
      return result
    } finally {
      importing.value = false
    }
  }

  return {
    candidates,
    scanning,
    importing,
    importableCount,
    scan,
    importItems,
  }
}
