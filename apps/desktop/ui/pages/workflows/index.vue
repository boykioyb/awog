<template>
  <div class="flex flex-1 overflow-hidden">
    <MasterDetailShell
      v-model:mobile-pane="mobilePane"
      :selected-id="selectedWorkflowId"
      list-width="15rem"
    >
      <template #list>
        <div
          class="px-3 py-2.5 flex items-center justify-between"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div
            class="text-[0.79em] uppercase tracking-wider font-medium"
            :style="{ color: t.textDim }"
          >
            Workflows
          </div>
          <button
            ref="newButtonRef"
            class="transition"
            :style="{ color: t.textDim }"
            title="New workflow"
            @click="openPromptModal"
            @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
            @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
          >
            <Plus :size="13" />
          </button>
        </div>

        <div class="overflow-y-auto p-2 space-y-0.5" style="max-height: 40%">
          <WorkflowListItem
            v-for="wf in store.workflows"
            :key="wf.id"
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

        <WorkflowPalette :agents="store.agents" />
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
        <EmptyView :icon="Workflow" title="No workflow selected" />
      </template>
    </MasterDetailShell>

    <!-- Inspector (3rd pane, sibling to MasterDetailShell) -->
    <WorkflowInspectorPane
      :node="selectedNode"
      :agent="selectedAgent"
      :skill="selectedSkill"
      :available-skills="selectedAgentSkills"
      @update:node="onInspectorUpdate"
    />
  </div>

  <WorkflowPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    @save="onPromptSave"
    @cancel="showPromptModal = false"
  />

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    title="Delete workflow?"
    :description="`Workflow '${pendingDeleteName}' sẽ bị xóa.`"
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
import type { WorkflowEdge, WorkflowNode } from '~/types'
import type { WorkflowDraft } from '~/composables/useWorkflowGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const store = useWorkspaceStore()

const selectedWorkflowId = ref<string | null>(store.workflows[0]?.id ?? null)
const selectedNodeId = ref<string | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')

const workflow = computed(() => store.workflows.find((w) => w.id === selectedWorkflowId.value))

const selectedNode = computed(() =>
  workflow.value?.nodes.find((n) => n.id === selectedNodeId.value),
)

const selectedAgent = computed(() =>
  selectedNode.value ? store.agents.find((a) => a.id === selectedNode.value!.agentId) : undefined,
)

const selectedSkill = computed(() =>
  selectedNode.value ? store.skills.find((s) => s.id === selectedNode.value!.skillId) : undefined,
)

const selectedAgentSkills = computed(() => {
  if (!selectedAgent.value) return []
  return store.skills.filter((s) => selectedAgent.value!.skillIds.includes(s.id))
})

const openPromptModal = () => {
  const rect = newButtonRef.value?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onPromptSave = (draft: WorkflowDraft) => {
  const wf = store.createWorkflow(draft.name)
  store.saveWorkflow({ ...wf, description: draft.description })
  selectedWorkflowId.value = wf.id
  selectedNodeId.value = null
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onNodesUpdate = (nodes: WorkflowNode[]) => {
  if (!workflow.value) return
  store.updateWorkflowNodes(workflow.value.id, nodes)
}

const onEdgesUpdate = (edges: WorkflowEdge[]) => {
  if (!workflow.value) return
  store.updateWorkflowEdges(workflow.value.id, edges)
}

const onSelectedNodeUpdate = (id: string | null) => {
  selectedNodeId.value = id
}

const selectWorkflow = (id: string) => {
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
  const wf = store.workflows.find((w) => w.id === id)
  if (trimmed && wf && trimmed !== wf.name) {
    store.renameWorkflow(id, trimmed)
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const pendingDeleteName = computed(
  () => store.workflows.find((w) => w.id === pendingDeleteId.value)?.name ?? '',
)

const confirmDelete = () => {
  if (!pendingDeleteId.value) return
  const deletingId = pendingDeleteId.value
  store.deleteWorkflow(deletingId)
  if (selectedWorkflowId.value === deletingId) {
    selectedWorkflowId.value = store.workflows[0]?.id ?? null
    selectedNodeId.value = null
  }
  pendingDeleteId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const wf = store.workflows.find((w) => w.id === ctx.id)
  if (!wf) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(wf.id, wf.name) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = wf.id
      },
    },
  ]
})
</script>
