import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { useSidecar, SidecarUnavailableError, type UnlistenFn } from '~/composables/useSidecar'
import { useProjects } from '~/composables/useProjects'
import type { FsEntry } from '~/composables/useFsApi'

// Real data sources backing the composer's `/` (commands + skills) and `@`
// (agents + files) autocomplete — replaces the old static mock. Each source is
// fetched lazily on first use and cached at module scope (keyed by project /
// workspace root) so re-opening the menu across composer remounts is free.
//
// SoC: this composable only orchestrates IPC + caching; trigger detection,
// insertion, and command dispatch live in the composer.

// ── Entity shapes (mirror apps/desktop/sidecar/src/types/shared.ts) ───────────
// FsEntry is owned by useFsApi (the fs.* contract layer) — re-imported here.
export type ComposerAgent = {
  id: string
  name: string
  source: 'global' | 'project'
  projectId?: string
}
export type ComposerCommand = {
  id: string
  name: string
  description: string
  body: string
  enabled: boolean
  source: 'global' | 'project'
  projectId?: string
}
export type ComposerSkill = {
  id: string
  name: string
  description: string
  source: 'global' | 'project'
  projectId?: string
}

// ── Module-scope caches (shared across every composer instance) ───────────────
// `refetch` holds the last fetch closure for a key so a fs-changed event can
// re-run it — the catalogs are otherwise loaded exactly once (see invalidate()).
type CacheEntry<T> = {
  items: Ref<T[]>
  loaded: boolean
  inFlight: Promise<void> | null
  refetch: (() => Promise<void>) | null
}
const fileCache = new Map<string, CacheEntry<FsEntry>>()
const agentCache = new Map<string, CacheEntry<ComposerAgent>>()
const commandCache = new Map<string, CacheEntry<ComposerCommand>>()
const skillCache = new Map<string, CacheEntry<ComposerSkill>>()

const entryFor = <T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> => {
  let entry = cache.get(key)
  if (!entry) {
    entry = { items: ref<T[]>([]) as Ref<T[]>, loaded: false, inFlight: null, refetch: null }
    cache.set(key, entry)
  }
  return entry
}

// Clear every cached entry's loaded flag and re-run its last fetch so a skill /
// command / agent created, edited, or deleted outside the composer shows up in
// the `/` and `@` menus without an app reload. Without this the catalogs stay
// frozen at their first-load contents for the whole app lifetime — the dedicated
// /skills, /commands, /agents stores subscribe to these same events, but the
// composer keeps its own module-scope cache and must invalidate it too.
function invalidate<T>(cache: Map<string, CacheEntry<T>>): void {
  for (const entry of cache.values()) {
    entry.loaded = false
    if (entry.refetch) void entry.refetch()
  }
}

// Single module-scope subscription (registered by the first composer instance
// with a live engine) that invalidates the matching catalog on its fs-changed.
let fsUnlisten: UnlistenFn | null = null
let fsSubscribing = false
async function ensureFsSubscription(sc: ReturnType<typeof useSidecar>): Promise<void> {
  if (fsUnlisten || fsSubscribing || !sc.available) return
  fsSubscribing = true
  try {
    fsUnlisten = await sc.onEvent((evt) => {
      if (!evt) return
      if (evt.type === 'skills.fs-changed') invalidate(skillCache)
      else if (evt.type === 'commands.fs-changed') invalidate(commandCache)
      else if (evt.type === 'agents.fs-changed') invalidate(agentCache)
    })
  } catch {
    fsUnlisten = null
  } finally {
    fsSubscribing = false
  }
}

export function useComposerData(projectId: Ref<string | null> | ComputedRef<string | null>) {
  const sc = useSidecar()
  const { projectPath } = useProjects()

  // Keep the `/` + `@` catalogs live when skills/commands/agents change on disk.
  void ensureFsSubscription(sc)

  // Project tier param: pass the bound project id so {project}/.awog agents,
  // commands, skills are scanned alongside the global tier (empty = global only).
  const projectIds = computed<string[]>(() => (projectId.value ? [projectId.value] : []))
  const cacheKey = computed(() => projectId.value ?? '')
  const workspaceRoot = computed(() => (projectId.value ? projectPath(projectId.value) : null))

  // Generic lazy loader: kicks off the fetch on first call, dedupes in-flight
  // requests, and returns the shared reactive list (recomputes when it resolves).
  function ensure<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    fetcher: () => Promise<T[]>,
  ): Ref<T[]> {
    const entry = entryFor(cache, key)
    // Remember how to (re)load this key so a fs-changed event can refresh it.
    entry.refetch = () => {
      if (entry.inFlight) return entry.inFlight
      entry.inFlight = fetcher()
        .then((items) => {
          entry.items.value = items
          entry.loaded = true
        })
        .catch((err) => {
          // Browser dev (no engine) → leave empty; the menu just shows nothing.
          if (!(err instanceof SidecarUnavailableError)) {
            console.warn('[composer-data] load failed', err)
          }
        })
        .finally(() => {
          entry.inFlight = null
        })
      return entry.inFlight
    }
    if (!entry.loaded && !entry.inFlight && sc.available) void entry.refetch()
    return entry.items
  }

  const agents = computed<ComposerAgent[]>(
    () =>
      ensure(agentCache, cacheKey.value, async () => {
        const res = await sc.request<{ agents: ComposerAgent[] }>('agents.list', {
          projectIds: projectIds.value,
        })
        return res.agents
      }).value,
  )

  const userCommands = computed<ComposerCommand[]>(
    () =>
      ensure(commandCache, cacheKey.value, async () => {
        const res = await sc.request<{ commands: ComposerCommand[] }>('commands.list', {
          projectIds: projectIds.value,
        })
        return res.commands
      }).value,
  )

  const skills = computed<ComposerSkill[]>(
    () =>
      ensure(skillCache, cacheKey.value, async () => {
        const res = await sc.request<{ skills: ComposerSkill[] }>('skills.list', {
          projectIds: projectIds.value,
        })
        return res.skills
      }).value,
  )

  const files = computed<FsEntry[]>(() => {
    const root = workspaceRoot.value
    if (!root) return []
    return ensure(fileCache, root, async () => {
      const res = await sc.request<{ files: FsEntry[]; truncated: boolean }>('fs.listFiles', {
        workspaceRoot: root,
      })
      return res.files
    }).value
  })

  // Touch the catalogs / file index so the lazy fetch starts (called by the
  // composer when a `/` or `@` menu first opens).
  const ensureCatalogs = () => {
    void agents.value
    void userCommands.value
    void skills.value
  }
  const ensureFiles = () => {
    void files.value
  }

  return { agents, userCommands, skills, files, ensureCatalogs, ensureFiles }
}
