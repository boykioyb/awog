<template>
  <MasterDetailShell
    v-model:mobile-pane="mobilePane"
    :selected-id="store.selectedSessionId"
    list-width="20rem"
    resizable
    storage-key="awog:sessions:list-width"
    :min-list-width="220"
    :max-list-width="560"
  >
    <template #list>
      <!-- Single-row toolbar -->
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search..." />
        <button
          class="p-1.5 rounded transition relative"
          :style="filterBtnStyle"
          title="Filters"
          @click="showFilters = !showFilters"
          @mouseenter="filterHover = true"
          @mouseleave="filterHover = false"
        >
          <ListFilter :size="12" />
          <div
            v-if="activeFilterCount > 0"
            class="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center text-[1em] font-semibold"
            :style="{ background: t.accent, color: t.accentText }"
          >
            {{ activeFilterCount }}
          </div>
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="New session"
          @click="onNewSession"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <Plus :size="14" />
        </button>
      </div>

      <!-- Collapsible filters drawer -->
      <div
        v-if="showFilters"
        class="px-3 py-2.5 space-y-2"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
      >
        <CompactSelect
          v-model="groupBy"
          label="Group by"
          :options="[
            { value: 'project', label: 'Project' },
            { value: 'provider', label: 'Connection' },
            { value: 'model', label: 'Model' },
            { value: 'none', label: 'None (flat)' },
          ]"
        />
        <CompactSelect v-model="projectFilter" label="Project" :options="projectOptions" />
        <button
          v-if="activeFilterCount > 0"
          class="text-[1em] transition"
          :style="{ color: clearHover ? t.text : t.textDim }"
          @click="clearFilters"
          @mouseenter="clearHover = true"
          @mouseleave="clearHover = false"
        >
          Clear filters
        </button>
      </div>

      <!-- Bulk select / delete bar. Only shown once selection mode is active
           (≥1 selected via a row's "Select" context-menu action). Kept inside
           the sidebar column (not a fixed bottom overlay like Agents/Skills) so
           it never covers the chat composer in the detail pane. -->
      <div
        v-if="bulkSelection.size > 0"
        class="px-3 py-1.5 flex items-center gap-2 text-[1em]"
        :style="{ borderBottom: `1px solid ${t.border}`, color: t.textDim }"
      >
        <input
          type="checkbox"
          :checked="allVisibleChecked"
          :indeterminate.prop="someVisibleChecked && !allVisibleChecked"
          class="cursor-pointer flex-shrink-0"
          :style="{ accentColor: t.accent }"
          :title="allVisibleChecked ? 'Deselect all' : 'Select all'"
          @click="toggleSelectAll(visibleIds)"
        />
        <span :style="{ color: t.text }">{{ bulkSelection.size }} selected</span>
        <span class="flex-1" />
        <!-- Icon-only actions (project convention): title carries the label. -->
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Clear selection"
          @click="clearBulk"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <X :size="13" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.danger }"
          :title="`Delete ${bulkSelection.size} selected`"
          @click="askBulkDelete"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.background = t.dangerBg)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')"
        >
          <Trash2 :size="13" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto py-1">
        <EmptyView v-if="filtered.length === 0" :icon="MessageSquare" title="No sessions yet" />
        <template v-else>
          <div
            v-for="(group, gi) in grouped"
            :key="group.key"
            :style="{ marginTop: group.label && gi > 0 ? '4px' : '0' }"
          >
            <div
              v-if="group.label"
              class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
              :style="{ background: pill(false, groupHover === group.key).background }"
              @mouseenter="groupHover = group.key"
              @mouseleave="groupHover = null"
            >
              <button
                class="flex items-center gap-1.5 flex-1 min-w-0 text-left transition"
                :style="{ color: t.textDim }"
                @click="toggleGroup(group.key)"
              >
                <ChevronDown
                  :size="10"
                  class="flex-shrink-0"
                  :style="{
                    transform: collapsedGroups[group.key] ? 'rotate(-90deg)' : 'none',
                    transition: 'transform 0.15s',
                  }"
                />
                <span
                  class="text-[0.857em] uppercase tracking-wider font-semibold truncate"
                  :style="{ color: t.text }"
                >
                  {{ group.label }}
                </span>
              </button>
              <span class="text-[0.857em] flex-shrink-0" :style="{ color: t.textFaint }">
                {{ group.sessions.length }}
              </span>
              <!-- Quick-add a session into this project. Only meaningful when
                   grouping by project (group.key === projectId); hidden for the
                   provider/model views. Fades in on row hover. -->
              <button
                v-if="groupBy === 'project'"
                class="p-0.5 rounded transition flex-shrink-0"
                :style="{
                  color: t.textDim,
                  opacity: groupHover === group.key ? 1 : 0,
                  pointerEvents: groupHover === group.key ? 'auto' : 'none',
                }"
                :title="`New session in ${group.label}`"
                @click="quickNewSession(group)"
                @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
                @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
              >
                <Plus :size="12" />
              </button>
            </div>
            <template v-if="!collapsedGroups[group.key]">
              <div
                v-for="ses in group.sessions"
                :key="ses.id"
                class="text-left rounded transition flex items-start gap-2 px-2.5 py-2 cursor-pointer"
                :style="{
                  margin: '0 6px 1px 6px',
                  width: 'calc(100% - 12px)',
                  background: pill(store.selectedSessionId === ses.id, hoverId === ses.id)
                    .background,
                }"
                @click="onSelectSession(ses.id)"
                @contextmenu="onContextMenu($event, ses.id)"
                @mouseenter="hoverId = ses.id"
                @mouseleave="hoverId = null"
              >
                <!-- Checkbox is hidden until selection mode is active (≥1 selected,
                     entered via the row's "Select" context-menu action). -->
                <input
                  v-if="bulkSelection.size > 0"
                  type="checkbox"
                  :checked="bulkSelection.has(ses.id)"
                  class="cursor-pointer flex-shrink-0 mt-0.5"
                  :style="{ accentColor: t.accent }"
                  :title="bulkSelection.has(ses.id) ? 'Remove from selection' : 'Add to selection'"
                  @click.stop="toggleBulk(ses.id)"
                />
                <!-- Streaming takes visual priority over pin: the running state is
                     transient and more important to surface at a glance. -->
                <span
                  v-if="streamingIds.has(ses.id)"
                  class="flex-shrink-0 mt-1 w-2 h-2 rounded-full animate-pulse"
                  :style="{ background: t.accent, boxShadow: `0 0 6px ${t.accent}` }"
                  title="Running"
                />
                <Pin
                  v-else-if="ses.pinned"
                  :size="10"
                  class="flex-shrink-0 mt-1"
                  :style="{ color: t.textDim }"
                />
                <MessageSquare
                  v-else
                  :size="10"
                  class="flex-shrink-0 mt-1"
                  :style="{ color: t.textFaint }"
                />
                <div class="flex-1 min-w-0">
                  <input
                    v-if="renamingId === ses.id"
                    :ref="setRenameInputRef"
                    v-model="renameValue"
                    class="text-[1em] leading-tight w-full rounded px-1 py-0.5"
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
                  <div class="flex items-center gap-1">
                    <div
                      class="text-[1em] leading-tight truncate flex-1"
                      :style="{ color: t.text }"
                      @dblclick.stop="startRename(ses.id, ses.title)"
                    >
                      {{ ses.title }}
                    </div>
                    <button
                      class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
                      :style="{ color: t.textMuted }"
                      title="Actions"
                      @click.stop="openMenuFromButton($event, ses.id)"
                    >
                      <MoreHorizontal :size="13" />
                    </button>
                  </div>
                  <div
                    class="text-[1em] mt-0.5 flex items-center gap-1.5"
                    :style="{ color: t.textDim }"
                  >
                    <span>{{ fmt(ses.updatedAt) }}</span>
                    <span :style="{ color: t.textFaint }">·</span>
                    <span
                      v-if="streamingIds.has(ses.id)"
                      class="animate-pulse"
                      :style="{ color: t.accent }"
                    >
                      Running…
                    </span>
                    <span v-else>{{ ses.messages.length }} msg</span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>

    <template #detail>
      <!-- Lazy: SessionChat statically pulls Monaco + xterm into this page's
           chunk. Loading that on the Sessions route crashed the renderer on
           Windows (render-process-gone). LazySessionChat splits it into its own
           chunk, loaded only when a session is actually open. -->
      <LazySessionChat
        v-if="store.selectedSession"
        :session="store.selectedSession"
        @delete="askDelete(store.selectedSession.id)"
      />
    </template>

    <template #empty-detail>
      <div class="flex-1 flex items-center justify-center text-[1em]" :style="{ color: t.textDim }">
        Select a session
      </div>
    </template>
  </MasterDetailShell>

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    title="Delete session?"
    :description="`Session '${pendingDeleteTitle}' will be permanently deleted.`"
    @confirm="confirmDelete"
    @cancel="pendingDeleteId = null"
  />

  <ConfirmDeleteModal
    v-if="bulkPendingDelete"
    :title="`Delete ${bulkPendingDelete.length} session${bulkPendingDelete.length === 1 ? '' : 's'}?`"
    :description="`${bulkPendingDelete.length} session${bulkPendingDelete.length === 1 ? '' : 's'} will be permanently deleted.`"
    @confirm="confirmBulkDelete"
    @cancel="bulkPendingDelete = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />

  <SessionNewDialog
    :open="newDialogOpen"
    @close="newDialogOpen = false"
    @create="onCreateSession"
  />

  <SessionSubagentDrawer />
</template>

<script setup lang="ts">
import {
  CheckSquare,
  ChevronDown,
  Copy,
  Edit3,
  FolderOpen,
  ListFilter,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-vue-next'
import type { Session } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import { PROVIDER_LABEL, modelById } from '~/utils/models'
import { formatTime } from '~/utils/time'

const { t } = useTheme()
const { pill } = useGlass()
const store = useSessionsStore()
const workspace = useWorkspaceStore()
const settingsStore = useSettingsStore()
const fmt = (at: string | undefined) => formatTime(at, settingsStore.defaults?.timezone)

onMounted(() => {
  store.hydrateFromSidecar()
  // Project list is needed by SessionNewDialog + group/filter chips; hydrate
  // here so opening "New session" never shows an empty picker on cold start.
  workspace.hydrateProjectsFromSidecar()
  // MCP list powers the per-session MCP chip in the composer.
  workspace.hydrateMcpFromSidecar()
  // Agents (`$` mention) + skills (`/` mention) are hydrated per-session in
  // SessionChat, scoped to the selected session's project — so the composer
  // picker never offers other projects' entries.
})

const searchQuery = ref('')
const hoverId = ref<string | null>(null)
const groupBy = ref<'none' | 'project' | 'provider' | 'model'>('project')
const projectFilter = ref<string>('all')
const collapsedGroups = ref<Record<string, boolean>>({})
const groupHover = ref<string | null>(null)
const showFilters = ref(false)
const filterHover = ref(false)
const clearHover = ref(false)
const mobilePane = ref<'list' | 'detail'>('list')

const onSelectSession = (id: string) => {
  store.selectSession(id)
  mobilePane.value = 'detail'
}

const allSessions = computed(() => store.sessions)

// Ids of sessions with an in-flight streaming turn — drives the pulsing
// "running" indicator per list row. Reactive on each session's pendingAgentIds,
// so a row lights up when a turn starts and reverts to its msg count when done.
const streamingIds = computed(
  () => new Set(store.sessions.filter((s) => store.isSessionStreaming(s.id)).map((s) => s.id)),
)

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = allSessions.value.filter((s) => {
    if (projectFilter.value !== 'all') {
      if (
        projectFilter.value === '_none' ? s.projectId !== null : s.projectId !== projectFilter.value
      ) {
        return false
      }
    }
    if (q) {
      const hit =
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.text.toLowerCase().includes(q))
      if (!hit) return false
    }
    return true
  })
  list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })
  return list
})

