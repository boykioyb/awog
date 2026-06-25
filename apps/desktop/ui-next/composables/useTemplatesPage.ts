import { computed, onMounted, ref } from 'vue'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import {
  useTemplatesStore,
  type ProjectTemplate,
  type TemplateFetchResult,
} from '~/stores/templates'

// Page-controller for /templates — owns dialog + delete state + hydrate so
// pages/templates.vue stays a thin template. Mirrors the ui-next reference
// page-controller (useSkillsPage); templates are NOT chat-created so there is no
// creator panel — three dialogs (Install / Save-as / Fetch-from-GitHub) instead.
//
// Selection lives inside <LibraryView> (it owns its own selectedKey + auto-selects
// the first row). The store unshifts newly created/fetched bundles to the front,
// so LibraryView's first-row auto-select lands on them naturally — we don't drive
// its selection from here.

export function useTemplatesPage() {
  const store = useTemplatesStore()
  const sc = useSidecar()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()

  // Project roster (id + name) for the Save-as / Install pickers.
  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // Stable list key for <LibraryView> (template ids are unique on disk).
  const templateKey = (tpl: ProjectTemplate): string => tpl.id

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)

  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await store.loadTemplates()
      if (!opts.silent) {
        if (!sc.available) pushToast('Engine offline — showing cached templates', 'info')
        else pushToast(`Loaded ${store.templates.length} templates`, 'info')
      }
    } catch (err) {
      console.error('[templates] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    void store.loadTemplates()
  })

  // --- dialogs -------------------------------------------------------------
  const saveDialogOpen = ref(false)
  const fetchDialogOpen = ref(false)
  const installDialogOpen = ref(false)

  const openSaveDialog = () => {
    saveDialogOpen.value = true
  }
  const openFetchDialog = () => {
    fetchDialogOpen.value = true
  }
  const closeSaveDialog = () => {
    saveDialogOpen.value = false
  }
  const closeFetchDialog = () => {
    fetchDialogOpen.value = false
  }
  const closeInstallDialog = () => {
    installDialogOpen.value = false
  }

  // Install acts on the explicitly-passed template (the detail's row) — fixing
  // its picker — vs the generic entry where the user picks one in the dialog.
  const installFixedTemplateId = ref<string | undefined>(undefined)
  const openInstallFor = (tpl: ProjectTemplate) => {
    installFixedTemplateId.value = tpl.id
    installDialogOpen.value = true
  }

  const onSaved = (e: { name: string; count: number }) => {
    pushToast(
      `Saved template "${e.name}" (${e.count} ${e.count === 1 ? 'entity' : 'entities'})`,
      'success',
    )
  }

  // After a GitHub fetch: imported bundles are already in the store list. If
  // exactly one was imported open Install right away (the bundle is at the front,
  // so it is the auto-selected row too).
  const onFetched = (result: TemplateFetchResult) => {
    const { imported, skipped } = result
    const first = imported[0]
    if (imported.length === 1 && first) {
      pushToast(`Fetched "${first.name}"`, 'success')
      installFixedTemplateId.value = first.id
      installDialogOpen.value = true
    } else if (imported.length > 1) {
      pushToast(`Fetched ${imported.length} templates (${skipped.length} skipped)`, 'success')
    } else {
      pushToast(`Nothing imported (${skipped.length} skipped)`, 'error')
    }
  }

  const onInstalled = (e: { installed: number; skipped: number }) => {
    pushToast(`Installed ${e.installed}, skipped ${e.skipped}`, 'success')
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<ProjectTemplate | null>(null)
  const askDelete = (tpl: ProjectTemplate) => {
    pendingDelete.value = tpl
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const confirmDelete = async () => {
    const tpl = pendingDelete.value
    if (!tpl) return
    pendingDelete.value = null
    try {
      await store.remove(tpl.id)
      pushToast(`Deleted "${tpl.name}"`, 'success')
    } catch (err) {
      console.error('[templates] delete failed', err)
      pushToast('Delete failed — see console', 'error')
    }
  }

  return {
    // store-backed
    templates: computed(() => store.templates),
    projectList,
    templateKey,
    // hydrate
    refreshing,
    refresh,
    // dialogs
    saveDialogOpen,
    fetchDialogOpen,
    installDialogOpen,
    installFixedTemplateId,
    openSaveDialog,
    openFetchDialog,
    openInstallFor,
    closeSaveDialog,
    closeFetchDialog,
    closeInstallDialog,
    onSaved,
    onFetched,
    onInstalled,
    // delete
    pendingDelete,
    askDelete,
    cancelDelete,
    confirmDelete,
    // toasts
    toasts,
    toastColor,
  }
}
