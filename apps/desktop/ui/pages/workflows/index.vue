<template>
  <div class="flex flex-1 overflow-hidden">
    <!-- Workflow list + Agent palette -->
    <div
      class="flex flex-col flex-shrink-0 w-full md:w-60"
      :class="{ 'hidden md:flex': mobilePane === 'detail' }"
      :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div
        class="px-3 py-2.5 flex items-center justify-between"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="text-[11px] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
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
        <div
          v-for="wf in store.workflows"
          :key="wf.id"
          class="w-full text-left px-2 py-1.5 rounded transition cursor-pointer"
          :style="{
            background: selectedWorkflowId === wf.id ? t.bgActive : 'transparent',
            borderLeft: `2px solid ${selectedWorkflowId === wf.id ? t.accent : 'transparent'}`,
          }"
          @click="selectWorkflow(wf.id)"
          @contextmenu="onContextMenu($event, wf.id)"
          @mouseenter="
            (e) => {
              if (selectedWorkflowId !== wf.id)
                (e.currentTarget as HTMLElement).style.background = t.bgHover
            }
          "
          @mouseleave="
            (e) => {
              if (selectedWorkflowId !== wf.id)
                (e.currentTarget as HTMLElement).style.background = 'transparent'
            }
          "
        >
          <div class="flex items-center gap-1.5">
            <Workflow :size="11" :style="{ color: t.textDim }" />
            <input
              v-if="renamingId === wf.id"
              :ref="setRenameInputRef"
              v-model="renameValue"
              class="text-[12px] flex-1 rounded px-1 py-0.5"
              :style="{
                background: t.bgInput,
                border: `1px solid ${t.borderStrong}`,
                color: t.text,
                outline: 'none',
              }"
              @click.stop
              @keydown.enter="commitRename"
              @keydown.escape="cancelRename"
              @blur="commitRename"
            />
            <div
              v-else
              class="text-[12px] truncate flex-1"
              :style="{ color: t.text }"
              @dblclick.stop="startRename(wf.id, wf.name)"
            >
              {{ wf.name }}
            </div>
            <button
              class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
              :style="{ color: t.textMuted }"
              title="Actions"
              @click.stop="openMenuFromButton($event, wf.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[10px] mt-0.5 ml-5" :style="{ color: t.textDim }">
            {{ wf.nodes.length }} steps · {{ wf.edges.length }} edges
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto" :style="{ borderTop: `1px solid ${t.border}` }">
        <div
          class="px-3 py-2 sticky top-0"
          :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
        >
          <div
            class="text-[11px] uppercase tracking-wider font-medium"
            :style="{ color: t.textDim }"
          >
            Drag agents to canvas
          </div>
        </div>
        <div class="p-2 space-y-0.5">
          <div
            v-for="agent in store.agents"
            :key="agent.id"
            :draggable="true"
            class="px-2 py-1.5 rounded cursor-grab active:cursor-grabbing transition"
            @dragstart="(e) => onAgentDragStart(e, agent.id)"
            @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.background = t.bgHover)"
            @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')"
          >
            <div class="flex items-center gap-1.5 min-w-0">
              <div class="text-[11px] truncate" :style="{ color: t.text }">
                {{ agent.name }}
              </div>
              <span
                class="text-[8px] uppercase tracking-wider font-semibold flex-shrink-0 px-1 py-0.5 rounded"
                :style="{
                  color: t.textMuted,
                  background: t.bgInput,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ agent.role }}
              </span>
            </div>
            <div class="text-[9px]" :style="{ color: t.textDim }">
              {{ agent.skillIds.length }} skills
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Canvas -->
    <div
      v-if="workflow"
      ref="canvasContainer"
      class="flex-1 relative overflow-hidden"
      :class="{ 'hidden md:block': mobilePane === 'list' }"
      :style="{ background: t.bgCanvas }"
      @drop="onCanvasDrop"
      @dragover.prevent
    >
      <button
        class="md:hidden flex items-center gap-1 px-3 py-2 text-xs transition relative z-20"
        :style="{
          color: t.textMuted,
          borderBottom: `1px solid ${t.border}`,
          background: t.bgPanel,
        }"
        @click="mobilePane = 'list'"
      >
        <ChevronLeft :size="14" />
        Back
      </button>

      <div class="absolute top-3 left-3 z-10 flex items-center gap-2 text-xs pointer-events-none">
        <div
          class="flex items-center gap-1.5 px-2.5 py-1 rounded backdrop-blur"
          :style="{
            background:
              themeName === 'dark' ? 'rgba(10, 10, 10, 0.85)' : 'rgba(255, 255, 255, 0.85)',
            border: `1px solid ${t.border}`,
          }"
        >
          <GitBranch :size="11" :style="{ color: t.textDim }" />
          <span :style="{ color: t.text }">{{ workflow.name }}</span>
          <span :style="{ color: t.textFaint }" class="mx-1">·</span>
          <span :style="{ color: t.textDim }">
            {{ workflow.nodes.length }} agents · {{ workflow.edges.length }} edges
          </span>
        </div>
      </div>

      <VueFlow
        :model-value="vfElements"
        :node-types="nodeTypes"
        :default-edge-options="defaultEdgeOptions"
        :connection-line-style="connectionLineStyle"
        :min-zoom="0.4"
        :max-zoom="2"
        :default-viewport="{ x: 0, y: 0, zoom: 1 }"
        :delete-key-code="null"
        fit-view-on-init
        @connect="onConnect"
        @node-drag-stop="onNodeDragStop"
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        @node-click="onNodeClick"
        @pane-click="onPaneClick"
      >
        <Background :pattern-color="t.dotPattern" :gap="20" :size="1" />
        <Controls position="bottom-right" :show-interactive="false" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          :node-color="t.bgElevated"
          :node-stroke-color="t.border"
          :mask-color="themeName === 'dark' ? 'rgba(10, 10, 10, 0.7)' : 'rgba(255, 255, 255, 0.7)'"
        />
      </VueFlow>

      <div
        v-if="workflow.nodes.length === 0"
        class="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      >
        <div class="text-center">
          <Workflow
            :size="28"
            class="mx-auto mb-2"
            :stroke-width="1.5"
            :style="{ color: t.textFaint }"
          />
          <div class="text-sm" :style="{ color: t.textDim }">
            Drag agents from the left to begin
          </div>
        </div>
      </div>
    </div>

    <div
      v-else
      class="flex-1 flex items-center justify-center"
      :class="{ 'hidden md:flex': mobilePane === 'list' }"
    >
      <div class="text-center">
        <Workflow
          :size="28"
          class="mx-auto mb-2"
          :stroke-width="1.5"
          :style="{ color: t.textFaint }"
        />
        <div class="text-sm" :style="{ color: t.textDim }">No workflow selected</div>
      </div>
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

    <!-- Inspector -->
    <div
      class="w-72 flex-col flex-shrink-0 hidden md:flex"
      :style="{ borderLeft: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="px-3 py-2.5" :style="{ borderBottom: `1px solid ${t.border}` }">
        <div class="text-[11px] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
          Inspector
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        <WorkflowNodeInspector
          v-if="selectedNode && selectedAgent"
          :node="selectedNode"
          :agent="selectedAgent"
          :skill="selectedSkill"
          :available-skills="selectedAgentSkills"
          @update:node="onInspectorUpdate"
        />
        <div v-else class="text-center text-xs py-12" :style="{ color: t.textDim }">
          <Eye
            :size="20"
            class="mx-auto mb-2"
            :stroke-width="1.5"
            :style="{ color: t.textFaint }"
          />
          Select a node to edit
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import {
  MarkerType,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeDragEvent,
  type NodeMouseEvent,
  type NodeTypesObject,
} from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import {
  ChevronLeft,
  Edit3,
  Eye,
  GitBranch,
  MoreHorizontal,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-vue-next'
import WorkflowAgentNode from '~/components/WorkflowAgentNode.vue'
import type { WorkflowEdge, WorkflowNode } from '~/types'
import type { WorkflowDraft } from '~/composables/useWorkflowGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t, themeName } = useTheme()
const store = useWorkspaceStore()

const selectedWorkflowId = ref<string | null>(store.workflows[0]?.id ?? null)
const selectedNodeId = ref<string | null>(null)
const canvasContainer = ref<HTMLElement | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')

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

const workflow = computed(() => store.workflows.find((w) => w.id === selectedWorkflowId.value))

const nodeTypes: NodeTypesObject = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: markRaw(WorkflowAgentNode) as any,
}