// Bulk selection (checkbox / select-all / bulk delete). Logic lives in a
// dedicated composable; the page only feeds it the currently-visible ids and
// renders the checkboxes + action bar.
const {
  bulkSelection,
  bulkPendingDelete,
  toggleBulk,
  clearBulk,
  allVisibleSelected,
  someVisibleSelected,
  toggleSelectAll,
  askBulkDelete,
  confirmBulkDelete,
} = useSessionsSelection()

const visibleIds = computed(() => filtered.value.map((s) => s.id))
const allVisibleChecked = computed(() => allVisibleSelected(visibleIds.value))
const someVisibleChecked = computed(() => someVisibleSelected(visibleIds.value))

const projectOptions = computed(() => [
  { value: 'all', label: `All (${allSessions.value.length})` },
  {
    value: '_none',
    label: `No project (${allSessions.value.filter((s) => !s.projectId).length})`,
  },
  ...workspace.projects.map((p) => ({
    value: p.id,
    label: `${p.name} (${allSessions.value.filter((s) => s.projectId === p.id).length})`,
  })),
])

const activeFilterCount = computed(() => (projectFilter.value !== 'all' ? 1 : 0))

const clearFilters = () => {
  projectFilter.value = 'all'
}

const filterActiveLike = computed(() => showFilters.value || activeFilterCount.value > 0)

