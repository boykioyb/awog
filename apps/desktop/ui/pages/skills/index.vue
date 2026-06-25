<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="editing && !selectedKey ? '_creating' : selectedKey"
    list-width="20rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <SkillsListSidebar
        ref="sidebarRef"
        :groups="grouped"
        :selected-key="selectedKey"
        :bulk-selection="bulkSelection"
        :renaming-key="renamingKey"
        :rename-value="renameValue"
        :refreshing="refreshing"
        :refresh-title="refreshTitle"
        :search-query="searchQuery"
        :all-filtered-selected="allFilteredSelected"
        :some-filtered-selected="someFilteredSelected"
        :skill-key="skillKey"
        :source-label="sourceLabel"
        :source-badge-style="sourceBadgeStyle"
        @update:search-query="(v: string) => (searchQuery = v)"
        @refresh="onRefresh"
        @new="onNew"
        @toggle-select-all="toggleSelectAllFiltered"
        @clear-bulk="clearBulk"
        @select="onSelect"
        @context-menu="onContextMenu"
        @toggle-bulk="toggleBulk"
        @start-rename="startRename"
        @update:rename-value="(v: string) => (renameValue = v)"
        @commit-rename="commitRename"
        @cancel-rename="cancelRename"
        @open-menu="openMenuFromButton"
        @rename-input-mounted="setRenameInputRef"
      />
    </template>

    <template #detail>
      <SkillEditor
        v-if="editing"
        :skill="selectedSkill ?? null"
        @save="onSave"
        @cancel="onCancel"
      />
      <SkillDetail
        v-else-if="selectedSkill"
        :skill="selectedSkill"
        @edit="editing = true"
        @edit-body="onEditBody"
        @delete="askDelete"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Wand2" title="Select a skill" />
    </template>
  </MasterDetailShell>

  <SkillPromptCreator v-if="showPromptModal" :anchor="anchor" @close="onClosePromptModal" />

  <SkillBodyEditModal
    v-if="bodyEditing && selectedSkill"
    :skill="selectedSkill"
    :anchor="bodyEditAnchor"
    @apply="onApplyBodyEdit"
    @cancel="bodyEditing = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDelete"
    title="Delete skill?"
    :description="deleteDescription"
    @confirm="confirmDelete"
    @cancel="pendingDelete = null"
  />

  <ConfirmDeleteModal
    v-if="bulkPendingDelete"
    :title="`Delete ${bulkPendingDelete.length} skills?`"
    :description="bulkDeleteDescription"
    @confirm="confirmBulkDelete"
    @cancel="bulkPendingDelete = null"
  />

  <SkillsBulkActionBar
    v-if="bulkSelection.size > 0"
    :count="bulkSelection.size"
    :deleting="bulkDeleting"
    @cancel="clearBulk"
    @delete="askBulkDelete"
  />

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
      class="px-3 py-2 rounded-lg text-[1em] shadow-lg"
      :style="toastStyle(toast.kind)"
    >
      {{ toast.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { Wand2 } from 'lucide-vue-next'

// All page logic lives in the composable; this stays a thin template shell.
const {
  skillKey,
  searchQuery,
  grouped,
  selectedKey,
  selectedSkill,
  mobilePane,
  editing,
  refreshing,
  refreshTitle,
  sidebarRef,
  anchor,
  sourceLabel,
  sourceBadgeStyle,
  onSelect,
  onNew,
  onRefresh,
  onBack,
  onCancel,
  showPromptModal,
  onClosePromptModal,
  onSave,
  bodyEditing,
  bodyEditAnchor,
  onEditBody,
  onApplyBodyEdit,
  pendingDelete,
  deleteDescription,
  askDelete,
  confirmDelete,
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
  renameValue,
  setRenameInputRef,
  onContextMenu,
  openMenuFromButton,
  startRename,
  commitRename,
  cancelRename,
  toasts,
  toastStyle,
} = useSkillsManager()
</script>
