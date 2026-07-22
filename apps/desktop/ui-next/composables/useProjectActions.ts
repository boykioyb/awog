import { computed, ref } from 'vue'
import {
  useProjectsStore,
  type ProjectInspectResult,
  type RemoteInspectResult,
} from '~/stores/projects'
import { useTemplatesStore } from '~/stores/templates'
import { useSidecar } from '~/composables/useSidecar'
import { useI18n } from '~/composables/useI18n'
import { useAgentsStore } from '~/stores/agents'
import { pickFolder } from '~/composables/useFolderPicker'
import type { ToastKind } from '~/composables/useToasts'
import type { Project } from '~/types'
import type { ProjectEditorSavePayload } from '~/components/project/types'

// Shared project action controller — owns the editor (create / edit), per-project
// LLM defaults, delete-confirm, template (save-as / install), config-import, and OS
// (open code / open workspace) flows plus the modal state that drives them. Extracted
// from useProjectsPage so BOTH the /projects page and the session Project quick-view
// modal drive the same actions from one source (SoC: no page selection / hydrate
// lifecycle here — those stay in the page-controller).
//
// Toast-agnostic: the caller injects `pushToast` (and renders its own queue) so this
// composable never assumes where messages surface. `currentProject` scopes the
// template dialogs (which target "the" project). `onSaved` lets the caller react to a
// create/clone/update (e.g. the page re-selects the saved project); the quick-view
// omits it — store.updateProject already re-renders its store-derived project.

export type UseProjectActionsOptions = {
  currentProject: () => Project | null
  pushToast: (text: string, kind?: ToastKind) => void
  onSaved?: (saved: Project) => void
}

export function useProjectActions(opts: UseProjectActionsOptions) {
  const store = useProjectsStore()
  const templatesStore = useTemplatesStore()
  const agentsStore = useAgentsStore()
  const sc = useSidecar()
  const { t } = useI18n()
  const { pushToast } = opts

  // --- config import (banner) ----------------------------------------------
  // `.claude`/`.agents` copied into `.awog`: confirm + re-hydrate so counts (and
  // project-tier agents) reflect the import. Shared so the quick-view's Overview
  // banner works too.
  const onImported = async (n: number): Promise<void> => {
    if (n > 0) pushToast(t('projects.toast.imported', { n }), 'success')
    try {
      await store.hydrate()
    } catch (err) {
      console.error('[projects] re-hydrate after import failed', err)
    }
    if (sc.available) void agentsStore.loadAgents(store.projects.map((p) => p.id))
  }

  // --- editor (create / edit) ----------------------------------------------
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
      let saved: Project
      if (payload.kind === 'update') {
        saved = await store.updateProject(payload.project)
        pushToast(t('projects.toast.saved', { name: saved.name }), 'success')
      } else if (payload.kind === 'link') {
        saved = await store.linkProject({
          name: payload.data.name,
          path: payload.data.path,
          description: payload.data.description,
          language: payload.data.language,
          gitRemote: payload.data.gitRemote,
          gitBranch: payload.data.gitBranch,
        })
        pushToast(t('projects.toast.linked', { name: saved.name }), 'success')
      } else {
        editorProgress.value = t('projects.editor.cloning')
        saved = await store.cloneProject({
          name: payload.data.name,
          destPath: payload.data.path,
          gitRemote: payload.data.gitRemote,
          description: payload.data.description,
          language: payload.data.language,
        })
        pushToast(t('projects.toast.cloned', { name: saved.name }), 'success')
      }
      opts.onSaved?.(saved)
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
  const inspectRemote = (gitRemote: string): Promise<RemoteInspectResult | null> =>
    store.inspectRemote(gitRemote)
  const generateDescription = (input: {
    name: string
    language?: string
    gitRemote?: string
    hint?: string
  }): Promise<string | null> => store.generateDescription(input)
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
    opts.onSaved?.(saved)
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
      pushToast(t('projects.toast.deleted', { name: p.name }), 'success')
    } catch (err) {
      console.error('[projects] delete failed', err)
      pushToast(t('projects.toast.deleteFail'), 'error')
    }
  }

  // --- OS integration ------------------------------------------------------
  // Open the project's code workspace (folder) in VS Code, falling back to the OS
  // file manager when `code` is unavailable. No-op in browser-dev.
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

  // Open the in-app Monaco code workspace for this project (/code/:id route). Carry
  // the current route as `from` so the code page's Back returns to where we came from
  // (the session quick-view opens this over /sessions, /projects over /projects).
  const router = useRouter()
  const openWorkspace = (p: Project) => {
    const from = router.currentRoute.value.fullPath
    void navigateTo({ path: `/code/${p.id}`, query: { from } })
  }

  // --- templates (save-as / install) ---------------------------------------
  // Both dialogs target the current project: we hand each a single-entry `projects`
  // list (the current project) so its target/source picker is pre-selected and
  // effectively locked to it.
  const templateProjects = computed<{ id: string; name: string }[]>(() => {
    const p = opts.currentProject()
    return p ? [{ id: p.id, name: p.name }] : []
  })

  const saveTemplateOpen = ref(false)
  const installTemplateOpen = ref(false)

  const openSaveTemplate = () => {
    if (!opts.currentProject()) return
    saveTemplateOpen.value = true
  }
  const closeSaveTemplate = () => {
    saveTemplateOpen.value = false
  }
  const onTemplateSaved = (e: { name: string; count: number }) => {
    pushToast(t('projects.toast.templateSaved', { name: e.name, count: e.count }), 'success')
  }

  const openInstallTemplate = async () => {
    if (!opts.currentProject()) return
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
    // config import
    onImported,
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
    inspectRemote,
    generateDescription,
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
    // templates
    templateProjects,
    saveTemplateOpen,
    installTemplateOpen,
    openSaveTemplate,
    closeSaveTemplate,
    onTemplateSaved,
    openInstallTemplate,
    closeInstallTemplate,
    onTemplateInstalled,
  }
}
