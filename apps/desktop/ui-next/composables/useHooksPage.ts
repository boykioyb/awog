import { computed, onMounted, ref } from 'vue'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import { useHooksStore, type Hook, type HookConfig } from '~/stores/hooks'

// Page-controller for /hooks — owns all selection, CRUD, creator, run/toggle/
// trust, and delete state so pages/hooks.vue stays a thin template. Mirrors the
// reference useSkillsPage, extended for the richer hook surface (enabled toggle,
// run-once smoke test, project-tier trust gate, run audit).

export function useHooksPage() {
  const store = useHooksStore()
  const settings = useSettingsStore()
  const sc = useSidecar()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()

  // Project list for the scope picker + tier hints (id/name).
  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // Provider-agnostic creator account (mirrors Sessions' default resolution); the
  // creator panel reads the full object, the config/script modals only the id.
  // Null id → the panels surface a "connect an account" message.
  const account = computed(() => settings.resolveCreatorAccount())
  const accountId = computed(() => account.value.accountId)

  // --- selection -----------------------------------------------------------
  const selectedKey = ref<string | null>(null)
  const selectedHook = computed<Hook | null>(() => {
    if (selectedKey.value) {
      const hit = store.hookByKey(selectedKey.value)
      if (hit) return hit
    }
    return store.hooks[0] ?? null
  })

  const selectHook = (h: Hook) => {
    selectedKey.value = store.hookKey(h)
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)

  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    const before = store.hooks.length
    try {
      const ids = projectList.value.map((p) => p.id)
      await store.loadHooks(ids)
      if (!opts.silent) {
        const delta = store.hooks.length - before
        if (!sc.available) pushToast('Engine offline — showing cached hooks', 'info')
        else if (delta > 0) pushToast(`Loaded ${store.hooks.length} hooks (+${delta})`, 'success')
        else pushToast(`Loaded ${store.hooks.length} hooks`, 'info')
      }
    } catch (err) {
      console.error('[hooks] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    // Silent on entry — the manual refresh button reports counts.
    void refresh({ silent: true })
  })

  // --- create (chat-driven) ------------------------------------------------
  const creatorOpen = ref(false)
  // Initial scope for the creator's tier picker — 'global' or a projectId, set by
  // the per-group "+" so creating inside a project group preselects that tier.
  const creatorScope = ref('global')
  const openCreator = (scope: string = 'global') => {
    creatorScope.value = scope
    creatorOpen.value = true
  }
  const onCreatorClose = () => {
    creatorOpen.value = false
    void refresh()
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Hook | null>(null)
  // A creator-handoff draft for a NEW hook ("Edit details"). Passed as the
  // editor's `initialDraft` (NOT `editTarget`) so the tier picker stays editable.
  const seededDraft = ref<Hook | null>(null)
  const openEditor = (h: Hook) => {
    editTarget.value = h
    seededDraft.value = null
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
    seededDraft.value = null
  }
  const onSave = async (hook: Hook) => {
    const isUpdate = !!editTarget.value
    try {
      const saved = await store.saveHook(hook)
      selectedKey.value = store.hookKey(saved)
      pushToast(isUpdate ? `Saved ${saved.name}` : `Created ${saved.name}`, 'success')
    } catch (err) {
      console.error('[hooks] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // Creator → editor handoff: "Edit details" closes the creator and opens the
  // full form seeded with the LLM draft (tier picker stays editable).
  const onCreatorEditManually = (hook: Hook) => {
    creatorOpen.value = false
    editTarget.value = null
    seededDraft.value = hook
    editorOpen.value = true
  }
  // Save straight from the creator preview.
  const onCreatorSave = async (hook: Hook) => {
    creatorOpen.value = false
    await onSave(hook)
  }

  // --- LLM config / script edit (triggered from inside the editor) ---------
  // The editor exposes its live draft hook + script context; these modals revise
  // them via one-shot generate and feed the result back through pendingConfig /
  // pendingScript, which the editor watches and merges into its draft.
  const configEditOpen = ref(false)
  const configEditHook = ref<Hook | null>(null)
  const pendingConfig = ref<HookConfig | null>(null)
  const openConfigEdit = (hook: Hook) => {
    configEditHook.value = hook
    pendingConfig.value = null
    configEditOpen.value = true
  }
  const closeConfigEdit = () => {
    configEditOpen.value = false
    configEditHook.value = null
  }
  const onApplyConfig = (config: HookConfig) => {
    pendingConfig.value = config
    closeConfigEdit()
  }

  const scriptEditOpen = ref(false)
  const scriptEditCtx = ref<{ path: string; command: string; content: string } | null>(null)
  const pendingScript = ref<string | null>(null)
  const openScriptEdit = (ctx: { path: string; command: string; content: string }) => {
    scriptEditCtx.value = ctx
    pendingScript.value = null
    scriptEditOpen.value = true
  }
  const closeScriptEdit = () => {
    scriptEditOpen.value = false
    scriptEditCtx.value = null
  }
  const onApplyScript = (content: string) => {
    pendingScript.value = content
    closeScriptEdit()
  }

  // --- enabled toggle ------------------------------------------------------
  const onToggle = async (h: Hook) => {
    try {
      await store.toggleHook(h)
    } catch (err) {
      console.error('[hooks] toggle failed', err)
      pushToast('Toggle failed — see console', 'error')
    }
  }

  // --- run once (smoke test) ----------------------------------------------
  const running = ref<string | null>(null)
  const onRunOnce = async (h: Hook) => {
    running.value = store.hookKey(h)
    try {
      await store.runHookOnce(h)
      const last = h.recentRuns[0]
      if (last && last.exitCode === 0)
        pushToast(`Ran ${h.name} · OK (${last.durationMs}ms)`, 'success')
      else if (last) pushToast(`Ran ${h.name} · exit ${last.exitCode}`, 'error')
      else pushToast(`Ran ${h.name}`, 'info')
    } catch (err) {
      console.error('[hooks] run-once failed', err)
      pushToast(`Run failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    } finally {
      running.value = null
    }
  }

  // --- trust (project-tier gate, ADR 0032 D-8) -----------------------------
  const onTrust = async (h: Hook) => {
    if (!h.projectId) return
    try {
      await store.trustHooks(h.projectId, [h.id])
      pushToast(`Trusted ${h.name}`, 'success')
    } catch (err) {
      console.error('[hooks] trust failed', err)
      pushToast('Trust failed — see console', 'error')
    }
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Hook | null>(null)
  const askDelete = (h: Hook) => {
    pendingDelete.value = h
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const h = pendingDelete.value
    if (!h) return ''
    const where = (h.source ?? 'global') === 'global' ? '~/.awog/hooks/' : '.awog/hooks/'
    return `This will permanently delete the hook "${h.name}" from ${where}. It will no longer run on ${h.event}.`
  })
  const confirmDelete = async () => {
    const h = pendingDelete.value
    if (!h) return
    const wasKey = store.hookKey(h)
    pendingDelete.value = null
    try {
      await store.deleteHook(h.id, h.source, h.projectId)
      if (selectedKey.value === wasKey) {
        selectedKey.value = store.hooks[0] ? store.hookKey(store.hooks[0]) : null
      }
      pushToast(`Deleted ${h.name}`, 'success')
    } catch (err) {
      console.error('[hooks] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  return {
    // store-backed
    hooks: computed(() => store.hooks),
    hookKey: store.hookKey,
    projectList,
    account,
    accountId,
    // selection
    selectedHook,
    selectHook,
    // hydrate
    refreshing,
    refresh,
    // create
    creatorOpen,
    creatorScope,
    openCreator,
    onCreatorClose,
    onCreatorEditManually,
    onCreatorSave,
    // edit
    editorOpen,
    editTarget,
    seededDraft,
    openEditor,
    closeEditor,
    onSave,
    // LLM config / script edit
    configEditOpen,
    configEditHook,
    pendingConfig,
    openConfigEdit,
    closeConfigEdit,
    onApplyConfig,
    scriptEditOpen,
    scriptEditCtx,
    pendingScript,
    openScriptEdit,
    closeScriptEdit,
    onApplyScript,
    // toggle / run / trust
    onToggle,
    running,
    onRunOnce,
    onTrust,
    // delete
    pendingDelete,
    askDelete,
    cancelDelete,
    deleteDescription,
    confirmDelete,
    // toasts
    toasts,
    toastColor,
  }
}
