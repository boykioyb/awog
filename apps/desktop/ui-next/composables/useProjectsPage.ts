import { computed, onMounted, ref } from 'vue'
import { useProjectsStore } from '~/stores/projects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useI18n } from '~/composables/useI18n'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import { useAgentsStore } from '~/stores/agents'
import { useProjectView } from '~/composables/useProjectView'
import { useProjectActions } from '~/composables/useProjectActions'
import type { Project } from '~/types'

// Page-controller for /projects — owns selection + the hydrate lifecycle and derives
// the per-project overview view-model from the live stores. The CRUD / management
// actions (editor, delete, LLM defaults, templates, open-code/workspace) live in the
// shared useProjectActions composable so the session Project quick-view modal drives
// the exact same flows. Keeps pages/projects.vue a thin template.

export function useProjectsPage() {
  const store = useProjectsStore()
  const sc = useSidecar()
  const { t } = useI18n()
  const { toasts, pushToast, toastColor } = useToasts()

  // Live stores used only to hydrate the read-only overview sources on mount (the
  // derivation itself lives in useProjectView). App-lifetime singletons, re-entry
  // guarded.
  const sessionsStore = useSessionsStore()
  const tasksStore = useTasksStore()
  const agentsStore = useAgentsStore()

  // --- selection -----------------------------------------------------------
  const selectedId = ref<string | null>(null)
  const selected = computed<Project | null>(() => {
    if (selectedId.value) {
      const hit = store.projectById(selectedId.value)
      if (hit) return hit
    }
    return store.projects[0] ?? null
  })
  const selectProject = (p: Project) => {
    selectedId.value = p.id
  }

  // --- overview view-model -------------------------------------------------
  // Derived from the live stores by the shared deriver (also used by the session
  // Project quick-view modal) so both render the same overview from one source.
  const overview = useProjectView(() => selected.value?.id ?? null)

  // --- shared actions (editor / delete / llm / templates / os) -------------
  // Scoped to the selected project; re-selects the saved project after create/clone.
  const actions = useProjectActions({
    currentProject: () => selected.value,
    pushToast,
    onSaved: (saved) => {
      selectedId.value = saved.id
    },
  })

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)
  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await store.hydrate()
      if (!opts.silent) {
        if (!sc.available) pushToast(t('projects.toast.offline'), 'info')
        else pushToast(t('projects.toast.loaded', { n: store.projects.length }), 'info')
      }
    } catch (err) {
      console.error('[projects] refresh failed', err)
      pushToast(t('projects.toast.refreshFail'), 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(async () => {
    await refresh({ silent: true })
    // Best-effort: hydrate the read-only derivation sources so the overview shows
    // counts. Each store guards re-entry; these are app-lifetime singletons.
    if (sc.available) {
      // Scan project-tier agents across every registered project (need the ids
      // resolved post-hydrate so project agents are included, not just global).
      void agentsStore.loadAgents(store.projects.map((p) => p.id))
      void sessionsStore.hydrate?.()
      void tasksStore.loadTasks()
    }
  })

  return {
    // store-backed
    projects: computed(() => store.projects),
    // selection
    selected,
    selectProject,
    overview,
    // hydrate
    refreshing,
    refresh,
    // shared CRUD / management actions + their modal state
    ...actions,
    // toasts
    toasts,
    toastColor,
  }
}
