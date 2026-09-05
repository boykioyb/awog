<template>
  <section class="page on" data-page="hooks">
    <LibraryView
      :items="hooks"
      :item-key="hookKey"
      :search-text="(h) => h.name + h.event + h.description"
      :placeholder="t('hooks.search')"
      :group-by="groupKey"
      :group-label="groupLabel"
      :group-dot="groupDot"
      show-new
      @new="openCreator()"
      @new-in-group="openCreator"
    >
      <template #row="{ item: h }">
        <div class="lrow">
          <span
            class="hk-dot"
            :style="{ background: h.enabled ? 'var(--accent)' : 'var(--textFaint)' }"
          />
          <span class="ttl">{{ h.name }}</span>
          <span class="tag mono hk-evt">{{ h.event }}</span>
          <span
            v-if="(h.source ?? 'global') === 'project'"
            class="tag"
            :class="{ acc: h.trusted !== false, warn: h.trusted === false }"
            style="padding: 1px 6px"
          >
            {{ h.trusted === false ? t('hooks.tier.untrusted') : '.awog' }}
          </span>
        </div>
        <div class="sub">{{ h.description }}</div>
      </template>

      <template #detail="{ item: h }">
        <HookDetail
          :hook="h"
          :running="running === hookKey(h)"
          @edit="openEditor(h)"
          @delete="askDelete(h)"
          @run="onRunOnce(h)"
          @toggle="onToggle(h)"
          @trust="onTrust(h)"
        />
      </template>
    </LibraryView>

    <!-- create (one-shot LLM draft → preview → save / edit details) -->
    <HookPromptCreator
      :open="creatorOpen"
      :account-id="accountId"
      :projects="projectList"
      :initial-scope="creatorScope"
      @save="onCreatorSave"
      @edit-manually="onCreatorEditManually"
      @cancel="onCreatorClose"
    />

    <!-- edit (form) -->
    <HookEditor
      ref="editorRef"
      :open="editorOpen"
      :hook="editTarget"
      :initial-draft="seededDraft"
      :projects="projectList"
      :pending-config="pendingConfig"
      :pending-script="pendingScript"
      @save="onSave"
      @cancel="closeEditor"
      @edit-config="onEditConfig"
      @edit-script="onEditScript"
    />

    <!-- LLM config edit -->
    <HookConfigEditModal
      v-if="configEditHook"
      :open="configEditOpen"
      :hook="configEditHook"
      :account-id="accountId"
      @apply="onApplyConfig"
      @cancel="closeConfigEdit"
    />

    <!-- LLM script edit -->
    <HookScriptEditModal
      v-if="scriptEditCtx"
      :open="scriptEditOpen"
      :path="scriptEditCtx.path"
      :command="scriptEditCtx.command"
      :current-content="scriptEditCtx.content"
      :account-id="accountId"
      @apply="onApplyScript"
      @cancel="closeScriptEdit"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('hooks.delete')"
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
// Hooks library — live store + full CRUD + chat-driven (one-shot) creation +
// inline script editing + run-once smoke test + project-tier trust gate
// (ADR 0032). Ported from the prototype. Shell from
// <LibraryView>; all state + handlers live in useHooksPage (page-controller).
// Mirrors the reference skills vertical slice.
import { useTemplateRef } from 'vue'
import HookConfigEditModal from '~/components/hook/HookConfigEditModal.vue'
import HookDetail from '~/components/hook/HookDetail.vue'
import HookEditor from '~/components/hook/HookEditor.vue'
import HookPromptCreator from '~/components/hook/HookPromptCreator.vue'
import HookScriptEditModal from '~/components/hook/HookScriptEditModal.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useHooksPage } from '~/composables/useHooksPage'
import { useProjects } from '~/composables/useProjects'
import type { Hook } from '~/stores/hooks'

const { t } = useI18n()
const { projectName } = useProjects()

const {
  hooks,
  hookKey,
  projectList,
  accountId,
  creatorOpen,
  creatorScope,
  openCreator,
  onCreatorClose,
  onCreatorEditManually,
  onCreatorSave,
  editorOpen,
  editTarget,
  seededDraft,
  openEditor,
  closeEditor,
  onSave,
  configEditOpen,
  configEditHook,
  pendingConfig,
  openConfigEdit,
  closeConfigEdit,
  onApplyConfig,
  scriptEditOpen,
  scriptEditCtx,
  pendingScript,
  openScriptEdit,
  closeScriptEdit,
  onApplyScript,
  onToggle,
  running,
  onRunOnce,
  onTrust,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  toasts,
  toastColor,
} = useHooksPage()

// The editor exposes its live draft + script context; the LLM edit modals read
// them when opened (the editor owns the in-flight draft, not the store).
type EditorExpose = {
  draftHook: { value: Hook }
  scriptPath: { value: string }
  scriptContent: { value: string }
}
const editorRef = useTemplateRef<EditorExpose>('editorRef')

const onEditConfig = () => {
  const draft = editorRef.value?.draftHook.value
  if (draft) openConfigEdit(draft)
}
const onEditScript = () => {
  const path = editorRef.value?.scriptPath.value
  const draft = editorRef.value?.draftHook.value
  if (!path || !draft) return
  openScriptEdit({
    path,
    command: draft.command,
    content: editorRef.value?.scriptContent.value ?? '',
  })
}

// Group the list by tier (global vs each project) — like the Sessions list.
// `source` is optional and defaults to global, so undefined falls into 'global'.
const groupKey = (h: Hook) => (h.source === 'project' && h.projectId ? h.projectId : 'global')
const groupLabel = (key: string) =>
  key === 'global' ? t('library.group.global') : projectName(key)
const groupDot = (key: string) => (key === 'global' ? 'var(--textDim)' : 'var(--accent)')
</script>

<style scoped>
.hk-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.hk-evt {
  font-size: var(--fs-xs);
}
</style>
