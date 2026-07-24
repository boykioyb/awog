<template>
  <section class="page on" data-page="agents">
    <LibraryView
      :items="agents"
      :item-key="agentKey"
      :search-text="(a) => a.name + a.id + a.role + a.model"
      :placeholder="t('agents.search')"
      :group-by="groupKey"
      :group-label="groupLabel"
      :group-dot="groupDot"
      show-new
      @new="openCreator()"
      @new-in-group="openCreator"
    >
      <template #row="{ item: a }">
        <div class="lrow">
          <span class="lav" :style="avatarStyleFor(a)">{{ initialsFor(a) }}</span>
          <span class="ttl">{{ a.name }}</span>
          <span v-if="a.source === 'project'" class="tag acc" style="padding: 1px 6px">
            {{ t('agents.tier.project') }}
          </span>
        </div>
        <div class="sub" style="margin-left: 30px">{{ subFor(a) }}</div>
      </template>

      <template #detail="{ item: a }">
        <AgentDetail
          :agent="a"
          :projects="projectListWithPath"
          :mcp-servers="mcpServers"
          @edit="openEditor(a)"
          @duplicate="onDuplicate(a)"
          @delete="askDelete(a)"
          @edit-body="openBodyEdit(a)"
        />
      </template>
    </LibraryView>

    <!-- create (chat-driven AGENT.md authoring) -->
    <AgentPromptCreator
      :open="creatorOpen"
      :account="account"
      :projects="projectList"
      :initial-scope="creatorScope"
      @close="onCreatorClose"
      @turn="onCreatorTurn"
    />

    <!-- edit (form) -->
    <AgentEditor
      :open="editorOpen"
      :agent="editTarget"
      :projects="projectListWithPath"
      :mcp-servers="mcpServers"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- edit system prompt (LLM revise) -->
    <AgentBodyEditModal
      v-if="bodyEditTarget"
      :open="bodyEditOpen"
      :agent="bodyEditTarget"
      :account-id="accountId"
      @apply="onApplyBodyEdit"
      @cancel="closeBodyEdit"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('agents.delete')"
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
// Agents library — live store + full CRUD + chat-driven creation. Replaces the
// static mock from the prototype port. Shell from <LibraryView>; all state +
// handlers live in useAgentsPage (page-controller), mirroring pages/skills.vue.
import { computed, type CSSProperties } from 'vue'
import AgentBodyEditModal from '~/components/agent/AgentBodyEditModal.vue'
import AgentDetail from '~/components/agent/AgentDetail.vue'
import AgentEditor from '~/components/agent/AgentEditor.vue'
import AgentPromptCreator from '~/components/agent/AgentPromptCreator.vue'
import {
  agentAvatar,
  agentInitials,
  modelDisplayName,
  providerDisplayName,
} from '~/components/agent/agent-display'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useAgentsPage } from '~/composables/useAgentsPage'
import { useProjects } from '~/composables/useProjects'
import type { Agent } from '~/stores/agents'

const { t } = useI18n()
const { projects, projectPath, projectName } = useProjects()

const {
  agents,
  agentKey,
  projectList,
  account,
  accountId,
  mcpServers,
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
  toasts,
  toastColor,
} = useAgentsPage()

// Project list enriched with the on-disk path (for tier hints in editor/detail).
const projectListWithPath = computed(() =>
  projects.value.map((p) => ({ id: p.id, name: p.name, path: projectPath(p.id) ?? undefined })),
)

// Row avatar / initials / sub-label (provider · model display).
const avatarStyleFor = (a: Agent): CSSProperties => {
  const av = agentAvatar(a)
  return { background: av.bg, color: av.fg }
}
const initialsFor = (a: Agent): string => agentInitials(a)
const subFor = (a: Agent): string =>
  `${modelDisplayName(a.model)} · ${providerDisplayName(a.provider)}`

// Group the list by tier (global vs each project) — like the Sessions list.
const groupKey = (a: Agent) => (a.source === 'project' && a.projectId ? a.projectId : 'global')
const groupLabel = (key: string) =>
  key === 'global' ? t('library.group.global') : projectName(key)
const groupDot = (key: string) => (key === 'global' ? 'var(--textDim)' : 'var(--accent)')
</script>
