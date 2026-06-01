<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="selectedKey"
    list-width="20rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search agents..." />
        <button
          class="flex items-center gap-1 px-2 py-1.5 text-[1em] rounded transition"
          :style="{
            background: 'transparent',
            color: t.textMuted,
            border: `1px solid ${t.border}`,
          }"
          :title="refreshTitle"
          :disabled="refreshing"
          @click="onRefresh"
        >
          <RefreshCw :size="12" :class="refreshing ? 'animate-spin' : ''" />
        </button>
        <button
          ref="newButtonRef"
          class="flex items-center gap-1 px-2.5 py-1.5 text-[1em] rounded font-medium transition"
          :style="{ background: t.accent, color: t.accentText }"
          @click="startCreate"
        >
          <Plus :size="12" />
          New
        </button>
      </div>
      <div
        v-if="filtered.length > 0"
        class="px-3 py-1.5 flex items-center gap-2 text-[1em]"
        :style="{ borderBottom: `1px solid ${t.border}`, color: t.textDim }"
      >
        <input
          type="checkbox"
          :checked="allFilteredSelected"
          :indeterminate.prop="someFilteredSelected && !allFilteredSelected"
          class="cursor-pointer"
          :style="{ accentColor: t.accent }"
          :title="allFilteredSelected ? 'Deselect all visible' : 'Select all visible'"
          @click="toggleSelectAllFiltered"
        />
        <span v-if="bulkSelection.size > 0" :style="{ color: t.text }">
          {{ bulkSelection.size }} selected
        </span>
        <span v-else>Select to bulk-delete</span>
        <span class="flex-1" />
        <button
          v-if="bulkSelection.size > 0"
          class="text-[1em] inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition"
          :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
          @click="clearBulk"
        >
          Clear
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="agent in filtered"
          :key="agentKey(agent)"
          class="w-full px-3 py-2.5 text-left cursor-pointer transition"
          :style="{
            background: selectedKey === agentKey(agent) ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedKey === agentKey(agent) ? t.accent : 'transparent'}`,
          }"
          @click="onSelect(agent)"
          @contextmenu="onContextMenu($event, agent)"
          @mouseenter="
            (e: MouseEvent) => {
              if (selectedKey !== agentKey(agent))
                (e.currentTarget as HTMLElement).style.background = t.bgHover
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              if (selectedKey !== agentKey(agent))
                (e.currentTarget as HTMLElement).style.background = 'transparent'
            }
          "
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <input
                type="checkbox"
                :checked="bulkSelection.has(agentKey(agent))"
                class="cursor-pointer flex-shrink-0"
                :style="{ accentColor: t.accent }"
                :title="
                  bulkSelection.has(agentKey(agent)) ? 'Remove from selection' : 'Add to selection'
                "
                @click.stop="toggleBulk(agent)"
              />
              <input
                v-if="renamingKey === agentKey(agent)"
                :ref="setRenameInputRef"
                v-model="renameValue"
                class="text-[1em] font-medium flex-1 min-w-0 rounded px-1 py-0.5"
                :style="{
                  background: t.bgInput,
                  border: `1px solid ${t.borderStrong}`,
                  color: t.text,
                  outline: 'none',
                }"
                @click.stop
                @keydown.enter="commitRename"
                @keydown.escape="cancelRename"
                @blur="commitRename"
              />
              <div
                v-else
                class="text-[1em] font-medium truncate"
                :style="{ color: t.text }"
                @dblclick.stop="startRename(agent)"
              >
                {{ agent.name }}
              </div>
              <span
                v-if="agent.role"
                class="text-[1em] uppercase tracking-wider font-semibold flex-shrink-0 px-1 py-0.5 rounded"
                :style="{
                  color: t.textMuted,
                  background: t.bgInput,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ agent.role }}
              </span>
              <button
                class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
                :style="{ color: t.textMuted }"
                title="Actions"
                @click.stop="openMenuFromButton($event, agent)"
              >
                <MoreHorizontal :size="13" />
              </button>
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-[1em] truncate flex-1 min-w-0" :style="{ color: t.textDim }">
                {{ modelLabel(agent) }} · {{ agent.skillIds.length }}
                {{ agent.skillIds.length === 1 ? 'skill' : 'skills' }}
              </span>
              <span
                class="text-[0.7em] px-1 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap flex-shrink-0"
                :style="sourceBadgeStyle(agent)"
              >
                {{ sourceLabel(agent) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <AgentEditor
        v-if="editing && selectedAgent"
        :agent="selectedAgent"
        @save="onSave"
        @cancel="editing = false"
      />
      <AgentDetail
        v-else-if="selectedAgent"
        :agent="selectedAgent"
        @edit="editing = true"
        @edit-body="onEditBody"
        @duplicate="onDuplicate"
        @delete="confirmDelete = selectedAgent"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Users" title="Select an agent or create a new one" />
    </template>
  </MasterDetailShell>

  <AgentPromptCreator v-if="showPromptModal" :anchor="anchor" @close="onClosePromptModal" />

  <AgentBodyEditModal
    v-if="bodyEditing && selectedAgent"
    :agent="selectedAgent"
    :anchor="bodyEditAnchor"
    @apply="onApplyBodyEdit"
    @cancel="bodyEditing = false"
  />

  <ConfirmDeleteModal
    v-if="confirmDelete"
    :title="`Delete agent &quot;${confirmDelete.name}&quot;?`"
    :description="deleteDescription"
    @confirm="onDelete"
    @cancel="confirmDelete = null"
  />

  <ConfirmDeleteModal
    v-if="bulkPendingDelete"
    :title="`Delete ${bulkPendingDelete.length} agents?`"
    :description="bulkDeleteDescription"
    @confirm="confirmBulkDelete"
    @cancel="bulkPendingDelete = null"
  />

  <div
    v-if="bulkSelection.size > 0"
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full shadow-lg flex items-center gap-3 px-4 py-2"
    :style="{
      background: t.bgPanel,
      border: `1px solid ${t.borderStrong}`,
      boxShadow: `0 12px 32px ${t.shadow}`,
    }"
  >
    <span class="text-[1em]" :style="{ color: t.text }">
      {{ bulkSelection.size }} agent{{ bulkSelection.size === 1 ? '' : 's' }} selected
    </span>
    <button
      class="text-[1em] inline-flex items-center gap-1.5 px-2.5 py-1 rounded transition"
      :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
      :disabled="bulkDeleting"
      @click="clearBulk"
    >
      Cancel
    </button>
    <button
      class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium transition"
      :style="{
        background: t.dangerBg,
        color: t.danger,
        border: `1px solid ${t.dangerBorder}`,
      }"
      :disabled="bulkDeleting"
      @click="askBulkDelete"
    >
      <Loader2 v-if="bulkDeleting" :size="11" class="animate-spin" />
      <Trash2 v-else :size="11" />
      Delete {{ bulkSelection.size }}
    </button>
  </div>

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />

  <div
    v-if="toasts.length > 0"
    class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[360px]"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="px-3 py-2 rounded text-[1em] shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Edit3, Loader2, MoreHorizontal, Plus, RefreshCw, Trash2, Users } from 'lucide-vue-next'
import type { Agent, AgentSource } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import { MODELS } from '~/utils/models'

const { t } = useTheme()
const ws = useWorkspaceStore()

const agentKey = (a: Pick<Agent, 'id' | 'source' | 'projectId'>): string =>
  `${a.source}|${a.projectId ?? ''}|${a.id}`

const SOURCE_LABEL: Record<AgentSource, string> = {
  global: '~/.awog',
  'user-claude': '~/.claude',
  'user-agents': '~/.agents',
  'project-claude': '.claude',
  'project-agents': '.agents',
}

const SOURCE_DIR_FOR_DELETE: Record<AgentSource, string> = {
  global: '~/.awog/agents/',
  'user-claude': '~/.claude/agents/',
  'user-agents': '~/.agents/agents/',
  'project-claude': '.claude/agents/',
  'project-agents': '.agents/agents/',
}

const sourceLabel = (a: Agent): string => {
  // Project-tier badge shows just the project name so users can tell which repo
  // a project-scoped agent comes from. The tier (.claude/.agents) is conveyed by
  // the accent styling, so the redundant suffix is dropped to keep the tag compact.
  if (a.source === 'project-claude' || a.source === 'project-agents') {
    const project = a.projectId ? ws.projects.find((p) => p.id === a.projectId) : undefined
    return project?.name ?? a.projectId ?? '?'
  }
  return SOURCE_LABEL[a.source]
}

const isProjectAgent = (a: Agent): boolean =>
  a.source === 'project-claude' || a.source === 'project-agents'

// Quiet tag: muted bg for all; project-scoped gets accent text + border instead
// of a loud solid fill so the list reads calmer.
const sourceBadgeStyle = (a: Agent): CSSProperties => {
  const highlight = isProjectAgent(a)
  return {
    background: t.value.bgInput,
    color: highlight ? t.value.accent : t.value.textDim,
    border: `1px solid ${highlight ? t.value.accent : t.value.border}`,
  }
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

type ToastKind = 'info' | 'success' | 'error'
const toasts = ref<{ id: string; text: string; kind: ToastKind }[]>([])

const pushToast = (text: string, kind: ToastKind = 'info') => {
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts.value = [...toasts.value, { id, text, kind }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((tt) => tt.id !== id)
  }, 3200)
}

const toastStyle = (kind: ToastKind): CSSProperties => {
  if (kind === 'success') {
    return {
      background: t.value.infoBg,
      color: t.value.info,
      border: `1px solid ${t.value.infoBorder}`,
    }
  }
  if (kind === 'error') {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
      border: `1px solid ${t.value.dangerBorder}`,
    }
  }
  return {
    background: t.value.bgPanel,
    color: t.value.text,
    border: `1px solid ${t.value.border}`,
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
    // the local-mode hydrate completes in a few ms. Skills hydrate in parallel
    // so the AgentEditor skill picker stays in sync with newly added skills.
    await Promise.all([ws.hydrateAgentsFromSidecar(), ws.hydrateSkillsFromSidecar(), sleep(350)])
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

const modelLabel = (agent: Agent) =>
  MODELS.find((m) => m.id === agent.model)?.label ?? agent.model ?? ''

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
const renamingAgent = ref<Agent | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, agent: Agent) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, agent }
}

const openMenuFromButton = (e: MouseEvent, agent: Agent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, agent }
}

const startRename = (agent: Agent) => {
  renamingAgent.value = agent
  renamingKey.value = agentKey(agent)
  renameValue.value = agent.name
}

const commitRename = async () => {
  const target = renamingAgent.value
  if (!target) return
  const trimmed = renameValue.value.trim()
  renamingKey.value = null
  renamingAgent.value = null
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
  renamingAgent.value = null
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
  // Agents + Skills run in parallel — Skills are needed by AgentEditor's
  // skills picker. Without this, opening Edit shows "No skills yet — create
  // one first" even when ~/.awog/skills has entries.
  await Promise.all([ws.hydrateAgentsFromSidecar(), ws.hydrateSkillsFromSidecar()])
  if (!selectedKey.value && ws.agents[0]) selectedKey.value = agentKey(ws.agents[0])
})
</script>
