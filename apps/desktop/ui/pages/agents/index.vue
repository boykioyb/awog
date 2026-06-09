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
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="New agent"
          @click="startCreate"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <Plus :size="14" />
        </button>
      </div>
      <div
        v-if="grouped.length > 0"
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
        <template v-if="showHeaders">
          <button
            class="p-1 rounded transition opacity-60 hover:opacity-100"
            :style="{ color: t.textDim }"
            title="Collapse all groups"
            @click="collapseAll"
          >
            <ChevronsDownUp :size="13" />
          </button>
          <button
            class="p-1 rounded transition opacity-60 hover:opacity-100"
            :style="{ color: t.textDim }"
            title="Expand all groups"
            @click="expandAll"
          >
            <ChevronsUpDown :size="13" />
          </button>
        </template>
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
          v-for="(group, gi) in grouped"
          :key="group.key"
          :style="{ marginTop: gi > 0 ? '4px' : '0' }"
        >
          <button
            v-if="showHeaders"
            class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
            :style="{
              color: t.textDim,
              background: pill(false, groupHover === group.key).background,
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
              class="text-[12px] uppercase tracking-wider font-medium flex-1 text-left truncate"
            >
              {{ group.label }}
            </span>
            <span class="text-[12px] font-mono leading-none" :style="{ color: t.textFaint }">
              {{ group.agents.length }}
            </span>
          </button>
          <template v-if="!showHeaders || !collapsedGroups[group.key]">
            <AgentListItem
              v-for="agent in group.agents"
              :key="agentKey(agent)"
              :agent="agent"
              :selected="selectedKey === agentKey(agent)"
              :checked="bulkSelection.has(agentKey(agent))"
              :renaming="renamingKey === agentKey(agent)"
              :in-group="showHeaders"
              @select="onSelect(agent)"
              @toggle-bulk="toggleBulk(agent)"
              @context-menu="(e) => onContextMenu(e, agent)"
              @open-menu="(e) => openMenuFromButton(e, agent)"
              @start-rename="startRename(agent)"
              @rename="(v) => onRename(agent, v)"
              @cancel-rename="cancelRename"
            />
          </template>
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
      background: overlay.background,
      border: `1px solid ${overlay.borderColor}`,
      backdropFilter: overlay.backdropFilter,
      boxShadow: overlay.boxShadow,
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
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-vue-next'

// All page logic lives in the composable; this stays a thin template shell.
// useTheme() supplies `t` for the inline-styled list chrome (header + bulk bar).
const { t } = useTheme()
const { overlay, pill } = useGlass()
const {
  agentKey,
  searchQuery,
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
  showPromptModal,
  onClosePromptModal,
  onSave,
  onDuplicate,
  bodyEditing,
  bodyEditAnchor,
  onEditBody,
  onApplyBodyEdit,
  confirmDelete,
  deleteDescription,
  onDelete,
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
  contextMenu,
  menuItems,
  renamingKey,
  onContextMenu,
  openMenuFromButton,
  startRename,
  onRename,
  cancelRename,
  toasts,
  toastStyle,
} = useAgentsManager()

// Collapse + hover are pure view state for the grouped list. A single group
// (e.g. only user/global agents, no projects) reads as a flat list — no header.
const collapsedGroups = ref<Record<string, boolean>>({})
const groupHover = ref<string | null>(null)
const showHeaders = computed(() => grouped.value.length > 1)

const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const collapseAll = () => {
  collapsedGroups.value = Object.fromEntries(grouped.value.map((g) => [g.key, true]))
}

const expandAll = () => {
  collapsedGroups.value = {}
}
</script>
