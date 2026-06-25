<template>
  <div class="flex flex-1 overflow-hidden gap-2">
    <MasterDetailShell
      v-model:mobile-pane="mobilePane"
      :selected-id="selectedWorkflowId"
      list-width="15rem"
      resizable
      storage-key="awog.workflows.listWidth"
    >
      <template #list>
        <div
          class="px-3 py-3 flex items-center justify-between gap-2"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div
            class="text-[1em] uppercase tracking-wider font-medium"
            :style="{ color: t.textDim }"
          >
            {{ tr('workflows.header') }}
          </div>
          <AppButton
            ref="newButtonRef"
            variant="ghost"
            size="icon"
            :title="tr('workflows.new')"
            @click="openPromptModal"
          >
            <Plus :size="14" />
          </AppButton>
        </div>

        <!-- Scope: filters the list AND sets where a new workflow is saved
             (Global = shared; a project = lives in that repo). -->
        <div class="px-3 py-2.5" :style="{ borderBottom: `1px solid ${t.border}` }">
          <AppSelect v-model="scopeFilter">
            <option v-for="o in scopeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </AppSelect>
        </div>

        <div class="overflow-y-auto p-2 space-y-1" style="max-height: 40%">
          <WorkflowListItem
            v-for="wf in displayedWorkflows"
            :key="`${wf.source ?? 'global'}:${wf.projectId ?? ''}:${wf.id}`"
            v-model:rename-value="renameValue"
            :workflow="wf"
            :selected="selectedWorkflowId === wf.id"
            :renaming="renamingId === wf.id"
            @select="selectWorkflow(wf.id)"
            @context-menu="onListItemMenu($event, wf.id)"
            @start-rename="startRename(wf.id, wf.name)"
            @commit-rename="commitRename"
            @cancel-rename="cancelRename"
          />
        </div>

        <WorkflowPalette :agents="paletteAgents" />
      </template>

      <template #detail>
        <WorkflowCanvas
          v-if="workflow"
          :workflow="workflow"
          :agents="store.agents"
          :skills="store.skills"
          :selected-node-id="selectedNodeId"
          @update:nodes="onNodesUpdate"
          @update:edges="onEdgesUpdate"
          @update:selected-node="onSelectedNodeUpdate"
        />
      </template>

      <template #empty-detail>
        <EmptyView :icon="Workflow" :title="tr('workflows.empty')" />
      </template>
    </MasterDetailShell>

    <!-- Inspector (3rd pane) — hidden by default, only shown when a node is selected. -->
    <WorkflowInspectorPane
      v-if="selectedNode"
      :node="selectedNode"
      :agent="selectedAgent"
      :skill="selectedSkill"
      :available-skills="availableSkills"
      @update:node="onInspectorUpdate"
    />
  </div>

  <WorkflowPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    :projects="store.projects"
    :agents="store.agents"
    :default-scope="scopeFilter === 'all' ? 'global' : scopeFilter"
    @save="onPromptSave"
    @cancel="showPromptModal = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    :title="tr('workflows.delete.title')"
    :description="tr('workflows.delete.desc', { name: pendingDeleteName })"
    :cancel-label="tr('common.cancel')"
    :confirm-label="tr('common.delete')"
    @confirm="confirmDelete"
    @cancel="pendingDeleteId = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />
</template>

<script setup lang="ts">
import { Edit3, Plus, Trash2, Workflow } from 'lucide-vue-next'
import type { Agent, WorkflowEdge, WorkflowNode } from '~/types'
import type { WorkflowDraft } from '~/composables/useWorkflowGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
// Agents/skills stay in the workspace store; workflows are their own live store.
const store = useWorkspaceStore()
const workflowsStore = useWorkflowsStore()

onMounted(async () => {
  // hydrateFromSidecar ensures projects are loaded first; then pull agents +
  // skills (the palette + node skill picker need them — this page is reachable
  // without visiting /agents or /skills first).
  await workflowsStore.hydrateFromSidecar()
  const ids = store.projects.map((p) => p.id)
  void store.hydrateAgentsFromSidecar(ids)
  void store.hydrateSkillsFromSidecar(ids)
})

// Flush any pending debounced canvas persistence before navigating away so a
// drag/connect right before leaving the page is never lost.
onBeforeUnmount(() => {
  workflowsStore.flushPendingPersist()
})

const selectedWorkflowId = ref<string | null>(workflowsStore.workflows[0]?.id ?? null)
const selectedNodeId = ref<string | null>(null)
const showPromptModal = ref(false)
// AppButton is a component → the template ref points at the instance; read the DOM via `.$el`.
const newButtonRef = ref<{ $el: HTMLElement } | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')

// Scope value: 'all' (view everything), 'global', or a projectId. Doubles as the
// target scope for a newly-created workflow ('all' → global).
const scopeFilter = ref<string>('all')

const scopeOptions = computed(() => [
  { value: 'all', label: tr('workflows.scope.all') },
  { value: 'global', label: tr('workflows.scope.global') },
  ...store.projects.map((p) => ({ value: p.id, label: p.name })),
])

