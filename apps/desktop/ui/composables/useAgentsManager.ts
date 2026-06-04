import { Edit3, Trash2 } from 'lucide-vue-next'
import type { Agent, AgentSource, Project } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

// A run of agents sharing a project (or the trailing user/global tiers). The
// list groups by project so it is obvious which project each agent comes from
// — mirrors the Sessions + Skills lists.
export type AgentGroup = {
  key: string
  label: string
  agents: Agent[]
}

// Trailing group for tiers not tied to a project (global, user-claude,
// user-agents). Underscore prefix avoids colliding with a real project id.
const USER_GROUP_KEY = '_user'

// All Agents-page state + actions. The page (pages/agents/index.vue) stays a
// thin template that binds to this + useTheme() for its inline-styled chrome.
// Toasts come from the shared useToasts(); the list row owns its own badges +
// inline rename (components/agent/AgentListItem.vue).
export function useAgentsManager() {
  const ws = useWorkspaceStore()
  const { toasts, pushToast, toastStyle } = useToasts()

  const agentKey = (a: Pick<Agent, 'id' | 'source' | 'projectId'>): string =>
    `${a.source}|${a.projectId ?? ''}|${a.id}`

  const SOURCE_DIR_FOR_DELETE: Record<AgentSource, string> = {
    global: '~/.awog/agents/',
    'user-claude': '~/.claude/agents/',
    'user-agents': '~/.agents/agents/',
    'project-claude': '.claude/agents/',
    'project-agents': '.agents/agents/',
  }

  const selectedKey = ref<string | null>(ws.agents[0] ? agentKey(ws.agents[0]) : null)
  const editing = ref(false)
  const bodyEditing = ref(false)
  const bodyEditAnchor = ref<{ top: number; left: number } | null>(null)
  const searchQuery = ref('')
  const confirmDelete = ref<Agent | null>(null)
  const showPromptModal = ref(false)
  const newButtonRef = ref<HTMLButtonElement | null>(null)
  const anchor = ref<{ top: number; left: number } | null>(null)
  const mobilePane = ref<'list' | 'detail'>('list')
  const refreshing = ref(false)

  const filtered = computed<Agent[]>(() => {
    const q = searchQuery.value.toLowerCase()
    if (!q) return ws.agents
    return ws.agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q),
    )
  })

  // Group filtered agents by project (project-claude / project-agents carry a
  // projectId); user-level + global tiers fall into one trailing group. Project
  // groups come first in store order, empty groups are dropped.
  const grouped = computed<AgentGroup[]>(() => {
    const map = new Map<string, AgentGroup>()
    ws.projects.forEach((p: Project) => map.set(p.id, { key: p.id, label: p.name, agents: [] }))
    map.set(USER_GROUP_KEY, { key: USER_GROUP_KEY, label: 'User & Global', agents: [] })
    filtered.value.forEach((a: Agent) => {
      const target = a.projectId ? map.get(a.projectId) : map.get(USER_GROUP_KEY)
      ;(target ?? map.get(USER_GROUP_KEY))?.agents.push(a)
    })
    return Array.from(map.values()).filter((g: AgentGroup) => g.agents.length > 0)
  })

  // Bulk selection — Set of composite agentKey() strings. Independent of
  // `selectedKey` (single-item navigation) so a user can keep their detail-pane
  // selection while ticking other rows. Same pattern as Skills page.
  const bulkSelection = ref<Set<string>>(new Set())
  const bulkPendingDelete = ref<Agent[] | null>(null)
  const bulkDeleting = ref(false)

  const toggleBulk = (a: Agent) => {
    const key = agentKey(a)
    const next = new Set(bulkSelection.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    bulkSelection.value = next
  }

  const clearBulk = () => {
    bulkSelection.value = new Set()
  }

  const allFilteredSelected = computed(() => {
    if (filtered.value.length === 0) return false
    return filtered.value.every((a) => bulkSelection.value.has(agentKey(a)))
  })

  const someFilteredSelected = computed(() =>
    filtered.value.some((a) => bulkSelection.value.has(agentKey(a))),
  )

  const toggleSelectAllFiltered = () => {
    const next = new Set(bulkSelection.value)
    if (allFilteredSelected.value) {
      // Drop only filtered keys so search-filtered ticks on hidden rows stay.
      filtered.value.forEach((a) => next.delete(agentKey(a)))
    } else {
      filtered.value.forEach((a) => next.add(agentKey(a)))
    }
    bulkSelection.value = next
  }

  const bulkSelectedAgents = computed<Agent[]>(() =>
    ws.agents.filter((a) => bulkSelection.value.has(agentKey(a))),
  )

  const bulkDeleteDescription = computed(() => {
    const list = bulkPendingDelete.value
    if (!list || list.length === 0) return ''
    const sample = list
      .slice(0, 5)
      .map((a) => `${SOURCE_DIR_FOR_DELETE[a.source]}${a.id}.md`)
      .join('\n')
    const more = list.length > 5 ? `\n…and ${list.length - 5} more` : ''
    return `This will permanently delete ${list.length} agent file(s):\n\n${sample}${more}\n\nSessions referencing them will fall back to their default system prompt.`
  })

  const askBulkDelete = () => {
    if (bulkSelection.value.size === 0) return
    bulkPendingDelete.value = [...bulkSelectedAgents.value]
  }

  const confirmBulkDelete = async () => {
    const list = bulkPendingDelete.value
    if (!list || list.length === 0) return
    bulkPendingDelete.value = null
    bulkDeleting.value = true
    const wasSelectedKey = selectedKey.value
    let ok = 0
    const failures: { agent: Agent; err: unknown }[] = []
    // Sequential: sidecar RPC single-threaded per request, also keeps per-agent
    // failure attribution clean (same as Skills bulk delete).
    await list.reduce(async (prev, a) => {
      await prev
      try {
        await ws.deleteAgent(a.id, a.source, a.projectId)
        ok += 1
        bulkSelection.value.delete(agentKey(a))
      } catch (err) {
        failures.push({ agent: a, err })
      }
    }, Promise.resolve())
    bulkSelection.value = new Set(bulkSelection.value)
    if (wasSelectedKey && !ws.agents.some((a) => agentKey(a) === wasSelectedKey)) {
      selectedKey.value = ws.agents[0] ? agentKey(ws.agents[0]) : null
    }
    bulkDeleting.value = false
    if (failures.length === 0) {
      pushToast(`Deleted ${ok} agent${ok === 1 ? '' : 's'}`, 'success')
    } else if (ok === 0) {
      pushToast(`Bulk delete failed for ${failures.length} agent(s) — see console`, 'error')
    } else {
      pushToast(`Deleted ${ok}, failed ${failures.length} — see console for failed items`, 'info')
    }
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[agents] bulk delete failures', failures)
    }
  }

  const refreshTitle = computed(() => {
    const projectCount = ws.projects.length
    const scope = projectCount > 0 ? `${projectCount} project(s) + user dirs` : 'user dirs only'
    return `Refresh agents from filesystem (${scope})`
  })

  const sleep = (ms: number) =>
    new Promise<void>((r) => {
      setTimeout(r, ms)
    })

  const refresh = async (opts: { silent?: boolean } = {}) => {
    if (refreshing.value) return
    refreshing.value = true
    const before = ws.agents.length
    try {
      // Re-pull projects too — user may have linked a new project since the
      // page mounted, which would otherwise be invisible to the agent scan.
      await ws.hydrateProjectsFromSidecar()
      // Min visible spinner duration so the click registers visually even when
      // the local-mode hydrate completes in a few ms. MCP servers hydrate in
      // parallel so the AgentEditor Connections picker stays in sync.
      await Promise.all([ws.hydrateAgentsFromSidecar(), ws.hydrateMcpFromSidecar(), sleep(350)])
      if (!selectedKey.value && ws.agents[0]) selectedKey.value = agentKey(ws.agents[0])
      if (!opts.silent) {
        const after = ws.agents.length
        const delta = after - before
        if (delta > 0) pushToast(`Loaded ${after} agents (+${delta} new)`, 'success')
        else if (delta < 0) pushToast(`Loaded ${after} agents (${delta} removed)`, 'info')
        else pushToast(`No changes · ${after} agents`, 'info')
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agents] refresh failed', err)
      pushToast('Refresh failed — see console', 'error')
    } finally {
      refreshing.value = false
    }
  }

  const onRefresh = () => {
    refresh()
  }

  const selectedAgent = computed<Agent | undefined>(() =>
    ws.agents.find((a) => agentKey(a) === selectedKey.value),
  )

  const deleteDescription = computed(() => {
    const a = confirmDelete.value
    if (!a) return ''
    return `This will permanently delete the agent "${a.name}" from ${SOURCE_DIR_FOR_DELETE[a.source]}${a.id}.md. Sessions referencing it will fall back to their default system prompt.`
  })

  const onSelect = (a: Agent) => {
    selectedKey.value = agentKey(a)
    editing.value = false
    mobilePane.value = 'detail'
  }

  const startCreate = () => {
    editing.value = false
    const rect = newButtonRef.value?.getBoundingClientRect()
    anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
    showPromptModal.value = true
  }

  const onBack = () => {
    mobilePane.value = 'list'
    editing.value = false
  }

  const onSave = async (payload: { agent: Agent; previousId?: string } | Agent) => {
    // AgentEditor emits a plain Agent today; keep the union for symmetry with
    // Skills which emits { skill, previousId } for slug rename.
    const data = 'agent' in payload ? payload.agent : payload
    const previousId = 'agent' in payload ? payload.previousId : undefined
    const isRename = previousId && previousId !== data.id
    try {
      const saved = await ws.saveAgent(data, previousId)
      selectedKey.value = agentKey(saved)
      pushToast(isRename ? `Renamed to ${saved.id}` : `Saved ${saved.id}`, 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agents] save failed', err)
      pushToast(`Save failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    editing.value = false
    mobilePane.value = 'detail'
  }

  const onEditBody = (at: { top: number; left: number } | null) => {
    bodyEditAnchor.value = at
    bodyEditing.value = true
  }

  const onApplyBodyEdit = async (updated: Agent) => {
    try {
      const saved = await ws.saveAgent(updated)
      selectedKey.value = agentKey(saved)
      pushToast('Agent updated', 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agents] body edit save failed', err)
      pushToast('Failed to save edit — see console', 'error')
      return
    }
    bodyEditing.value = false
  }

  const onClosePromptModal = async () => {
    showPromptModal.value = false
    // LLM may have written a new AGENT.md to disk — pull fresh state so it shows
    // up + becomes selected.
    const beforeKeys = new Set(ws.agents.map(agentKey))
    await ws.hydrateAgentsFromSidecar()
    const fresh = ws.agents.find((a) => !beforeKeys.has(agentKey(a)))
    if (fresh) {
      selectedKey.value = agentKey(fresh)
      mobilePane.value = 'detail'
      pushToast(`Created ${fresh.id}`, 'success')
    }
  }

  const onDuplicate = async () => {
    if (!selectedAgent.value) return
    try {
      const created = await ws.duplicateAgent(selectedAgent.value)
      selectedKey.value = agentKey(created)
      mobilePane.value = 'detail'
      pushToast(`Duplicated to ${created.id}`, 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agents] duplicate failed', err)
      pushToast(`Duplicate failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  const onDelete = async () => {
    const target = confirmDelete.value
    if (!target) return
    confirmDelete.value = null
    const wasSelectedKey = selectedKey.value
    try {
      await ws.deleteAgent(target.id, target.source, target.projectId)
      pushToast(`Deleted ${target.id}`, 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agents] delete failed', err)
      pushToast(`Delete failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
      return
    }
    if (wasSelectedKey === agentKey(target)) {
      selectedKey.value = ws.agents[0] ? agentKey(ws.agents[0]) : null
    }
  }

  const contextMenu = ref<{ x: number; y: number; agent: Agent } | null>(null)
  const renamingKey = ref<string | null>(null)

  const onContextMenu = (e: MouseEvent, agent: Agent) => {
    e.preventDefault()
    contextMenu.value = { x: e.clientX, y: e.clientY, agent }
  }

  const openMenuFromButton = (e: MouseEvent, agent: Agent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    contextMenu.value = { x: rect.right, y: rect.bottom + 4, agent }
  }

  const startRename = (agent: Agent) => {
    renamingKey.value = agentKey(agent)
  }

  const onRename = async (target: Agent, raw: string) => {
    renamingKey.value = null
    const trimmed = raw.trim()
    if (!trimmed || trimmed === target.name) return
    try {
      await ws.saveAgent({ ...target, name: trimmed })
      pushToast(`Renamed to "${trimmed}"`, 'success')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[agents] rename failed', err)
      pushToast(`Rename failed: ${err instanceof Error ? err.message : 'see console'}`, 'error')
    }
  }

  const cancelRename = () => {
    renamingKey.value = null
  }

  const menuItems = computed<ContextMenuItem[]>(() => {
    const ctx = contextMenu.value
    if (!ctx) return []
    return [
      { label: 'Rename', icon: Edit3, action: () => startRename(ctx.agent) },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        action: () => {
          confirmDelete.value = ctx.agent
        },
      },
    ]
  })

  onMounted(async () => {
    // Pull projects first so project-tier scans have a path to walk.
    await ws.hydrateProjectsFromSidecar()
    // Agents + MCP servers run in parallel — the MCP set is needed by
    // AgentEditor's Connections picker. Without this, opening Edit shows
    // "No MCP servers yet" even when servers are configured.
    await Promise.all([ws.hydrateAgentsFromSidecar(), ws.hydrateMcpFromSidecar()])
    if (!selectedKey.value && ws.agents[0]) selectedKey.value = agentKey(ws.agents[0])
  })

  return {
    // list + selection
    agentKey,
    searchQuery,
    filtered,
    grouped,
    selectedKey,
    selectedAgent,
    mobilePane,
    editing,
    refreshing,
    refreshTitle,
    newButtonRef,
    anchor,
    onSelect,
    startCreate,
    onRefresh,
    onBack,
    // create / edit
    showPromptModal,
    onClosePromptModal,
    onSave,
    onDuplicate,
    bodyEditing,
    bodyEditAnchor,
    onEditBody,
    onApplyBodyEdit,
    // single delete
    confirmDelete,
    deleteDescription,
    onDelete,
    // bulk select + delete
    bulkSelection,
    bulkPendingDelete,
    bulkDeleting,
    bulkDeleteDescription,
    allFilteredSelected,
    someFilteredSelected,
    toggleBulk,
    clearBulk,
    toggleSelectAllFiltered,
    askBulkDelete,
    confirmBulkDelete,
    // context menu + rename
    contextMenu,
    menuItems,
    renamingKey,
    onContextMenu,
    openMenuFromButton,
    startRename,
    onRename,
    cancelRename,
    // toasts
    toasts,
    toastStyle,
  }
}
