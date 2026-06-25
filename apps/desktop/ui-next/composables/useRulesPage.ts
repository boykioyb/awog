import { computed, onMounted, ref } from 'vue'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import { useRulesStore, type Rule } from '~/stores/rules'

// Page-controller for /rules — owns all selection, CRUD, creator, toggle, and
// delete state so pages/rules.vue stays a thin template. Mirrors the reference
// useSkillsPage, adapted to the Rules surface (an `enabled` toggle replaces the
// duplicate action; the creator drafts via the one-shot rules.generate RPC,
// since the sidecar has no streaming rules.author method).

export function useRulesPage() {
  const store = useRulesStore()
  const settings = useSettingsStore()
  const sc = useSidecar()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()

  // Project list for the scope picker + tier hints (id/name).
  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // The active Anthropic account id drives the LLM creator/body-edit flows; null
  // → the panels fall back to a friendly "connect an account" message.
  const accountId = computed(() => settings.activeAccount('anthropic')?.id ?? null)

  // --- selection -----------------------------------------------------------
  const selectedKey = ref<string | null>(null)
  const selectedRule = computed<Rule | null>(() => {
    if (selectedKey.value) {
      const hit = store.ruleByKey(selectedKey.value)
      if (hit) return hit
    }
    return store.rules[0] ?? null
  })

  const selectRule = (r: Rule) => {
    selectedKey.value = store.ruleKey(r)
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)

  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    const before = store.rules.length
    try {
      const ids = projectList.value.map((p) => p.id)
      await store.loadRules(ids)
      if (!opts.silent) {
        const delta = store.rules.length - before
        if (!sc.available) pushToast('Engine offline — showing cached rules', 'info')
        else if (delta > 0) pushToast(`Loaded ${store.rules.length} rules (+${delta})`, 'success')
        else pushToast(`Loaded ${store.rules.length} rules`, 'info')
      }
    } catch (err) {
      console.error('[rules] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    // Silent on entry — the manual refresh button reports counts.
    void refresh({ silent: true })
  })

  // --- create (chat-driven, one-shot rules.generate) -----------------------
  const creatorOpen = ref(false)
  // Initial scope for the creator's tier picker — 'global' or a projectId, set by
  // the per-group "+" so creating inside a project group preselects that tier.
  const creatorScope = ref('global')
  const openCreator = (scope: string = 'global') => {
    creatorScope.value = scope
    creatorOpen.value = true
  }
  const closeCreator = () => {
    creatorOpen.value = false
  }
  const onCreatorSave = async (payload: { rule: Rule }) => {
    try {
      const saved = await store.saveRule(payload.rule)
      selectedKey.value = store.ruleKey(saved)
      pushToast(`Saved ${saved.name}`, 'success')
    } catch (err) {
      console.error('[rules] create failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeCreator()
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Rule | null>(null)
  const openEditor = (r: Rule) => {
    editTarget.value = r
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
  }
  const onSave = async (payload: { rule: Rule; previousId?: string }) => {
    const isRename = payload.previousId && payload.previousId !== payload.rule.id
    try {
      const saved = await store.saveRule(payload.rule, payload.previousId)
      selectedKey.value = store.ruleKey(saved)
      pushToast(isRename ? `Renamed to ${saved.name}` : `Saved ${saved.name}`, 'success')
    } catch (err) {
      console.error('[rules] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // --- edit body (LLM revise) ----------------------------------------------
  const bodyEditOpen = ref(false)
  const bodyEditTarget = ref<Rule | null>(null)
  const openBodyEdit = (r: Rule) => {
    bodyEditTarget.value = r
    bodyEditOpen.value = true
  }
  const closeBodyEdit = () => {
    bodyEditOpen.value = false
    bodyEditTarget.value = null
  }
  const onApplyBodyEdit = async (updated: Rule) => {
    try {
      const saved = await store.saveRule(updated)
      selectedKey.value = store.ruleKey(saved)
      pushToast('Rule updated', 'success')
    } catch (err) {
      console.error('[rules] body edit save failed', err)
      pushToast('Failed to save edit — see console', 'error')
      return
    }
    closeBodyEdit()
  }

  // --- toggle (auto-inject on/off) -----------------------------------------
  const onToggle = (r: Rule) => {
    void store.toggleRule(r.id, r.source, r.projectId)
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Rule | null>(null)
  const askDelete = (r: Rule) => {
    pendingDelete.value = r
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const r = pendingDelete.value
    if (!r) return ''
    const where = r.source === 'global' ? '~/.awog/rules/' : '.awog/rules/'
    return `This will permanently delete the rule "${r.name}" from ${where}${r.id}.md. Sessions and tasks will no longer inject it.`
  })
  const confirmDelete = async () => {
    const r = pendingDelete.value
    if (!r) return
    const wasKey = store.ruleKey(r)
    pendingDelete.value = null
    try {
      await store.deleteRule(r.id, r.source, r.projectId)
      if (selectedKey.value === wasKey) {
        selectedKey.value = store.rules[0] ? store.ruleKey(store.rules[0]) : null
      }
      pushToast(`Deleted ${r.name}`, 'success')
    } catch (err) {
      console.error('[rules] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  return {
    // store-backed
    rules: computed(() => store.rules),
    ruleKey: store.ruleKey,
    projectList,
    accountId,
    // selection
    selectedRule,
    selectRule,
    // hydrate
    refreshing,
    refresh,
    // create
    creatorOpen,
    creatorScope,
    openCreator,
    closeCreator,
    onCreatorSave,
    // edit
    editorOpen,
    editTarget,
    openEditor,
    closeEditor,
    onSave,
    // body edit
    bodyEditOpen,
    bodyEditTarget,
    openBodyEdit,
    closeBodyEdit,
    onApplyBodyEdit,
    // toggle
    onToggle,
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