const filterBtnStyle = computed(() => {
  const active = filterActiveLike.value
  const hover = filterHover.value
  let background: string
  if (active) background = t.value.bgActive
  else if (hover) background = t.value.bgHover
  else background = 'transparent'
  const color = active || hover ? t.value.text : t.value.textDim
  return {
    background,
    color,
    border: `1px solid ${active ? t.value.borderStrong : 'transparent'}`,
  }
})

interface Group {
  key: string
  label: string | null
  sessions: Session[]
}

const grouped = computed<Group[]>(() => {
  if (groupBy.value === 'none') {
    return [{ key: '_all', label: null, sessions: filtered.value }]
  }
  if (groupBy.value === 'project') {
    const map = new Map<string, Group>()
    workspace.projects.forEach((p) => map.set(p.id, { key: p.id, label: p.name, sessions: [] }))
    map.set('_none', { key: '_none', label: 'No project', sessions: [] })
    filtered.value.forEach((s) => {
      const target = s.projectId ? map.get(s.projectId) : map.get('_none')
      ;(target ?? map.get('_none'))?.sessions.push(s)
    })
    return Array.from(map.values()).filter((g) => g.sessions.length > 0)
  }
  if (groupBy.value === 'provider') {
    const map = new Map<string, Group>()
    filtered.value.forEach((s) => {
      const key = s.settings.provider
      const label = PROVIDER_LABEL[s.settings.provider]
      const existing = map.get(key) ?? { key, label, sessions: [] }
      existing.sessions.push(s)
      map.set(key, existing)
    })
    return Array.from(map.values())
  }
  if (groupBy.value === 'model') {
    const map = new Map<string, Group>()
    filtered.value.forEach((s) => {
      const key = s.settings.modelId
      const label = modelById(s.settings.modelId)?.label ?? s.settings.modelId
      const existing = map.get(key) ?? { key, label, sessions: [] }
      existing.sessions.push(s)
      map.set(key, existing)
    })
    return Array.from(map.values())
  }
  return [{ key: '_all', label: null, sessions: filtered.value }]
})