// Map Pinia workflow → VueFlow nodes + edges
const vfElements = computed<(Node | Edge)[]>(() => {
  if (!workflow.value) return []
  const nodes: Node[] = workflow.value.nodes.map((n) => ({
    id: n.id,
    type: 'agent',
    position: { x: n.x, y: n.y },
    data: {
      agent: store.agents.find((a) => a.id === n.agentId),
      skill: store.skills.find((s) => s.id === n.skillId),
      outputs: n.outputs,
      approval: n.approval,
    },
    selected: selectedNodeId.value === n.id,
  }))
  const edges: Edge[] = workflow.value.edges.map((e, i) => ({
    id: `${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    type: 'default',
  }))
  return [...nodes, ...edges]
})

const defaultEdgeOptions = computed(() => ({
  type: 'default',
  animated: false,
  style: {
    stroke: t.value.textDim,
    strokeWidth: 2,
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: t.value.textDim,
    width: 18,
    height: 18,
  },
}))

const connectionLineStyle = computed(() => ({
  stroke: t.value.connectingEdge,
  strokeWidth: 2,
  strokeDasharray: '4 4',
}))

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

const { project } = useVueFlow()

const setNodes = (nodes: WorkflowNode[]) => {
  if (!workflow.value) return
  store.updateWorkflowNodes(workflow.value.id, nodes)
}

const setEdges = (edges: WorkflowEdge[]) => {
  if (!workflow.value) return
  store.updateWorkflowEdges(workflow.value.id, edges)
}

const onConnect = (conn: Connection) => {
  if (!workflow.value || !conn.source || !conn.target) return
  if (conn.source === conn.target) return
  const exists = workflow.value.edges.find((e) => e.from === conn.source && e.to === conn.target)
  if (exists) return
  setEdges([...workflow.value.edges, { from: conn.source, to: conn.target }])
}

const onNodeDragStop = (e: NodeDragEvent) => {
  if (!workflow.value) return
  const updated = workflow.value.nodes.map((n) =>
    n.id === e.node.id ? { ...n, x: e.node.position.x, y: e.node.position.y } : n,
  )
  setNodes(updated)
}

const onNodesChange = (changes: NodeChange[]) => {
  // Handle removals from VueFlow (e.g., delete-button or backspace)
  const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
  if (removed.length === 0 || !workflow.value) return
  setNodes(workflow.value.nodes.filter((n) => !removed.includes(n.id)))
  setEdges(workflow.value.edges.filter((e) => !removed.includes(e.from) && !removed.includes(e.to)))
  if (selectedNodeId.value && removed.includes(selectedNodeId.value)) {
    selectedNodeId.value = null
  }
}

const onEdgesChange = (changes: EdgeChange[]) => {
  const removedIds = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
  if (removedIds.length === 0 || !workflow.value) return
  // Edge id format: `${from}-${to}-${i}` — parse back
  const newEdges = workflow.value.edges.filter((_, i) => {
    const wouldHaveId = (e: WorkflowEdge) => `${e.from}-${e.to}-${i}`
    return !removedIds.includes(wouldHaveId(workflow.value!.edges[i]!))
  })
  setEdges(newEdges)
}

const onNodeClick = (e: NodeMouseEvent) => {
  selectedNodeId.value = e.node.id
}

const onPaneClick = () => {
  selectedNodeId.value = null
}

const onAgentDragStart = (e: DragEvent, agentId: string) => {
  e.dataTransfer?.setData('agentId', agentId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

const onCanvasDrop = (e: DragEvent) => {
  e.preventDefault()
  if (!workflow.value || !canvasContainer.value) return
  const agentId = e.dataTransfer?.getData('agentId')
  if (!agentId) return
  const agent = store.agents.find((a) => a.id === agentId)
  if (!agent) return
  const firstSkill = store.skills.find((s) => agent.skillIds.includes(s.id))

  const rect = canvasContainer.value.getBoundingClientRect()
  const position = project({
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  })

  const newNode: WorkflowNode = {
    id: `n${Date.now()}`,
    agentId,
    skillId: firstSkill?.id || agent.skillIds[0] || '',
    x: position.x - 100,
    y: position.y - 30,
    outputs: firstSkill ? [...firstSkill.outputs] : ['output.md'],
    approval: false,
  }
  setNodes([...workflow.value.nodes, newNode])
  selectedNodeId.value = newNode.id
}

const selectWorkflow = (id: string) => {
  selectedWorkflowId.value = id
  selectedNodeId.value = null
  mobilePane.value = 'detail'
}

const onInspectorUpdate = (updated: WorkflowNode) => {
  if (!workflow.value) return
  setNodes(workflow.value.nodes.map((n) => (n.id === updated.id ? updated : n)))
}

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const pendingDeleteId = ref<string | null>(null)

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, id: string) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, id }
}

const openMenuFromButton = (e: MouseEvent, id: string) => {
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

<style>
/* VueFlow theme overrides to blend with AWOG palette */
.vue-flow__node {
  font-family: inherit;
}
.vue-flow__handle {
  border-radius: 9999px;
}
.vue-flow__controls {
  box-shadow: none;
  border-radius: 6px;
  overflow: hidden;
}
.vue-flow__controls button {
  background: var(--vf-controls-bg, #161616);
  border-bottom: 1px solid var(--vf-controls-border, #222);
  color: var(--vf-controls-fg, #a3a3a3);
}
.vue-flow__controls button:hover {
  background: var(--vf-controls-hover-bg, #1a1a1a);
  color: var(--vf-controls-hover-fg, #ededed);
}
.vue-flow__controls button svg {
  fill: currentColor;
}
.vue-flow__minimap {
  border-radius: 6px;
  overflow: hidden;
}
</style>
