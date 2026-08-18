<template>
  <section class="page on" data-page="commands">
    <LibraryView
      :items="commands"
      :item-key="commandKey"
      :search-text="(c) => c.name + c.id + c.description"
      :placeholder="t('commands.search')"
      :group-by="groupKey"
      :group-label="groupLabel"
      :group-dot="groupDot"
      show-new
      import-kind="command"
      @new="openCreator()"
      @new-in-group="openCreator"
      @imported="onImported"
    >
      <template #row="{ item: c }">
        <div class="lrow" :style="{ opacity: c.enabled ? 1 : 0.55 }">
          <span class="ttl mono">/{{ c.name }}</span>
          <span
            class="tag"
            :class="{ acc: (c.source ?? 'global') === 'project' }"
            style="padding: 1px 6px"
          >
            {{ t('commands.tier.' + (c.source ?? 'global')) }}
          </span>
          <span v-if="c.readOnly" class="tag mono" style="padding: 1px 6px">
            <Icon name="lock" style="width: 9px; height: 9px" />
          </span>
        </div>
        <div class="sub">{{ c.description || '—' }}</div>
      </template>

      <template #detail="{ item: c }">
        <CommandDetail
          :command="c"
          :projects="projectListWithPath"
          @edit="openEditor(c)"
          @duplicate="onDuplicate(c)"
          @delete="askDelete(c)"
          @toggle="onToggle(c)"
          @edit-body="openBodyEdit(c)"
        />
      </template>
    </LibraryView>

    <!-- create (AI prompt → draft → save or edit details) -->
    <CommandPromptCreator
      :open="creatorOpen"
      :account-id="accountId"
      :projects="projectList"
      :initial-scope="creatorScope"
      @close="closeCreator"
      @save="onCreatorSave"
      @edit-details="onEditDetails"
    />

    <!-- edit (form) -->
    <CommandEditor
      :open="editorOpen"
      :command="editTarget"
      :seed="editorSeed"
      :projects="projectListWithPath"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- edit body (LLM revise) -->
    <CommandBodyEditModal
      v-if="bodyEditTarget"
      :open="bodyEditOpen"
      :command="bodyEditTarget"
      :account-id="accountId"
      @apply="onApplyBodyEdit"
      @cancel="closeBodyEdit"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('commands.delete')"
      :description="deleteDescription"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- transient toasts -->
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: toastColor(tt.kind) }"
    >
      {{ tt.text }}
    </div>
  </section>
</template>

<script setup lang="ts">
// Commands library — live store + full CRUD + AI-drafted creation. Replaces the
// static seed from the prototype port. Shell from <LibraryView>; all state +
// handlers live in useCommandsPage (page-controller), mirroring pages/skills.vue.
import { computed } from 'vue'
import CommandBodyEditModal from '~/components/command/CommandBodyEditModal.vue'
import CommandDetail from '~/components/command/CommandDetail.vue'
import CommandEditor from '~/components/command/CommandEditor.vue'
import CommandPromptCreator from '~/components/command/CommandPromptCreator.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useCommandsPage } from '~/composables/useCommandsPage'
import { useProjects } from '~/composables/useProjects'
import type { Command } from '~/stores/commands'

const { t } = useI18n()
const { projects, projectPath, projectName } = useProjects()

const {
  commands,
  commandKey,
  projectList,
  accountId,
  creatorOpen,
  creatorScope,
  openCreator,
  closeCreator,
  onCreatorSave,
  onEditDetails,
  editorOpen,
  editTarget,
  editorSeed,
  openEditor,
  closeEditor,
  onSave,
  bodyEditOpen,
  bodyEditTarget,
  openBodyEdit,
  closeBodyEdit,
  onApplyBodyEdit,
  onToggle,
  onDuplicate,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  onImported,
  toasts,
  toastColor,
} = useCommandsPage()

// Project list enriched with the on-disk path (for tier hints in editor/detail).
const projectListWithPath = computed(() =>
  projects.value.map((p) => ({ id: p.id, name: p.name, path: projectPath(p.id) ?? undefined })),
)

// Group the list by tier (global vs each project) — like the Sessions list.
const groupKey = (c: Command) => (c.source === 'project' && c.projectId ? c.projectId : 'global')
const groupLabel = (key: string) =>
  key === 'global' ? t('library.group.global') : projectName(key)
const groupDot = (key: string) => (key === 'global' ? 'var(--textDim)' : 'var(--accent)')
</script>
