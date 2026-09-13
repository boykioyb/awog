import { computed, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useProjects } from '~/composables/useProjects'
import { useSidecar } from '~/composables/useSidecar'
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
  const toast = useToast()
  const { t } = useI18n()

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
        if (!sc.available)
          toast.add({ title: 'Engine offline — showing cached agents', color: 'info' })
        else if (delta > 0)
          toast.add({ title: `Loaded ${store.agents.length} agents (+${delta})`, color: 'success' })
        else toast.add({ title: `Loaded ${store.agents.length} agents`, color: 'info' })
      }
    } catch (err) {
      console.error('[agents] refresh failed', err)
      toast.add({ title: 'Refresh failed — see console', color: 'error' })
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    // Silent on entry — the manual refresh button reports counts.
    void refresh({ silent: true })
  })

  // --- config import (ADR 0035) --------------------------------------------
  // The `.claude`/`.agents` picker copied items into `.awog` — re-scan so the
  // freshly imported tiers show up, then report what landed.
  const onImported = async (n: number): Promise<void> => {
    if (!n) {
      toast.add({ title: t('library.import.none'), color: 'info' })
      return
    }
    await refresh({ silent: true })
    toast.add({ title: t('library.import.done', { n }), color: 'success' })
  }

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
      toast.add({
        title: isRename ? `Renamed to ${saved.id}` : `Saved ${saved.id}`,
        color: 'success',
      })
    } catch (err) {
      console.error('[agents] save failed', err)
      toast.add({
        title: `Save failed: ${err instanceof Error ? err.message : 'see console'}`,
        color: 'error',
      })
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
      toast.add({ title: 'Agent updated', color: 'success' })
    } catch (err) {
      console.error('[agents] body edit save failed', err)
      toast.add({ title: 'Failed to save edit — see console', color: 'error' })
      return
    }
    closeBodyEdit()
  }

  // --- duplicate -----------------------------------------------------------
  const onDuplicate = async (a: Agent) => {
    try {
      const copy = await store.duplicateAgent(a)
      selectedKey.value = store.agentKey(copy)
      toast.add({ title: `Duplicated to ${copy.id}`, color: 'success' })
    } catch (err) {
      console.error('[agents] duplicate failed', err)
      toast.add({
        title: `Duplicate failed: ${err instanceof Error ? err.message : 'see console'}`,
        color: 'error',
      })
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
    const where = a.source === 'global' ? '~/.claude/agents/' : '.claude/agents/'
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
      toast.add({ title: `Deleted ${a.id}`, color: 'success' })
    } catch (err) {
      console.error('[agents] delete failed', err)
      toast.add({
        title: `Delete failed: ${err instanceof Error ? err.message : 'see console'}`,
        color: 'error',
      })
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
    // config import
    onImported,
  }
}
