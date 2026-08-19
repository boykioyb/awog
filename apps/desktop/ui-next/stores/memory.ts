import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// AI memory store (ADR 0073 part B) — durable facts the agent accumulates (when
// the user opts in) and the user curates in Settings → Memory. One fact per file
// under `~/.awog/memory` (global) or `{project}/.awog/memory` (project tier);
// `memory.fs-changed` re-hydrates when a file changes outside the app.
//
// `description` is the fact in one line and is what reaches the prompt; `body` is
// optional detail the agent pulls with `memory_read`.

export type MemorySource = 'global' | 'project'
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

export const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']

export type MemoryFact = {
  id: string
  source: MemorySource
  projectId?: string
  name: string
  description: string
  body: string
  type: MemoryType
  enabled: boolean
  updatedAt: number
}

export type MemoryScanReport = {
  dir: string
  source: MemorySource
  projectId?: string
  found: number
}

export type MemoryInput = {
  id?: string
  source: MemorySource
  projectId?: string
  name: string
  description: string
  body?: string
  type?: MemoryType
  enabled?: boolean
}

type MemoryListResponse = { facts: MemoryFact[]; reports?: MemoryScanReport[] }

// Composite identity — (source, projectId, id).
export const memoryKey = (f: Pick<MemoryFact, 'id' | 'source' | 'projectId'>): string =>
  `${f.source}|${f.projectId ?? ''}|${f.id}`

export const useMemoryStore = defineStore('memory', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const facts = ref<MemoryFact[]>([])
  const scanReports = ref<MemoryScanReport[]>([])
  const loaded = ref(false)
  const lastError = ref('')

  let lastProjectIds: string[] = []
  let unlisten: UnlistenFn | null = null

  // Characters the memory index costs per turn, estimated the way the sidecar
  // builds it (one line per enabled fact). Shown in Settings so the price of
  // remembering is visible rather than a mystery on the token bill.
  const indexChars = computed(() =>
    facts.value
      .filter((f) => f.enabled)
      .reduce((sum, f) => sum + f.name.length + f.description.length + 4, 0),
  )
  const enabledCount = computed(() => facts.value.filter((f) => f.enabled).length)

  const byType = computed<Record<MemoryType, MemoryFact[]>>(() => {
    const out: Record<MemoryType, MemoryFact[]> = {
      user: [],
      feedback: [],
      project: [],
      reference: [],
    }
    for (const fact of facts.value) out[fact.type].push(fact)
    return out
  })

  async function loadMemory(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    lastProjectIds = projectIds ?? lastProjectIds
    try {
      const ids = lastProjectIds
      const res = await sc.request<MemoryListResponse>(
        'memory.list',
        ids.length > 0 ? { projectIds: ids } : {},
      )
      facts.value = Array.isArray(res.facts) ? res.facts : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      console.warn('[memory] loadMemory failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  async function saveFact(input: MemoryInput): Promise<MemoryFact | null> {
    if (!available.value) return null
    try {
      const res = await sc.request<{ fact: MemoryFact }>('memory.upsert', input)
      const existing = facts.value.find((f) => memoryKey(f) === memoryKey(res.fact))
      if (existing) Object.assign(existing, res.fact)
      else facts.value.push(res.fact)
      lastError.value = ''
      return res.fact
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  async function deleteFact(
    fact: Pick<MemoryFact, 'id' | 'source' | 'projectId'>,
  ): Promise<boolean> {
    if (!available.value) return false
    const key = memoryKey(fact)
    try {
      const params: Record<string, unknown> = { id: fact.id, source: fact.source }
      if (fact.projectId) params.projectId = fact.projectId
      await sc.request('memory.delete', params)
      facts.value = facts.value.filter((f) => memoryKey(f) !== key)
      lastError.value = ''
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async function toggleFact(fact: MemoryFact): Promise<void> {
    if (!available.value) return
    const next = !fact.enabled
    fact.enabled = next // optimistic; the sidecar rewrites the frontmatter
    try {
      const params: Record<string, unknown> = {
        id: fact.id,
        source: fact.source,
        enabled: next,
      }
      if (fact.projectId) params.projectId = fact.projectId
      await sc.request('memory.toggle', params)
      lastError.value = ''
    } catch (err) {
      fact.enabled = !next // revert
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  // Forget everything in one tier. Destructive — callers confirm first.
  async function clearTier(source: MemorySource, projectId?: string): Promise<number> {
    if (!available.value) return 0
    try {
      const params: Record<string, unknown> = { source }
      if (projectId) params.projectId = projectId
      const res = await sc.request<{ deleted: number }>('memory.clear', params)
      await loadMemory()
      lastError.value = ''
      return res.deleted
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return 0
    }
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'memory.fs-changed') return
        void loadMemory()
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    facts,
    scanReports,
    loaded,
    available,
    lastError,
    // getters
    byType,
    indexChars,
    enabledCount,
    // actions
    loadMemory,
    saveFact,
    deleteFact,
    toggleFact,
    clearTier,
  }
})