const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const newDialogOpen = ref(false)

const onNewSession = () => {
  newDialogOpen.value = true
}

const onCreateSession = (payload: { title: string; projectId: string | null }) => {
  store.createSession(payload)
  newDialogOpen.value = false
  mobilePane.value = 'detail'
}

// Group-header "+" — create + select a session straight into the group's
// project, no dialog. Only wired for project grouping; '_none' → projectless.
const quickNewSession = (group: Group) => {
  store.createSession({ title: '', projectId: group.key === '_none' ? null : group.key })
  // Reveal it if the group was collapsed, so the new (selected) session shows.
  if (collapsedGroups.value[group.key]) {
    collapsedGroups.value = { ...collapsedGroups.value, [group.key]: false }
  }
  mobilePane.value = 'detail'
}

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const pendingDeleteId = ref<string | null>(null)

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, id: string) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, id }
}

const openMenuFromButton = (e: MouseEvent, id: string) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, id }
}

const startRename = (id: string, current: string) => {
  renamingId.value = id
  renameValue.value = current
}

const commitRename = () => {
  const id = renamingId.value
  if (!id) return
  const trimmed = renameValue.value.trim()
  const item = store.sessions.find((s) => s.id === id)
  if (trimmed && item && trimmed !== item.title) {
    store.renameSession(id, trimmed)
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const askDelete = (id: string) => {
  pendingDeleteId.value = id
}

const pendingDeleteTitle = computed(
  () => store.sessions.find((s) => s.id === pendingDeleteId.value)?.title ?? '',
)

const confirmDelete = () => {
  if (pendingDeleteId.value) {
    store.deleteSession(pendingDeleteId.value)
    pendingDeleteId.value = null
  }
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard may be unavailable (non-secure context) — ignore
  }
}

const revealInFinder = async (path: string) => {
  try {
    // '.' targets the project root folder itself (reveal_path rejects empty).
    await useSidecar().revealPath(path, '.')
  } catch {
    // sidecar unavailable / path missing — ignore
  }
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = store.sessions.find((s) => s.id === ctx.id)
  if (!item) return []
  const projectPath = item.projectId
    ? workspace.projects.find((p) => p.id === item.projectId)?.path
    : undefined
  const selected = bulkSelection.value.has(item.id)
  return [
    {
      label: selected ? 'Deselect' : 'Select',
      icon: CheckSquare,
      action: () => toggleBulk(item.id),
    },
    { label: 'Rename', icon: Edit3, action: () => startRename(item.id, item.title) },
    { label: 'Copy session ID', icon: Copy, action: () => copyToClipboard(item.id) },
    {
      label: 'Copy project path',
      icon: Copy,
      disabled: !projectPath,
      tooltip: projectPath ? undefined : 'Session has no project',
      action: () => {
        if (projectPath) copyToClipboard(projectPath)
      },
    },
    {
      label: 'Show in Finder',
      icon: FolderOpen,
      disabled: !projectPath,
      tooltip: projectPath ? undefined : 'Session has no project',
      action: () => {
        if (projectPath) revealInFinder(projectPath)
      },
    },
    { separator: true },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = item.id
      },
    },
  ]
})
</script>
