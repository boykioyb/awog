<template>
  <section class="flex min-w-0 flex-1 overflow-hidden" data-page="rules">
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
        <div class="flex items-center gap-2">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="r.enabled ? 'bg-primary' : 'bg-faint'"
          />
          <span class="min-w-0 flex-1 truncate text-base font-medium">{{ r.name }}</span>
          <Badge
            variant="outline"
            :class="
              r.source === 'project'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'text-muted-foreground'
            "
          >
            {{ t('rules.tier.' + r.source) }}
          </Badge>
        </div>
        <div class="mt-1 truncate text-sm text-muted-foreground">{{ r.description }}</div>
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
