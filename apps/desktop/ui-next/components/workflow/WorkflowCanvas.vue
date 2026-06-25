<template>
  <div ref="canvasEl" class="canvas wfcanvas" @drop="onDrop" @dragover.prevent>
    <div class="wftoolbar">
      <span class="chip">{{ scopeLabel }}</span>
      <span class="chip">{{ t('workflow.toolbar.dag', { n: workflow.nodes.length }) }}</span>
      <span style="flex: 1" />
      <button class="btn pri sm" :disabled="!workflow.nodes.length" @click="$emit('run')">
        <Icon name="play" style="width: 13px; height: 13px" />
        {{ t('workflow.toolbar.run') }}
      </button>
    </div>

    <VueFlow
      :model-value="vfElements"
      :node-types="nodeTypes"
      :default-edge-options="defaultEdgeOptions"
      :min-zoom="0.4"
      :max-zoom="2"
      :delete-key-code="null"
      fit-view-on-init
      @connect="onConnect"
      @node-drag-stop="onNodeDragStop"
      @nodes-change="onNodesChange"
      @edges-change="onEdgesChange"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
    >
      <Background pattern-color="var(--border)" :gap="20" :size="1" />
      <Controls position="bottom-right" :show-interactive="false" />
      <MiniMap position="bottom-left" pannable zoomable />
    </VueFlow>

    <div v-if="workflow.nodes.length === 0" class="wfempty">
      <span class="ei"><Icon name="workflows" style="width: 20px; height: 20px" /></span>
      <div class="et">{{ t('workflow.canvas.empty') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Live VueFlow canvas for /workflows. Maps the selected workflow's store
// nodes/edges → a single VueFlow `model-value` element list, renders agent nodes
// via WorkflowNode, and emits node/edge/selection updates back to the
// page-controller (which writes to the store with a debounced upsert).
// useVueFlow() is created INTERNALLY — the instance is never passed via props
// (rule nuxt-vue.md). Node `data` is plain (markRaw'd component) so the small
// graph stays cheap to re-derive.
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
  type NodeComponent,
  type NodeDragEvent,
  type NodeMouseEvent,
  type NodeTypesObject,
} from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { computed, markRaw, useTemplateRef } from 'vue'
import WorkflowNode from '~/components/workflow/WorkflowNode.vue'
import type { WorkflowAgent, WorkflowSkill } from '~/composables/useWorkflowGen'
import type {
  Workflow as WorkflowEntity,
  WorkflowEdge,
  WorkflowNode as WfNode,
} from '~/stores/workflows'

const props = defineProps<{
  workflow: WorkflowEntity
  agents: WorkflowAgent[]
  skills: WorkflowSkill[]
  selectedNodeId: string | null
  scopeLabel: string
}>()

const emit = defineEmits<{
  'update:nodes': [nodes: WfNode[]]
  'update:edges': [edges: WorkflowEdge[]]
  'update:selectedNode': [id: string | null]
  run: []
}>()

const { t } = useI18n()

const canvasEl = useTemplateRef<HTMLElement>('canvasEl')

// markRaw so Vue never makes the component definition reactive.
const nodeTypes: NodeTypesObject = {
  agent: markRaw(WorkflowNode) as unknown as NodeComponent,
}

// Edge id format must stay in sync with the from/to → VueFlow mapping below so
// removal (EdgeChange) can map an id back to its WorkflowEdge.
const edgeId = (e: WorkflowEdge, i: number): string => `${e.from}-${e.to}-${i}`

// Remove node(s) + their orphaned edges, then clear the selection if it pointed
// at a removed node. Declared before vfElements so the per-node onDelete closure
// can reference it.
const deleteNodes = (ids: string[]) => {
  const set = new Set(ids)
  emit(
    'update:nodes',
    props.workflow.nodes.filter((n) => !set.has(n.id)),
  )
  emit(
    'update:edges',
    props.workflow.edges.filter((e) => !set.has(e.from) && !set.has(e.to)),
  )
  if (props.selectedNodeId && set.has(props.selectedNodeId)) emit('update:selectedNode', null)
}
const deleteNode = (id: string) => deleteNodes([id])

// store → VueFlow elements (single combined model, like the old UI). The graph
// is small (≤50 nodes per the generate cap) so a computed re-map is cheap; node
// positions update synchronously on drag-stop (store mutates wf.nodes before the
// debounced persist) so VueFlow never snaps a dragged node back.
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
      onDelete: (id: string) => deleteNode(id),
    },
    selected: props.selectedNodeId === n.id,
  }))
  const edges: Edge[] = props.workflow.edges.map((e, i) => ({
    id: edgeId(e, i),
    source: e.from,
    target: e.to,
    type: 'default',
  }))
  return [...nodes, ...edges]
})

