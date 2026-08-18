import { computed, ref } from 'vue'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import type { ImportCandidate } from '~/composables/useConfigImport'
import type { ConfigKind } from '~/stores/templates'

// Library-side config import (ADR 0035 / config-import-assistant §"nút trên trang
// mỗi loại"). `useConfigImport` drives the per-project banner; this one drives the
// import button on a library page (Agents/Skills/Commands/Rules): it scans EVERY
// source scope at once — global `~/.claude`+`~/.agents` plus each project's
// `.claude`/`.agents` — and keeps only the page's own kind.
//
// `migration.scan`/`migration.import` are scope-EXCLUSIVE (a projectId scans only
// that project, no projectId scans only global), so a full sweep is one call per
// scope, fanned out in parallel; imports are grouped back by scope the same way.

export type ImportScopeKey = string // '' = global tier, otherwise a projectId

// Stable identity of a candidate inside the picker (scope + id).
export const candidateKey = (c: ImportCandidate): string =>
  `${c.targetScope}|${c.projectId ?? ''}|${c.id}`

export type ImportGroup = {
  key: ImportScopeKey
  items: ImportCandidate[]
}

export function useLibraryImport(kind: () => ConfigKind) {
  const sc = useSidecar()
  const { projects } = useProjects()

  const candidates = ref<ImportCandidate[]>([])
  const selected = ref<Set<string>>(new Set())
  const scanning = ref(false)
  const importing = ref(false)

  // Candidates bucketed by source scope; global first, then projects in list order.
  const groups = computed<ImportGroup[]>(() => {
    const map = new Map<ImportScopeKey, ImportCandidate[]>()
    for (const c of candidates.value) {
      const key = c.targetScope === 'global' ? '' : (c.projectId ?? '')
      const bucket = map.get(key)
      if (bucket) bucket.push(c)
      else map.set(key, [c])
    }
    return [...map.entries()]
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : a.key.localeCompare(b.key)))
  })

  const allSelected = computed(
    () => candidates.value.length > 0 && selected.value.size === candidates.value.length,
  )

  async function scanScope(projectId?: string): Promise<ImportCandidate[]> {
    try {
      const res = await sc.request<{ candidates: ImportCandidate[] }>(
        'migration.scan',
        projectId ? { projectId } : {},
      )
      return Array.isArray(res.candidates) ? res.candidates : []
    } catch (err) {
      console.warn('[library-import] scan failed', { projectId, err })
      return []
    }
  }

  // Sweep global + every project, keep this page's kind, drop what `.awog` already
  // has, and pre-select everything (the common "pull it all in" path is one click).
  async function scan(): Promise<void> {
    if (!sc.available) {
      candidates.value = []
      selected.value = new Set()
      return
    }
    scanning.value = true
    try {
      const scopes: (string | undefined)[] = [undefined, ...projects.value.map((p) => p.id)]
      const results = await Promise.all(scopes.map((pid) => scanScope(pid)))
      const list = results.flat().filter((c) => c.kind === kind() && !c.alreadyExists)
      candidates.value = list
      selected.value = new Set(list.map(candidateKey))
    } finally {
      scanning.value = false
    }
  }

  function toggle(key: string): void {
    const next = new Set(selected.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selected.value = next
  }

  function toggleAll(): void {
    selected.value = allSelected.value ? new Set() : new Set(candidates.value.map(candidateKey))
  }

  // Import the ticked candidates. One `migration.import` call per source scope
  // (the RPC resolves sources from that scope only). Returns the imported count.
  async function importSelected(): Promise<number> {
    const picked = candidates.value.filter((c) => selected.value.has(candidateKey(c)))
    if (!picked.length || importing.value) return 0
    importing.value = true
    try {
      const byScope = new Map<ImportScopeKey, ImportCandidate[]>()
      for (const c of picked) {
        const key = c.targetScope === 'global' ? '' : (c.projectId ?? '')
        const bucket = byScope.get(key)
        if (bucket) bucket.push(c)
        else byScope.set(key, [c])
      }
      const calls = [...byScope.entries()].map(async ([scopeKey, items]) => {
        const refs = items.map((c) => ({
          kind: c.kind,
          id: c.id,
          targetScope: c.targetScope,
          ...(c.projectId ? { projectId: c.projectId } : {}),
        }))
        try {
          const res = await sc.request<{ result: { imported: unknown[] } }>('migration.import', {
            ...(scopeKey ? { projectId: scopeKey } : {}),
            items: refs,
          })
          return res.result.imported.length
        } catch (err) {
          console.warn('[library-import] import failed', { scopeKey, err })
          return 0
        }
      })
      const counts = await Promise.all(calls)
      return counts.reduce((sum, n) => sum + n, 0)
    } finally {
      importing.value = false
    }
  }

  return {
    candidates,
    groups,
    selected,
    allSelected,
    scanning,
    importing,
    scan,
    toggle,
    toggleAll,
    importSelected,
  }
}
