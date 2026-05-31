<!--
  WorkflowCanvas.vue — VueFlow wrapper cho /workflows. Render workflow nodes/edges,
  xử lý drop agent từ palette, connect/disconnect, drag node, remove node/edge.

  Props:
    - workflow         Workflow đang chọn (đã guard non-null ở parent).
    - agents           Toàn bộ agent (để hydrate node data).
    - skills           Toàn bộ skill (để hydrate node data + lookup default skill khi drop).
    - selectedNodeId   Node id đang select (null nếu không có). Drive `selected` flag VueFlow.

  Emits:
    - update:nodes        Khi nodes thay đổi (drop / drag / remove).
    - update:edges        Khi edges thay đổi (connect / remove / dọn orphan sau remove node).
    - update:selectedNode ID node mới được click, null khi click pane trống.

  Notes:
    - `useVueFlow()` được khởi tạo NỘI BỘ — không pass instance qua props (rule nuxt-vue.md).
    - Edge id format ràng buộc với `utils/workflow-edges.ts` (`${from}-${to}-${i}`).
    - Hai overlay (floating info card + minimap mask) cần tone "panel translucent"
      phụ thuộc theme — tạm thời tính trong component này; nâng lên theme token khi
      có thêm caller (Rule of Three).
-->
<template>
  <div
    ref="canvasContainer"
    class="flex-1 relative overflow-hidden"
    :style="{ background: t.bgCanvas }"
    @drop="onCanvasDrop"
    @dragover.prevent
  >
    <div class="absolute top-3 left-3 z-10 flex items-center gap-2 text-[1em] pointer-events-none">
      <div
        class="flex items-center gap-1.5 px-2.5 py-1 rounded backdrop-blur"
        :style="{ background: panelOverlayBg, border: `1px solid ${t.border}` }"
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
        :mask-color="minimapMaskColor"
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
        <div class="text-[1em]" :style="{ color: t.textDim }">Drag agents from the left to begin</div>
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
import { GitBranch, Workflow } from 'lucide-vue-next'
import WorkflowAgentNode from '~/components/workflows/WorkflowAgentNode.vue'
import type { Agent, Skill, Workflow as WorkflowEntity, WorkflowEdge, WorkflowNode } from '~/types'
import {
  deriveEdgeId,
  extractRemovedIds,
  filterEdgesByRemovedIds,
  filterEdgesByRemovedNodes,
} from '~/utils/workflow-edges'

type Props = {
  workflow: WorkflowEntity
  agents: Agent[]
  skills: Skill[]
  selectedNodeId: string | null
}

type Emits = {
  'update:nodes': [nodes: WorkflowNode[]]
  'update:edges': [edges: WorkflowEdge[]]
  'update:selectedNode': [id: string | null]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t, themeName } = useTheme()

const canvasContainer = ref<HTMLElement | null>(null)

const nodeTypes: NodeTypesObject = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: markRaw(WorkflowAgentNode) as any,
}

// Map workflow → VueFlow elements
const vfElements = computed<(Node | Edge)[]>(() => {
  const nodes: Node[] = props.workflow.nodes.map((n) => ({
    id: n.id,
    type: 'agent',
    position: { x: n.x, y: n.y },
    data: {
      agent: props.agents.find((a) => a.id === n.agentId),
      skill: props.skills.find((s) => s.id === n.skillId),
      outputs: n.outputs,
      approval: n.approval,
    },
    selected: props.selectedNodeId === n.id,
  }))
  const edges: Edge[] = props.workflow.edges.map((e, i) => ({
    id: deriveEdgeId(e, i),
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

// Tone overlay phụ thuộc theme — chỉ dùng nội bộ canvas. Khi thêm caller, nâng lên theme token.
const panelOverlayBg = computed(() =>
  themeName.value === 'dark' ? 'rgba(10, 10, 10, 0.85)' : 'rgba(255, 255, 255, 0.85)',
)
const minimapMaskColor = computed(() =>
  themeName.value === 'dark' ? 'rgba(10, 10, 10, 0.7)' : 'rgba(255, 255, 255, 0.7)',
)

const { project } = useVueFlow()

const onConnect = (conn: Connection) => {
  if (!conn.source || !conn.target) return
  if (conn.source === conn.target) return
  const exists = props.workflow.edges.find((e) => e.from === conn.source && e.to === conn.target)
  if (exists) return
  emit('update:edges', [...props.workflow.edges, { from: conn.source, to: conn.target }])
}

const onNodeDragStop = (e: NodeDragEvent) => {
  const updated = props.workflow.nodes.map((n) =>
    n.id === e.node.id ? { ...n, x: e.node.position.x, y: e.node.position.y } : n,
  )
  emit('update:nodes', updated)
}

const onNodesChange = (changes: NodeChange[]) => {
  const removed = extractRemovedIds(changes)
  if (removed.length === 0) return
  emit(
    'update:nodes',
    props.workflow.nodes.filter((n) => !removed.includes(n.id)),
  )
  emit('update:edges', filterEdgesByRemovedNodes(props.workflow.edges, removed))
  if (props.selectedNodeId && removed.includes(props.selectedNodeId)) {
    emit('update:selectedNode', null)
  }
}

const onEdgesChange = (changes: EdgeChange[]) => {
  const removed = extractRemovedIds(changes)
  if (removed.length === 0) return
  emit('update:edges', filterEdgesByRemovedIds(props.workflow.edges, removed))
}

const onNodeClick = (e: NodeMouseEvent) => {
  emit('update:selectedNode', e.node.id)
}

const onPaneClick = () => {
  emit('update:selectedNode', null)
}

const onCanvasDrop = (e: DragEvent) => {
  e.preventDefault()
  if (!canvasContainer.value) return
  const agentId = e.dataTransfer?.getData('agentId')
  if (!agentId) return
  const agent = props.agents.find((a) => a.id === agentId)
  if (!agent) return
  const firstSkill = props.skills.find((s) => agent.skillIds.includes(s.id))

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
    outputs: ['output.md'],
    approval: false,
  }
  emit('update:nodes', [...props.workflow.nodes, newNode])
  emit('update:selectedNode', newNode.id)
}
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
