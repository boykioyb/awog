<template>
  <section class="page on" data-page="workflows">
    <div class="md">
      <!-- list sidebar: header + scope filter + workflow list + agent palette -->
      <div class="list wflist">
        <div class="wflist-hd">
          <div class="wflist-title">{{ t('workflow.header') }}</div>
          <button class="iconbtn" :title="t('workflow.new')" @click="openCreator">
            <Icon name="plus" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="wflist-scope">
          <AppSelect v-model="scopeFilter" :options="scopeOptions" width="100%" />
        </div>
        <div class="wflist-scroll">
          <WorkflowListItem
            v-for="wf in displayedWorkflows"
            :key="`${wf.source ?? 'global'}:${wf.projectId ?? ''}:${wf.id}`"
            v-model:rename-value="renameValue"
            :workflow="wf"
            :selected="selectedWorkflowId === wf.id"
            :renaming="renamingId === wf.id"
            :projects="projectList"
            @select="selectWorkflow(wf.id)"
            @delete="askDelete(wf.id)"
            @start-rename="startRename(wf.id, wf.name)"
            @commit-rename="commitRename"
            @cancel-rename="cancelRename"
          />
          <div v-if="!displayedWorkflows.length" class="wflist-empty">
            {{ t('workflow.empty') }}
          </div>
        </div>
        <WorkflowPalette :agents="paletteAgents" :projects="projectList" />
      </div>

      <!-- canvas -->
      <WorkflowCanvas
        v-if="workflow"
        :workflow="workflow"
        :agents="allAgents"
        :skills="allSkills"
        :selected-node-id="selectedNodeId"
        :scope-label="canvasScopeLabel"
        @update:nodes="onNodesUpdate"
        @update:edges="onEdgesUpdate"
        @update:selected-node="onSelectNode"
        @run="onRun"
      />
      <div v-else class="detail">
        <div class="empty">
          <span class="ei"><Icon name="workflows" style="width: 20px; height: 20px" /></span>
          <div class="et">{{ t('workflow.emptyDetail') }}</div>
        </div>
      </div>

      <!-- inspector (shown only when a node is selected) -->
      <WorkflowInspector
        v-if="selectedNode"
        :node="selectedNode"
        :agent="selectedAgent"
        :skill="selectedSkill"
        :available-skills="availableSkills"
        @update:node="onInspectorUpdate"
      />
    </div>

    <!-- chat-to-workflow generation -->
    <WorkflowPromptCreator
      :open="creatorOpen"
      :agents="paletteAgents"
      :projects="projectList"
      :default-scope="scopeFilter === 'all' ? 'global' : scopeFilter"
      :generate="generate"
      @save="onCreatorSave"
      @close="closeCreator"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDeleteId"
      :title="t('workflow.delete.title')"
      :description="t('workflow.delete.desc', { name: pendingDeleteName })"
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
// Workflows — live store + VueFlow DAG editor + chat-driven generation (ADR 0024).
// Replaces the static mock from the prototype port. 3-pane layout: list sidebar
// (with agent palette) + VueFlow canvas + node inspector. All state + handlers
// live in useWorkflowsPage (page-controller); this stays a thin template.
import { computed } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import WorkflowCanvas from '~/components/workflow/WorkflowCanvas.vue'
import WorkflowInspector from '~/components/workflow/WorkflowInspector.vue'
import WorkflowListItem from '~/components/workflow/WorkflowListItem.vue'
import WorkflowPalette from '~/components/workflow/WorkflowPalette.vue'
import WorkflowPromptCreator from '~/components/workflow/WorkflowPromptCreator.vue'
import { useWorkflowsPage } from '~/composables/useWorkflowsPage'

const { t } = useI18n()

const {
  projectList,
  generate,
  scopeFilter,
  scopeOptions,
  displayedWorkflows,
  selectedWorkflowId,
  selectedNodeId,
  workflow,
  selectWorkflow,
  allAgents,
  allSkills,
  paletteAgents,
  selectedNode,
  selectedAgent,
  selectedSkill,
  availableSkills,
  onNodesUpdate,
  onEdgesUpdate,
  onSelectNode,
  onInspectorUpdate,
  creatorOpen,
  openCreator,
  closeCreator,
  onCreatorSave,
  renamingId,
  renameValue,
  startRename,
  commitRename,
  cancelRename,
  pendingDeleteId,
  askDelete,
  cancelDelete,
  pendingDeleteName,
  confirmDelete,
  onRun,
  toasts,
  toastColor,
} = useWorkflowsPage()

// Tier label rendered in the canvas toolbar chip.
const canvasScopeLabel = computed(() => {
  const wf = workflow.value
  if (wf?.source === 'project' && wf.projectId) {
    return projectList.value.find((p) => p.id === wf.projectId)?.name ?? t('workflow.scope.project')
  }
  return t('workflow.scope.global')
})
</script>

<style scoped>
.wflist {
  flex: 0 0 280px;
}
.wflist-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.wflist-title {
  font-size: 0.7692rem;
  font-family: var(--code);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--textDim);
}
.wflist-scope {
  padding: 9px 11px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.wflist-scroll {
  overflow-y: auto;
  padding: 7px;
  max-height: 42%;
  flex: 0 0 auto;
}
.wflist-empty {
  padding: 16px 9px;
  font-size: 0.8846rem;
  color: var(--textFaint);
  text-align: center;
}
</style>
