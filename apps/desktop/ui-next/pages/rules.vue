<template>
  <section class="page on" data-page="rules">
    <LibraryView
      :items="rules"
      :item-key="ruleKey"
      :search-text="(r) => r.id + r.name + r.description"
      :placeholder="t('rules.search')"
      :group-by="groupKey"
      :group-label="groupLabel"
      :group-dot="groupDot"
      show-new
      import-kind="rule"
      @new="openCreator()"
      @new-in-group="openCreator"
      @imported="onImported"
    >
      <template #row="{ item: r }">
        <div class="lrow">
          <span
            class="sdot"
            :style="{ background: r.enabled ? 'var(--accent)' : 'var(--textFaint)' }"
          />
          <span class="ttl">{{ r.name }}</span>
          <span class="tag" :class="{ acc: r.source === 'project' }" style="padding: 1px 6px">
            {{ t('rules.tier.' + r.source) }}
          </span>
        </div>
        <div class="sub">{{ r.description }}</div>
      </template>

      <template #detail="{ item: r }">
        <RuleDetail
          :rule="r"
          :projects="projectListWithPath"
          @edit="openEditor(r)"
          @delete="askDelete(r)"
          @toggle="onToggle(r)"
          @edit-body="openBodyEdit(r)"
        />
      </template>
    </LibraryView>

    <!-- create (one-shot rules.generate draft → save) -->
    <RulePromptCreator
      :open="creatorOpen"
      :account-id="accountId"
      :projects="projectList"
      :initial-scope="creatorScope"
      @close="closeCreator"
      @save="onCreatorSave"
    />

    <!-- edit (form) -->
    <RuleEditor
      :open="editorOpen"
      :rule="editTarget"
      :projects="projectListWithPath"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- edit body (LLM revise) -->
    <RuleBodyEditModal
      v-if="bodyEditTarget"
      :open="bodyEditOpen"
      :rule="bodyEditTarget"
      :account-id="accountId"
      @apply="onApplyBodyEdit"
      @cancel="closeBodyEdit"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('rules.delete')"
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
// Rules library — live store + full CRUD + chat-driven creation + auto-inject
// toggle (ADR 0033). Ported from the prototype. Shell from
// <LibraryView>; all state + handlers live in useRulesPage (page-controller).
// Mirrors the reference pages/skills.vue, adapted for the Rules surface.
import { computed } from 'vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import RuleBodyEditModal from '~/components/rule/RuleBodyEditModal.vue'
import RuleDetail from '~/components/rule/RuleDetail.vue'
import RuleEditor from '~/components/rule/RuleEditor.vue'
import RulePromptCreator from '~/components/rule/RulePromptCreator.vue'
import { useProjects } from '~/composables/useProjects'
import { useRulesPage } from '~/composables/useRulesPage'
import type { Rule } from '~/stores/rules'

const { t } = useI18n()
const { projects, projectPath, projectName } = useProjects()

const {
  rules,
  ruleKey,
  projectList,
  accountId,
  creatorOpen,
  creatorScope,
  openCreator,
  closeCreator,
  onCreatorSave,
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
  onToggle,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  onImported,
  toasts,
  toastColor,
} = useRulesPage()

// Project list enriched with the on-disk path (for tier hints in editor/detail).
const projectListWithPath = computed(() =>
  projects.value.map((p) => ({ id: p.id, name: p.name, path: projectPath(p.id) ?? undefined })),
)

// Group the list by tier (global vs each project) — like the Sessions list.
const groupKey = (r: Rule) => (r.source === 'project' && r.projectId ? r.projectId : 'global')
const groupLabel = (key: string) =>
  key === 'global' ? t('library.group.global') : projectName(key)
const groupDot = (key: string) => (key === 'global' ? 'var(--textDim)' : 'var(--accent)')
</script>
