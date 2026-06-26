import { computed, onMounted, ref } from 'vue'
import { useProjectsStore, type ProjectInspectResult } from '~/stores/projects'
import { useTemplatesStore } from '~/stores/templates'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useI18n } from '~/composables/useI18n'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import { useAgentsStore } from '~/stores/agents'
import { useGitStore } from '~/stores/git'
import { pickFolder } from '~/composables/useFolderPicker'
import { githubSlugFromRemote, type ProjectRepo, type ProjectView } from '~/components/project/data'
import type { Project } from '~/types'
import type { ProjectEditorSavePayload } from '~/components/project/types'

// Page-controller for /projects — owns selection, CRUD (link / clone / edit /
// delete), the LLM-defaults modal, and derives the per-project overview view-model
// from the live stores. Keeps pages/projects.vue a thin template. Mirrors the
// reference useSkillsPage page-controller idiom.

export function useProjectsPage() {
  const store = useProjectsStore()
  // Cross-store: the templates store backs the Save-as / Install entry points
  // launched from a project's detail header (read/import only — owned elsewhere).
  const templatesStore = useTemplatesStore()
  const sc = useSidecar()
  const { t } = useI18n()
  const { toasts, pushToast, toastColor } = useToasts()

  // Live stores used only to derive overview counts (read-only). The git store is
  // NOT re-pointed here (that would disturb the Git page's active project) — its
  // dirty/ahead numbers are surfaced only for the project it already tracks.
  const sessionsStore = useSessionsStore()
  const tasksStore = useTasksStore()
  const agentsStore = useAgentsStore()
  const gitStore = useGitStore()

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
  // A session counts toward a project when its `project` (name string) matches
  // the project name (ui-next sessions carry the display name). Tasks key by
  // projectId. Agents are the project-tier agents registered under this project.
  const overview = computed<ProjectView | null>(() => {
    const p = selected.value
    if (!p) return null

    const ghSlug = githubSlugFromRemote(p.gitRemote)

    // Single-repo derivation from the entity. Dirty/ahead are surfaced only when
    // the Git page already tracks this project (no cross-page mutation here).
    const repos: ProjectRepo[] = []
    if (p.gitRemote || p.gitBranch) {
      const tracksThis = gitStore.currentProjectId === p.id
      const repo: ProjectRepo = {
        n: p.name,
        br: tracksThis && gitStore.branch ? gitStore.branch : p.gitBranch || 'main',
      }
      if (ghSlug) repo.gh = ghSlug
      if (tracksThis) {
        const dirty = gitStore.staged.length + gitStore.unstaged.length
        if (dirty > 0) repo.dirty = dirty
        if (gitStore.ahead > 0) repo.ahead = gitStore.ahead
      }
      repos.push(repo)
    }

    const projectAgents = agentsStore.agents
      .filter((a) => a.source === 'project' && a.projectId === p.id)
      .map((a) => a.name || a.id)

    const sessions = sessionsStore.sessions.filter(
      (s) => s.project === p.id || s.project === p.name,
    )
    const ses = sessions.slice(0, 6).map((s) => ({ id: s.id, t: s.title, w: s.when }))
    const anyRunning = sessions.some((s) => s.status === 'streaming' || s.status === 'awaiting')

    const tasks = tasksStore.tasks
      .filter((task) => task.projectId === p.id)
      .filter((task) => task.status === 'running' || task.status === 'waiting_approval')
      .slice(0, 6)
      .map((task) => ({ t: task.title, s: task.status }))

    return {
      id: p.id,
      name: p.name,
      path: p.path,
      status: anyRunning || tasks.length > 0 ? 'active' : 'idle',
      gh: ghSlug,
      repos,
      agents: projectAgents,
      ses,
      tasks,
    }
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

  // --- editor (create / edit) ---------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Project | null>(null)
  const editorBusy = ref(false)
  const editorError = ref('')
  const editorProgress = ref('')

  const openCreate = () => {
    editTarget.value = null
    editorError.value = ''
    editorProgress.value = ''
    editorOpen.value = true
  }
  const openEdit = (p: Project) => {
    editTarget.value = p
    editorError.value = ''
    editorProgress.value = ''
    editorOpen.value = true
  }
  const closeEditor = () => {
    if (editorBusy.value) return
    editorOpen.value = false
    editTarget.value = null
  }

  const onSave = async (payload: ProjectEditorSavePayload) => {
    editorError.value = ''
    editorBusy.value = true
    try {
      if (payload.kind === 'update') {
        const saved = await store.updateProject(payload.project)
        selectedId.value = saved.id
        pushToast(t('projects.toast.saved', { name: saved.name }), 'success')
      } else if (payload.kind === 'link') {
        const saved = await store.linkProject({
          name: payload.data.name,
          path: payload.data.path,
          description: payload.data.description,
          language: payload.data.language,
          gitRemote: payload.data.gitRemote,
          gitBranch: payload.data.gitBranch,
        })
        selectedId.value = saved.id
        pushToast(t('projects.toast.linked', { name: saved.name }), 'success')
      } else {
        editorProgress.value = t('projects.editor.cloning')
        const saved = await store.cloneProject({
          name: payload.data.name,
          destPath: payload.data.path,
          gitRemote: payload.data.gitRemote,
          description: payload.data.description,
          language: payload.data.language,
        })
        selectedId.value = saved.id
        pushToast(t('projects.toast.cloned', { name: saved.name }), 'success')
      }
    } catch (err) {
      editorError.value = err instanceof Error ? err.message : String(err)
      editorBusy.value = false
      return
    }
    editorBusy.value = false
    editorOpen.value = false
    editTarget.value = null
    editorProgress.value = ''
  }

  // Inspect + folder-pick proxies the editor uses.
  const inspectPath = (path: string): Promise<ProjectInspectResult | null> =>
    store.inspectPath(path)
  const browseFolder = (title: string): Promise<string | null> => pickFolder({ title })
  const canBrowse = computed(() => sc.available)

  // --- LLM defaults modal --------------------------------------------------
  const llmOpen = ref(false)
  const llmTarget = ref<Project | null>(null)
  const openLlm = (p: Project) => {
    llmTarget.value = p
    llmOpen.value = true
  }
  const closeLlm = () => {
    llmOpen.value = false
    llmTarget.value = null
  }
  const onLlmSaved = async (saved: Project) => {
    selectedId.value = saved.id
    pushToast(t('projects.toast.llmSaved', { name: saved.name }), 'success')
    closeLlm()
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Project | null>(null)
  const askDelete = (p: Project) => {
    pendingDelete.value = p
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const p = pendingDelete.value
    if (!p) return ''
    return t('projects.delete.body', { name: p.name })
  })
  const confirmDelete = async () => {
    const p = pendingDelete.value
    if (!p) return
    pendingDelete.value = null
    try {
      await store.deleteProject(p.id)
      if (selectedId.value === p.id) {
        selectedId.value = store.projects[0]?.id ?? null
      }
      pushToast(t('projects.toast.deleted', { name: p.name }), 'success')
    } catch (err) {
      console.error('[projects] delete failed', err)
      pushToast(t('projects.toast.deleteFail'), 'error')
    }
  }

  // --- OS integration ------------------------------------------------------
  // Open the project's code workspace (folder) in VS Code, falling back to the
  // OS file manager when `code` is unavailable. No-op in browser-dev.
  const openCode = async (p: Project) => {
    if (!sc.available) return
    try {
      const hasVscode = await sc.isVscodeAvailable()
      if (hasVscode) await sc.openInVscode(p.path, '.')
      else await sc.openPath(p.path, '.')
    } catch (err) {
      console.warn('[projects] openCode failed', err)
      pushToast(t('projects.toast.openCodeFail'), 'error')
    }
  }

  // Open the in-app Monaco code workspace for this project (/code/:id route).
  const openWorkspace = (p: Project) => {
    void navigateTo(`/code/${p.id}`)
  }

  // --- templates (save-as / install) ---------------------------------------
  // Both dialogs target the current project: we hand each a single-entry
  // `projects` list (the selected project) so its target/source picker is
  // pre-selected and effectively locked to it — the ui-next dialogs default
  // their pick to `projects[0]` and expose no fixed-project prop.
  const templateProjects = computed<{ id: string; name: string }[]>(() => {
    const p = selected.value
    return p ? [{ id: p.id, name: p.name }] : []
  })

  const saveTemplateOpen = ref(false)
  const installTemplateOpen = ref(false)

  const openSaveTemplate = () => {
    if (!selected.value) return
    saveTemplateOpen.value = true
  }
  const closeSaveTemplate = () => {
    saveTemplateOpen.value = false
  }
  const onTemplateSaved = (e: { name: string; count: number }) => {
    pushToast(t('projects.toast.templateSaved', { name: e.name, count: e.count }), 'success')
  }

  const openInstallTemplate = async () => {
    if (!selected.value) return
    // Ensure the dialog's template picker has options to show.
    if (!templatesStore.loaded) await templatesStore.loadTemplates()
    installTemplateOpen.value = true
  }
  const closeInstallTemplate = () => {
    installTemplateOpen.value = false
  }
  const onTemplateInstalled = (e: { installed: number; skipped: number }) => {
    pushToast(
      t('projects.toast.templateInstalled', { installed: e.installed, skipped: e.skipped }),
      'success',
    )
  }

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
    // editor
    editorOpen,
    editTarget,
    editorBusy,
    editorError,
    editorProgress,
    openCreate,
    openEdit,
    closeEditor,
    onSave,
    inspectPath,
    browseFolder,
    canBrowse,
    // llm
    llmOpen,
    llmTarget,
    openLlm,
    closeLlm,
    onLlmSaved,
    // delete
    pendingDelete,
    askDelete,
    cancelDelete,
    deleteDescription,
    confirmDelete,
    // os
    openCode,
    openWorkspace,
    // templates (save-as / install)
    templateProjects,
    saveTemplateOpen,
    installTemplateOpen,
    openSaveTemplate,
    closeSaveTemplate,
    onTemplateSaved,
    openInstallTemplate,
    closeInstallTemplate,
    onTemplateInstalled,
    // toasts
    toasts,
    toastColor,
  }
}