const displayedWorkflows = computed(() => {
  const scope = scopeFilter.value
  if (scope === 'all') return workflowsStore.workflows
  if (scope === 'global') {
    return workflowsStore.workflows.filter((w) => (w.source ?? 'global') === 'global')
  }
  return workflowsStore.workflows.filter((w) => w.source === 'project' && w.projectId === scope)
})

const workflow = computed(() =>
  workflowsStore.workflows.find((w) => w.id === selectedWorkflowId.value),
)

// Agents shown in the palette, filtered to what the SELECTED workflow can use:
//   - project workflow → portable (global/user) agents + that project's agents
//   - global workflow (or none) → only portable agents, so a shared workflow
//     never references a project agent that won't exist when run elsewhere.
const isProjectAgent = (a: Agent): boolean => a.source === 'project'

const paletteAgents = computed<Agent[]>(() => {
  const wf = workflow.value
  if (wf?.source === 'project' && wf.projectId) {
    return store.agents.filter((a) => !isProjectAgent(a) || a.projectId === wf.projectId)
  }
  return store.agents.filter((a) => !isProjectAgent(a))
})

const selectedNode = computed(() =>
  workflow.value?.nodes.find((n) => n.id === selectedNodeId.value),
)

const selectedAgent = computed(() =>
  selectedNode.value ? store.agents.find((a) => a.id === selectedNode.value!.agentId) : undefined,
)

const selectedSkill = computed(() =>
  selectedNode.value ? store.skills.find((s) => s.id === selectedNode.value!.skillId) : undefined,
)

// Skills are independent of agents now — the node skill picker offers every
// available skill, not a per-agent subset.
const availableSkills = computed(() => store.skills)

const openPromptModal = () => {
  const rect = newButtonRef.value?.$el?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onPromptSave = (draft: WorkflowDraft, scope: string) => {
  // scope comes from the modal's "Save to" picker ('global' or a projectId).
  // draft.nodes/edges come from the LLM (empty in the offline mock fallback).
  const wf = workflowsStore.createWorkflow(draft.name, scope)
  workflowsStore.saveWorkflow({
    ...wf,
    description: draft.description,
    nodes: draft.nodes,
    edges: draft.edges,
  })
  // Switch the list filter to the new workflow's scope so it's visible + selected.
  scopeFilter.value = scope
  selectedWorkflowId.value = wf.id
  selectedNodeId.value = null
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onNodesUpdate = (nodes: WorkflowNode[]) => {
  if (!workflow.value) return
  workflowsStore.updateWorkflowNodes(workflow.value.id, nodes)
}

const onEdgesUpdate = (edges: WorkflowEdge[]) => {
  if (!workflow.value) return
  workflowsStore.updateWorkflowEdges(workflow.value.id, edges)
}

const onSelectedNodeUpdate = (id: string | null) => {
  selectedNodeId.value = id
}

const selectWorkflow = (id: string) => {
  // Flush pending edits for the current workflow before switching away.
  workflowsStore.flushPendingPersist()
  selectedWorkflowId.value = id
  selectedNodeId.value = null
  mobilePane.value = 'detail'
}

const onInspectorUpdate = (updated: WorkflowNode) => {
  if (!workflow.value) return
  onNodesUpdate(workflow.value.nodes.map((n) => (n.id === updated.id ? updated : n)))
}

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const pendingDeleteId = ref<string | null>(null)

// Mở context menu cho 1 workflow row. Cả 2 trigger (right-click row, click MoreHorizontal
// button) đều đi qua đây: right-click dùng vị trí chuột; button click dùng vị trí bounding
// rect của nút.
const onListItemMenu = (e: MouseEvent, id: string) => {
  if (e.type === 'contextmenu') {
    contextMenu.value = { x: e.clientX, y: e.clientY, id }
    return
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, id }
}

const startRename = (id: string, current: string) => {
  renamingId.value = id
  renameValue.value = current
}

const commitRename = () => {
  const id = renamingId.value
  if (!id) return
  const trimmed = renameValue.value.trim()
  const wf = workflowsStore.workflows.find((w) => w.id === id)
  if (trimmed && wf && trimmed !== wf.name) {
    workflowsStore.renameWorkflow(id, trimmed)
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const pendingDeleteName = computed(
  () => workflowsStore.workflows.find((w) => w.id === pendingDeleteId.value)?.name ?? '',
)

const confirmDelete = () => {
  if (!pendingDeleteId.value) return
  const deletingId = pendingDeleteId.value
  workflowsStore.deleteWorkflow(deletingId)
  if (selectedWorkflowId.value === deletingId) {
    selectedWorkflowId.value = workflowsStore.workflows[0]?.id ?? null
    selectedNodeId.value = null
  }
  pendingDeleteId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const wf = workflowsStore.workflows.find((w) => w.id === ctx.id)
  if (!wf) return []
  return [
    { label: tr('common.rename'), icon: Edit3, action: () => startRename(wf.id, wf.name) },
    {
      label: tr('common.delete'),
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = wf.id
      },
    },
  ]
})
</script>
