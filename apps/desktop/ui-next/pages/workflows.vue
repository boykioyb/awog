<template>
  <section class="flex min-w-0 flex-1 overflow-hidden" data-page="workflows">
    <!-- relative: neo drawer list ở chế độ hẹp (useResponsiveShell). -->
    <div class="relative flex min-w-0 flex-1 overflow-hidden">
      <!-- list sidebar: header + scope filter + workflow list + agent palette.
           Chế độ hẹp (compact) → drawer trượt từ cạnh trái, bật/tắt bằng listOpen
           (nút ở AppTopBar, scrim ở layout). -->
      <div
        class="flex w-70 shrink-0 flex-col overflow-hidden border-r bg-sidebar"
        :class="
          compact && [
            'absolute inset-y-0 left-0 z-91 max-w-[82vw] shadow-lg transition-transform duration-200 motion-reduce:transition-none',
            listOpen ? 'translate-x-0' : '-translate-x-full',
          ]
        "
      >
        <div class="flex shrink-0 items-center justify-between gap-2 border-b p-3">
          <div class="text-xs font-medium text-muted-foreground">{{ t('workflow.header') }}</div>
          <Button
            :title="t('workflow.new')"
            :aria-label="t('workflow.new')"
            variant="outline"
            size="iconMd"
            @click="openCreator"
          >
            <Icon name="plus" />
          </Button>
        </div>
        <div class="shrink-0 border-b px-3 py-2">
          <AppSelect v-model="scopeFilter" :options="scopeOptions" width="100%" />
        </div>
        <div class="max-h-[42%] shrink-0 overflow-y-auto p-2">
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
          <div v-if="!displayedWorkflows.length" class="px-2 py-4 text-center text-sm text-faint">
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
      <div v-else class="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div
          class="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-muted-foreground"
        >
          <span class="grid size-12 place-items-center rounded-xl border bg-card">
            <Icon name="workflows" class="size-5" />
          </span>
          <div class="text-lg">{{ t('workflow.emptyDetail') }}</div>
        </div>
      </div>

      <!-- inspector (shown only when a node is selected) -->
      <WorkflowInspector
        v-if="selectedNode"
        :node="selectedNode"
        :agent="selectedAgent"
        :skill="selectedSkill"
        :available-skills="availableSkills"
        :gate-targets="gateTargets"
        @update:node="onInspectorUpdate"
      />
    </div>

    <!-- chat-to-workflow generation -->
    <WorkflowPromptCreator
      :open="creatorOpen"
      :agents="allAgents"
      :skills="allSkills"
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
  </section>
</template>

<script setup lang="ts">
// Workflows — live store + VueFlow DAG editor + chat-driven generation (ADR 0024).
// Ported from the prototype. 3-pane layout: list sidebar
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
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const { compact, listOpen } = useResponsiveShell()

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
  gateTargets,
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
