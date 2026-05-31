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
        class="px-3 py-3 flex items-center gap-1.5"
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
          class="flex items-center gap-1 px-2.5 py-1.5 text-[1em] rounded font-medium transition"
          :style="{ background: t.accent, color: t.accentText }"
          @click="onNewSession"
        >
          <Plus :size="11" />
          New
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
        <CompactSelect v-model="providerFilter" label="Connection" :options="providerOptions" />
        <CompactSelect v-model="modelFilter" label="Model" :options="modelOptions" />
        <CompactSelect
          v-model="agentFilter"
          label="Agents"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'with', label: 'With agents' },
            { value: 'without', label: 'No agents (scratch pad)' },
          ]"
        />
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

      <div class="flex-1 overflow-y-auto py-1">
        <EmptyView v-if="filtered.length === 0" :icon="MessageSquare" title="No sessions yet" />
        <template v-else>
          <div
            v-for="(group, gi) in grouped"
            :key="group.key"
            :style="{ marginTop: group.label && gi > 0 ? '4px' : '0' }"
          >
            <button
              v-if="group.label"
              class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
              :style="{
                color: t.textDim,
                background: groupHover === group.key ? t.bgHover : 'transparent',
              }"
              @click="toggleGroup(group.key)"
              @mouseenter="groupHover = group.key"
              @mouseleave="groupHover = null"
            >
              <ChevronDown
                :size="10"
                :style="{
                  transform: collapsedGroups[group.key] ? 'rotate(-90deg)' : 'none',
                  transition: 'transform 0.15s',
                }"
              />
              <span
                class="text-[1em] uppercase tracking-wider font-medium flex-1 text-left truncate"
              >
                {{ group.label }}
              </span>
              <span class="text-[1em]" :style="{ color: t.textFaint }">
                {{ group.sessions.length }}
              </span>
            </button>
            <template v-if="!collapsedGroups[group.key]">
              <div
                v-for="ses in group.sessions"
                :key="ses.id"
                class="text-left rounded transition flex items-start gap-2 px-2.5 py-2 cursor-pointer"
                :style="{
                  margin: '0 6px 1px 6px',
                  width: 'calc(100% - 12px)',
                  background:
                    store.selectedSessionId === ses.id
                      ? t.bgActive
                      : hoverId === ses.id
                        ? t.bgHover
                        : 'transparent',
                }"
                @click="onSelectSession(ses.id)"
                @contextmenu="onContextMenu($event, ses.id)"
                @mouseenter="hoverId = ses.id"
                @mouseleave="hoverId = null"
              >
                <Pin
                  v-if="ses.pinned"
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
                    <span>{{ ses.messages.length }} msg</span>
                    <span v-if="ses.invitedAgentIds.length" :style="{ color: t.textFaint }">·</span>
                    <span v-if="ses.invitedAgentIds.length">
                      {{ ses.invitedAgentIds.length }} agent{{
                        ses.invitedAgentIds.length > 1 ? 's' : ''
                      }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
    </template>

    <template #detail>
      <SessionChat
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
  ChevronDown,
  Edit3,
  ListFilter,
  MessageSquare,
  MoreHorizontal,
  Pin,
  Plus,
  Trash2,
} from 'lucide-vue-next'
import type { ProviderName, Session } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import { PROVIDER_LABEL, modelById } from '~/utils/models'
import { formatTime } from '~/utils/time'

const { t } = useTheme()
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
})

const searchQuery = ref('')
const hoverId = ref<string | null>(null)
const groupBy = ref<'none' | 'project' | 'provider' | 'model'>('project')
const projectFilter = ref<string>('all')
const providerFilter = ref<string>('all')
const modelFilter = ref<string>('all')
const agentFilter = ref<'all' | 'with' | 'without'>('all')
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
    if (providerFilter.value !== 'all' && s.settings.provider !== providerFilter.value) return false
    if (modelFilter.value !== 'all' && s.settings.modelId !== modelFilter.value) return false
    if (agentFilter.value === 'with' && s.invitedAgentIds.length === 0) return false
    if (agentFilter.value === 'without' && s.invitedAgentIds.length > 0) return false
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

const providerOptions = computed(() => {
  const counts = new Map<ProviderName, number>()
  allSessions.value.forEach((s) => {
    counts.set(s.settings.provider, (counts.get(s.settings.provider) ?? 0) + 1)
  })
  return [
    { value: 'all', label: 'All' },
    ...(['anthropic', 'openai', 'google'] as ProviderName[])
      .filter((p) => counts.has(p))
      .map((p) => ({
        value: p,
        label: `${PROVIDER_LABEL[p]} (${counts.get(p) ?? 0})`,
      })),
  ]
})

const modelOptions = computed(() => {
  const counts = new Map<string, number>()
  allSessions.value.forEach((s) => {
    counts.set(s.settings.modelId, (counts.get(s.settings.modelId) ?? 0) + 1)
  })
  return [
    { value: 'all', label: 'All' },
    ...Array.from(counts.entries()).map(([id, count]) => ({
      value: id,
      label: `${modelById(id)?.label ?? id} (${count})`,
    })),
  ]
})

const activeFilterCount = computed(
  () =>
    (projectFilter.value !== 'all' ? 1 : 0) +
    (providerFilter.value !== 'all' ? 1 : 0) +
    (modelFilter.value !== 'all' ? 1 : 0) +
    (agentFilter.value !== 'all' ? 1 : 0),
)

const clearFilters = () => {
  projectFilter.value = 'all'
  providerFilter.value = 'all'
  modelFilter.value = 'all'
  agentFilter.value = 'all'
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

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = store.sessions.find((s) => s.id === ctx.id)
  if (!item) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(item.id, item.title) },
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
