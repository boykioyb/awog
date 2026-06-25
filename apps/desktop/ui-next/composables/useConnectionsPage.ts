import { computed, onMounted, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSettingsStore } from '~/stores/settings'
import { useConnectionsStore, type McpServer, type McpServerInput } from '~/stores/connections'

// Page-controller for /connections — owns selection, CRUD, creator, and delete
// state so pages/connections.vue stays a thin template. Mirrors useSkillsPage
// (the reference page-controller), adapted to the MCP/Connections surface:
// per-server enable/restart/test + per-tool deny live on the detail; the editor
// drives the env/header secret flow through LibraryKvEditor.

export function useConnectionsPage() {
  const store = useConnectionsStore()
  const settings = useSettingsStore()
  const sc = useSidecar()
  const { toasts, pushToast, toastColor } = useToasts()

  // Active Anthropic account drives the chat-driven creator; null → the panel
  // shows a "connect an account" hint and refuses to send.
  const accountId = computed(() => settings.activeAccount('anthropic')?.id ?? null)

  // --- selection -----------------------------------------------------------
  const selectedId = ref<string | null>(null)
  const selectedServer = computed<McpServer | null>(() => {
    if (selectedId.value) {
      const hit = store.serverById(selectedId.value)
      if (hit) return hit
    }
    return store.mcpServers[0] ?? null
  })
  const selectServer = (s: McpServer) => {
    selectedId.value = s.id
  }

  // --- hydrate -------------------------------------------------------------
  const refreshing = ref(false)
  const refresh = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await store.loadServers()
      if (!opts.silent) {
        if (!sc.available) pushToast('Engine offline — showing cached connections', 'info')
        else pushToast(`Loaded ${store.mcpServers.length} connections`, 'info')
      }
    } catch (err) {
      console.error('[connections] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  onMounted(() => {
    void refresh({ silent: true })
  })

  // --- create (chat-driven) ------------------------------------------------
  const creatorOpen = ref(false)
  const openCreator = () => {
    creatorOpen.value = true
  }
  const onCreatorTurn = () => {
    // Each turn may have written a <slug>.json — re-hydrate live (store also
    // re-hydrates on fs-changed, but this is immediate).
    void refresh({ silent: true })
  }
  const onCreatorClose = () => {
    creatorOpen.value = false
    void refresh()
  }

  // --- edit (form) ---------------------------------------------------------
  const editorOpen = ref(false)
  const editTarget = ref<McpServer | null>(null)
  const openEditor = (s: McpServer) => {
    editTarget.value = s
    editorOpen.value = true
  }
  const openNew = () => {
    editTarget.value = null
    editorOpen.value = true
  }
  const closeEditor = () => {
    editorOpen.value = false
    editTarget.value = null
  }
  const onSave = async (data: McpServerInput) => {
    try {
      const saved = await store.saveServer(data)
      selectedId.value = saved.id
      pushToast(`Saved ${saved.id}`, 'success')
    } catch (err) {
      console.error('[connections] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    closeEditor()
  }

  // --- per-server runtime actions ------------------------------------------
  const onToggle = async (s: McpServer) => {
    try {
      await store.toggleServer(s.id)
    } catch (err) {
      console.error('[connections] toggle failed', err)
      pushToast(`Toggle failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }
  const onRestart = async (s: McpServer) => {
    try {
      await store.restartServer(s.id)
      pushToast(`Restarting ${s.id}…`, 'info')
    } catch (err) {
      console.error('[connections] restart failed', err)
      pushToast(`Restart failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }
  const onToggleTool = async (s: McpServer, toolName: string) => {
    try {
      await store.toggleToolDeny(s.id, toolName)
    } catch (err) {
      console.error('[connections] toggle tool failed', err)
      pushToast('Tool toggle failed — see console', 'error')
    }
  }

  // --- delete --------------------------------------------------------------
  const pendingDelete = ref<McpServer | null>(null)
  const askDelete = (s: McpServer) => {
    pendingDelete.value = s
  }
  const cancelDelete = () => {
    pendingDelete.value = null
  }
  const deleteDescription = computed(() => {
    const s = pendingDelete.value
    if (!s) return ''
    return `This will permanently delete the connection "${s.name}" from ~/.awog/mcp-servers/${s.id}.json and purge any keychain secrets it owns. Agents using it will lose access.`
  })
  const confirmDelete = async () => {
    const s = pendingDelete.value
    if (!s) return
    const wasId = s.id
    pendingDelete.value = null
    try {
      await store.deleteServer(s.id)
      if (selectedId.value === wasId) {
        selectedId.value = store.mcpServers[0]?.id ?? null
      }
      pushToast(`Deleted ${s.id}`, 'success')
    } catch (err) {
      console.error('[connections] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  // Per-server stderr ring buffer (Logs view).
  const stderrOf = (id: string): string[] => store.mcpStderr[id] ?? []

  return {
    // store-backed
    servers: computed(() => store.mcpServers),
    stderrOf,
    accountId,
    available: computed(() => store.available),
    // selection
    selectedServer,
    selectServer,
    // hydrate
    refreshing,
    refresh,
    // create
    creatorOpen,
    openCreator,
    onCreatorTurn,
    onCreatorClose,
    // edit
    editorOpen,
    editTarget,
    openEditor,
    openNew,
    closeEditor,
    onSave,
    // runtime
    onToggle,
    onRestart,
    onToggleTool,
    testServer: store.testServer,
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
