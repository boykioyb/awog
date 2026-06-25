// Real projects for the Sessions config surface. A ui-next Session stores the
// engine *projectId* in `session.project`; the UI needs the human NAME. This
// composable exposes the project list (id + name) and a resolver `projectName(id)`
// that maps an id → name (falling back to the id itself if unknown). It reuses the
// SAME process-wide cache as useWorkspaceData (one projects.list round-trip per
// process). When the Electron bridge is absent (browser-dev) it falls back to the
// mock PROJECTS strings — where id and name are the same value. SoC: IPC only.
import { computed, ref } from 'vue'
import { useI18n } from './useI18n'
import { useSessionsMock } from './useSessionsMock'
import { useSidecar } from './useSidecar'
import { loadProjects, type ProjectDto } from './useWorkspaceData'

export type ProjectOption = { id: string; name: string }

export function useProjects() {
  const sc = useSidecar()
  const { t } = useI18n()
  const { PROJECTS } = useSessionsMock()

  // Mock fallback (browser-dev): id === name for the seed strings.
  const mockOptions: ProjectOption[] = PROJECTS.map((name) => ({ id: name, name }))

  const real = ref<ProjectDto[]>([])
  if (sc.available) void loadProjects().then((list) => (real.value = list))

  const projects = computed<ProjectOption[]>(() =>
    sc.available && real.value.length
      ? real.value.map((p) => ({ id: p.id, name: p.name }))
      : mockOptions,
  )

  // Resolve an engine projectId → display name. Empty id = no project assigned
  // (a freshly-created session) → a "Default" label; unknown id → the id itself.
  const projectName = (id: string): string => {
    if (!id) return t('sessions.defaultProject')
    return projects.value.find((p) => p.id === id)?.name ?? id
  }

  // Resolve an engine projectId → absolute on-disk path, or null when unknown
  // (browser-dev mock has no path). Used by the session context menu (copy path /
  // open in Finder).
  const projectPath = (id: string): string | null => {
    if (!id) return null
    return real.value.find((p) => p.id === id)?.path ?? null
  }

  return { projects, projectName, projectPath }
}
