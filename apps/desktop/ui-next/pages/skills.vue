<template>
  <section class="page on" data-page="skills">
    <LibraryView
      :items="skills"
      :item-key="skillKey"
      :search-text="(s) => s.id + s.name + s.description"
      :placeholder="t('skills.search')"
      :group-by="groupKey"
      :group-label="groupLabel"
      :group-dot="groupDot"
      show-new
      import-kind="skill"
      @new="openCreator()"
      @new-in-group="openCreator"
      @imported="onImported"
    >
      <template #row="{ item: s }">
        <div class="lrow">
          <span class="ttl">{{ s.name }}</span>
          <span class="tag" :class="{ acc: s.source === 'project' }" style="padding: 1px 6px">
            {{ t('skills.tier.' + s.source) }}
          </span>
        </div>
        <div class="sub">{{ s.description }}</div>
      </template>

      <template #detail="{ item: s }">
        <SkillDetail
          :skill="s"
          :projects="projectListWithPath"
          @edit="openEditor(s)"
          @duplicate="onDuplicate(s)"
          @delete="askDelete(s)"
          @edit-body="openBodyEdit(s)"
        />
      </template>
    </LibraryView>

    <!-- create (chat-driven SKILL.md authoring) -->
    <SkillPromptCreator
      :open="creatorOpen"
      :account="account"
      :projects="projectList"
      :initial-scope="creatorScope"
      @close="onCreatorClose"
      @turn="onCreatorTurn"
    />

    <!-- edit (form) -->
    <SkillEditor
      :open="editorOpen"
      :skill="editTarget"
      :projects="projectListWithPath"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- edit body (LLM revise) -->
    <SkillBodyEditModal
      v-if="bodyEditTarget"
      :open="bodyEditOpen"
      :skill="bodyEditTarget"
      :account-id="accountId"
      @apply="onApplyBodyEdit"
      @cancel="closeBodyEdit"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('skills.delete')"
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
// Skills library — live store + full CRUD + chat-driven creation. Replaces the
// static seed from the prototype port. Shell from <LibraryView>; all state +
// handlers live in useSkillsPage (page-controller). This is the REFERENCE
// vertical slice the sibling library features mirror.
import { computed } from 'vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import SkillBodyEditModal from '~/components/skill/SkillBodyEditModal.vue'
import SkillDetail from '~/components/skill/SkillDetail.vue'
import SkillEditor from '~/components/skill/SkillEditor.vue'
import SkillPromptCreator from '~/components/skill/SkillPromptCreator.vue'
import { useProjects } from '~/composables/useProjects'
import { useSkillsPage } from '~/composables/useSkillsPage'
import type { Skill } from '~/stores/skills'

const { t } = useI18n()
const { projects, projectPath, projectName } = useProjects()

const {
  skills,
  skillKey,
  projectList,
  account,
  accountId,
  creatorOpen,
  creatorScope,
  openCreator,
  onCreatorTurn,
  onCreatorClose,
  editorOpen,
  editTarget,
  openEditor,
  closeEditor,
  onSave,
  bodyEditOpen,
  bodyEditTarget,
  openBodyEdit,
  closeBodyEdit,
  onApplyBodyEdit,
  onDuplicate,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  onImported,
  toasts,
  toastColor,
} = useSkillsPage()

// Project list enriched with the on-disk path (for tier hints in editor/detail).
const projectListWithPath = computed(() =>
  projects.value.map((p) => ({ id: p.id, name: p.name, path: projectPath(p.id) ?? undefined })),
)

// Group the list by tier (global vs each project) — like the Sessions list.
const groupKey = (s: Skill) => (s.source === 'project' && s.projectId ? s.projectId : 'global')
const groupLabel = (key: string) =>
  key === 'global' ? t('library.group.global') : projectName(key)
const groupDot = (key: string) => (key === 'global' ? 'var(--textDim)' : 'var(--accent)')
</script>