const defaultEdgeOptions = {
  type: 'default',
  animated: false,
  style: { stroke: 'var(--borderStrong)', strokeWidth: 1.8 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--borderStrong)', width: 16, height: 16 },
}

const { project } = useVueFlow()

// --- mutations → emit to page-controller ------------------------------------
const onConnect = (conn: Connection) => {
  if (!conn.source || !conn.target || conn.source === conn.target) return
  if (props.workflow.edges.some((e) => e.from === conn.source && e.to === conn.target)) return
  emit('update:edges', [...props.workflow.edges, { from: conn.source, to: conn.target }])
}

const onNodeDragStop = (e: NodeDragEvent) => {
  emit(
    'update:nodes',
    props.workflow.nodes.map((n) =>
      n.id === e.node.id ? { ...n, x: e.node.position.x, y: e.node.position.y } : n,
    ),
  )
}

const removedIds = (changes: { type: string }[]): string[] =>
  changes.filter((c) => c.type === 'remove').map((c) => (c as unknown as { id: string }).id)

const onNodesChange = (changes: NodeChange[]) => {
  const removed = removedIds(changes)
  if (removed.length === 0) return
  deleteNodes(removed)
}

const onEdgesChange = (changes: EdgeChange[]) => {
  const removed = removedIds(changes)
  if (removed.length === 0) return
  const removedSet = new Set(removed)
  emit(
    'update:edges',
    props.workflow.edges.filter((e, i) => !removedSet.has(edgeId(e, i))),
  )
}

const onNodeClick = (e: NodeMouseEvent) => emit('update:selectedNode', e.node.id)
const onPaneClick = () => emit('update:selectedNode', null)

// --- drop an agent from the palette ----------------------------------------
const onDrop = (e: DragEvent) => {
  e.preventDefault()
  if (!canvasEl.value) return
  const agentId = e.dataTransfer?.getData('agentId')
  if (!agentId) return
  const agent = props.agents.find((a) => a.id === agentId)
  if (!agent) return

  const rect = canvasEl.value.getBoundingClientRect()
  const pos = project({ x: e.clientX - rect.left, y: e.clientY - rect.top })

  // Capture the agent identity tuple at drop time (ADR 0024 D-11). node.skillId
  // starts empty — the user picks one in the inspector.
  const node: WfNode = {
    id: `n${Date.now()}`,
    agentId,
    agentSource: agent.source,
    skillId: '',
    x: pos.x - 75,
    y: pos.y - 28,
    outputs: ['output.md'],
    approval: false,
  }
  if (agent.projectId !== undefined) node.agentProjectId = agent.projectId
  emit('update:nodes', [...props.workflow.nodes, node])
  emit('update:selectedNode', node.id)
}
</script>

<style scoped>
.wfcanvas {
  flex: 1;
  min-width: 0;
  /* The prototype .canvas paints a static dot grid; VueFlow's <Background> draws
     a pan/zoom-aware one instead, so drop the static layer here. */
  background-image: none;
}
.wfempty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--textDim);
  pointer-events: none;
}
.wfempty .ei {
  width: 48px;
  height: 48px;
  border-radius: 13px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  color: var(--textDim);
}
.wfempty .et {
  font-size: 1.0769rem;
  color: var(--textMuted);
}
.btn.pri.sm:disabled {
  opacity: 0.45;
  cursor: default;
  filter: none;
}
</style>

<style>
/* VueFlow theme overrides to blend with the AWOG prototype palette. Unscoped so
   they reach the VueFlow internals (controls/minimap/handles). */
.wfcanvas .vue-flow__node {
  font-family: var(--sans);
}
.wfcanvas .vue-flow__handle {
  border-radius: 9999px;
  width: 9px;
  height: 9px;
  background: var(--borderStrong);
  border: 2px solid var(--bgCanvas);
}
.wfcanvas .vue-flow__controls {
  box-shadow: none;
  border-radius: 8px;
  overflow: hidden;
}
.wfcanvas .vue-flow__controls button {
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
}
.wfcanvas .vue-flow__controls button:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wfcanvas .vue-flow__controls button svg {
  fill: currentColor;
}
.wfcanvas .vue-flow__minimap {
  border-radius: 8px;
  overflow: hidden;
  background: var(--bgPanel);
}
</style>
