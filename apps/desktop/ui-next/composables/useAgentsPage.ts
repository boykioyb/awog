import { computed, onMounted, ref } from 'vue'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useConnectionsStore } from '~/stores/connections'
import { useSettingsStore } from '~/stores/settings'
import { useAgentsStore, type Agent } from '~/stores/agents'

// Page-controller for /agents — owns all selection, CRUD, creator, body-edit,
// and delete state so pages/agents.vue stays a thin template. Mirrors the
// reference useSkillsPage, slimmed to the ui-next surface (no bulk select /
// inline rename / context menu — those weren't in the prototype). The MCP
// picker in the editor needs the Connections list, so this hydrates it too.

export function useAgentsPage() {
  const store = useAgentsStore()
  const settings = useSettingsStore()
  const connections = useConnectionsStore()
  const sc = useSidecar()
  const { projects } = useProjects()
  const { toasts, pushToast, toastColor } = useToasts()

  // Project list for the scope picker + tier hints (id/name).
  const projectList = computed(() => projects.value.map((p) => ({ id: p.id, name: p.name })))

  // Provider-agnostic creator account (mirrors Sessions' default resolution); the
  // creator panel reads the full object, the body-edit modal only the id. Null id
  // → the panels surface a "connect an account" message.
  const account = computed(() => settings.resolveCreatorAccount())
  const accountId = computed(() => account.value.accountId)

  // Connections (MCP servers) for the editor whitelist picker — id/name only.
  const mcpServers = computed(() => connections.servers)

  // --- selection -----------------------------------------------------------
  const selectedKey = ref<string | null>(null)
  const selectedAgent = computed<Agent | null>(() => {
    if (selectedKey.value) {
      const hit = store.agentByKey(selectedKey.value)
      if (hit) return hit
    }
    return store.agents[0] ?? null
  })

  const selectAgent = (a: Agent) => {
    selectedKey.value = store.agentKey(a)
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)

  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    const before = store.agents.length
    try {
      const ids = projectList.value.map((p) => p.id)
      // Agents + connections in parallel — the editor's MCP picker needs the
      // connection set in sync.
      await Promise.all([store.loadAgents(ids), connections.loadServers()])
      if (!opts.silent) {
        const delta = store.agents.length - before
        if (!sc.available) pushToast('Engine offline — showing cached agents', 'info')
        else if (delta > 0) pushToast(`Loaded ${store.agents.length} agents (+${delta})`, 'success')
        else pushToast(`Loaded ${store.agents.length} agents`, 'info')
      }
    } catch (err) {
      console.error('[agents] refresh failed', err)
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
  const onCreatorTurn = () => {
    // Each turn may have written an AGENT.md — re-hydrate live (store also
    // re-hydrates on fs-changed, but this is immediate).
    void refresh({ silent: true })
  }
  const onCreatorClose = () => {
    creatorOpen.value = false
    void refresh()
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<Agent | null>(null)
  const openEditor = (a: Agent) => {
    editTarget.value = a
    editorOpen.value = true
  }
  const openCreateForm = () => {
    editTarget.value = null
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
  }
  const onSave = async (payload: { agent: Agent; previousId?: string }) => {
    const isRename = payload.previousId && payload.previousId !== payload.agent.id
    try {
      const saved = await store.saveAgent(payload.agent, payload.previousId)
      selectedKey.value = store.agentKey(saved)
      pushToast(isRename ? `Renamed to ${saved.id}` : `Saved ${saved.id}`, 'success')
    } catch (err) {
      console.error('[agents] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // --- edit system prompt (LLM) -------------------------------------------
  const bodyEditOpen = ref(false)
  const bodyEditTarget = ref<Agent | null>(null)
  const openBodyEdit = (a: Agent) => {
    bodyEditTarget.value = a
    bodyEditOpen.value = true
  }
  const closeBodyEdit = () => {
    bodyEditOpen.value = false
    bodyEditTarget.value = null
  }
  const onApplyBodyEdit = async (updated: Agent) => {
    try {
      const saved = await store.saveAgent(updated)
      selectedKey.value = store.agentKey(saved)
      pushToast('Agent updated', 'success')
    } catch (err) {
      console.error('[agents] body edit save failed', err)
      pushToast('Failed to save edit — see console', 'error')
      return
    }
    closeBodyEdit()
  }

  // --- duplicate -----------------------------------------------------------
  const onDuplicate = async (a: Agent) => {
    try {
      const copy = await store.duplicateAgent(a)
      selectedKey.value = store.agentKey(copy)
      pushToast(`Duplicated to ${copy.id}`, 'success')
    } catch (err) {
      console.error('[agents] duplicate failed', err)
      pushToast(`Duplicate failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<Agent | null>(null)
  const askDelete = (a: Agent) => {
    pendingDelete.value = a
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const a = pendingDelete.value
    if (!a) return ''
    const where = a.source === 'global' ? '~/.awog/agents/' : '.awog/agents/'
    return `This will permanently delete the agent "${a.name}" from ${where}${a.id}.md. Sessions referencing it will fall back to their default system prompt.`
  })
  const confirmDelete = async () => {
    const a = pendingDelete.value
    if (!a) return
    const wasKey = store.agentKey(a)
    pendingDelete.value = null
    try {
      await store.deleteAgent(a.id, a.source, a.projectId)
      if (selectedKey.value === wasKey) {
        selectedKey.value = store.agents[0] ? store.agentKey(store.agents[0]) : null
      }
      pushToast(`Deleted ${a.id}`, 'success')
    } catch (err) {
      console.error('[agents] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  return {
    // store-backed
    agents: computed(() => store.agents),
    agentKey: store.agentKey,
    projectList,
    account,
    accountId,
    mcpServers,
    // selection
    selectedAgent,
    selectAgent,
    // hydrate
    refreshing,
    refresh,
    // create
    creatorOpen,
    creatorScope,
    openCreator,
    openCreateForm,
    onCreatorTurn,
    onCreatorClose,
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
    // duplicate
    onDuplicate,
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
