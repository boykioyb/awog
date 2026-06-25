// Resolve the absolute workspace root for a Session in ui-next. A ui-next
// Session carries only a project *name* (e.g. 'awog'), not a path — the real
// root lives in the sidecar projects store. This composable fetches the project
// list once (process-cached), maps name/id → path, and exposes a reactive root
// for the workspace tabs (Diff/Files/Terminal). When the Electron bridge is
// absent (browser-dev) or the project is unknown, `root` stays null and the
// tabs degrade to an empty/disabled state — never throw. SoC: orchestrates IPC
// only, no direct fs/git access.
import { computed, ref, type MaybeRefOrGetter, toValue, watch } from 'vue'
import { useSidecar } from './useSidecar'

// Minimal slice of the sidecar Project shape we need (name/id → path).
export type ProjectDto = { id: string; name: string; path: string }

// Process-wide cache so every tab/session shares one projects.list round-trip.
let cache: ProjectDto[] | null = null
let inflight: Promise<ProjectDto[]> | null = null

// Overwrite the shared process cache with a fresh roster. Called by the projects
// store after a hydrate / CRUD round-trip so every name→path consumer (git,
// sessions, workspace tabs) sees the same truth without an extra projects.list.
export function primeProjectsCache(list: ProjectDto[]): void {
  cache = list
}

// Shared loader (git + workspace tabs) — one cached round-trip per process. The
// projects store keeps this cache in sync via primeProjectsCache on hydrate/CRUD.
export async function loadProjects(): Promise<ProjectDto[]> {
  const sc = useSidecar()
  if (!sc.available) return []
  if (cache) return cache
  if (!inflight) {
    inflight = sc
      .request<{ projects: ProjectDto[] }>('projects.list')
      .then((res) => {
        cache = Array.isArray(res.projects) ? res.projects : []
        return cache
      })
      .catch(() => {
        // Sidecar present but list failed — degrade to "no root" rather than throw.
        return []
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useWorkspaceData(projectName: MaybeRefOrGetter<string | undefined>) {
  const sc = useSidecar()
  const root = ref<string | null>(null)
  const resolving = ref(false)

  async function resolve(): Promise<void> {
    const name = toValue(projectName)
    if (!sc.available || !name) {
      root.value = null
      return
    }
    resolving.value = true
    try {
      const projects = await loadProjects()
      // Match by name first (ui-next stores the display name), then by id as a
      // fallback (engine sessions key projects by id).
      const hit =
        projects.find((p) => p.name === name) ?? projects.find((p) => p.id === name) ?? null
      root.value = hit?.path ?? null
    } finally {
      resolving.value = false
    }
  }

  // Re-resolve when the bound project changes (e.g. user switches session).
  watch(() => toValue(projectName), resolve, { immediate: true })

  return {
    // Absolute workspace root, or null when unresolved (browser-dev / unknown).
    root: computed(() => root.value),
    resolving: computed(() => resolving.value),
    // True only when the engine bridge is present AND a root resolved — gates
    // the real-data tabs; mock/empty fallback otherwise.
    ready: computed(() => sc.available && root.value != null),
    available: sc.available,
    resolve,
  }
}
