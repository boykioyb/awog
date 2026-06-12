import type { ConfigKind, ProjectTemplate, TemplateEntityRef } from '~/types'
import { KIND_ORDER } from '~/composables/useConfigImport'
import { useTemplatesStore } from '~/stores/templates'

// A run of template entities sharing a kind — the detail pane groups the
// manifest by kind with a count chip per group.
export type TemplateEntityGroup = {
  kind: ConfigKind
  entities: TemplateEntityRef[]
}

// All Templates-page state + actions (ADR 0036). The page stays a thin template
// binding to this + useTheme(). Toasts come from the shared useToasts().
export function useTemplatesManager() {
  const templatesStore = useTemplatesStore()
  const { toasts, pushToast, toastStyle } = useToasts()

  const searchQuery = ref('')
  const selectedId = ref<string | null>(null)
  const mobilePane = ref<'list' | 'detail'>('list')
  const refreshing = ref(false)

  // Dialog state — Save-from-project (export) + Install + Delete-confirm.
  const saveDialogOpen = ref(false)
  const installDialogOpen = ref(false)
  const pendingDelete = ref<ProjectTemplate | null>(null)

  const filtered = computed<ProjectTemplate[]>(() => {
    const q = searchQuery.value.toLowerCase().trim()
    if (!q) return templatesStore.templates
    return templatesStore.templates.filter(
      (tpl) => tpl.name.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q),
    )
  })

  const selected = computed<ProjectTemplate | undefined>(() =>
    templatesStore.templates.find((tpl) => tpl.id === selectedId.value),
  )

  // Manifest grouped by kind, in the canonical kind order, for the detail pane.
  const selectedGroups = computed<TemplateEntityGroup[]>(() => {
    const tpl = selected.value
    if (!tpl) return []
    const byKind = new Map<ConfigKind, TemplateEntityRef[]>()
    for (const e of tpl.entities) {
      const list = byKind.get(e.kind) ?? []
      list.push(e)
      byKind.set(e.kind, list)
    }
    return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
      kind,
      entities: byKind.get(kind) ?? [],
    }))
  })

  const onSelect = (tpl: ProjectTemplate) => {
    selectedId.value = tpl.id
    mobilePane.value = 'detail'
  }

  const onBack = () => {
    mobilePane.value = 'list'
  }

  const refresh = async () => {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await templatesStore.refresh()
      if (!selectedId.value && templatesStore.templates[0]) {
        selectedId.value = templatesStore.templates[0].id
      }
    } catch (err) {
      console.error('[templates] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  const openSaveDialog = () => {
    saveDialogOpen.value = true
  }

  const openInstallDialog = () => {
    installDialogOpen.value = true
  }

  const onSaved = (e: { name: string; count: number }) => {
    pushToast(`Saved template "${e.name}" (${e.count} entities)`, 'success')
    // Select the newly-created template (store unshifts it to the front).
    if (templatesStore.templates[0]) selectedId.value = templatesStore.templates[0].id
  }

  const onInstalled = (e: { installed: number; skipped: number }) => {
    pushToast(`Installed ${e.installed}, skipped ${e.skipped}`, 'success')
  }

  const askDelete = () => {
    if (selected.value) pendingDelete.value = selected.value
  }

  const confirmDelete = async () => {
    const tpl = pendingDelete.value
    if (!tpl) return
    pendingDelete.value = null
    const wasSelected = selectedId.value === tpl.id
    try {
      await templatesStore.remove(tpl.id)
      if (wasSelected) selectedId.value = templatesStore.templates[0]?.id ?? null
      pushToast(`Deleted "${tpl.name}"`, 'success')
    } catch (err) {
      console.error('[templates] delete failed', err)
      pushToast('Delete failed — see console', 'error')
    }
  }

  onMounted(async () => {
    await templatesStore.hydrate()
    if (!selectedId.value && templatesStore.templates[0]) {
      selectedId.value = templatesStore.templates[0].id
    }
  })

  return {
    // list + selection
    searchQuery,
    filtered,
    selectedId,
    selected,
    selectedGroups,
    mobilePane,
    refreshing,
    onSelect,
    onBack,
    refresh,
    // dialogs
    saveDialogOpen,
    installDialogOpen,
    openSaveDialog,
    openInstallDialog,
    onSaved,
    onInstalled,
    // delete
    pendingDelete,
    askDelete,
    confirmDelete,
    // toasts
    toasts,
    toastStyle,
  }
}
