// Project list helper for config surfaces (Sessions + every library scope picker).
// A ui-next Session stores the engine *projectId* in `session.project`; those
// surfaces need the human NAME and (for the session context menu) the on-disk
// PATH. This composable is a thin reactive view over the projects store
// (stores/projects.ts) — the single home for the Project entity — exposing the
// stable `{ projects, projectName, projectPath }` shape its many consumers bind.
// SoC: IPC only (via the store); the list is empty without the bridge.
import { computed } from 'vue'
import { useI18n } from './useI18n'
import { useProjectsStore } from '~/stores/projects'

export type ProjectOption = { id: string; name: string }

export function useProjects() {
  const { t } = useI18n()
  const store = useProjectsStore()

  // Hydrate once per process (the store guards re-entry via `loaded`). Fire and
  // forget — consumers read the reactive list as it fills.
  if (store.available && !store.loaded) void store.hydrate()

  const projects = computed<ProjectOption[]>(() =>
    store.projects.map((p) => ({ id: p.id, name: p.name })),
  )

  // Resolve an engine projectId → display name. Empty id = no project assigned
  // (a freshly-created session) → a "Default" label; unknown id → the id itself.
  const projectName = (id: string): string => {
    if (!id) return t('sessions.defaultProject')
    return store.projects.find((p) => p.id === id)?.name ?? id
  }

  // Resolve an engine projectId → absolute on-disk path, or null when unknown
  // (a tilde-prefixed path is still returned as stored). Used by the
  // session context menu (copy path / open in Finder).
  const projectPath = (id: string): string | null => {
    if (!id) return null
    return store.projects.find((p) => p.id === id)?.path ?? null
  }

  return { projects, projectName, projectPath }
}
