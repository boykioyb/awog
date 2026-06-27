<template>
  <div class="forkcanvas">
    <VueFlow
      :model-value="vfElements"
      :node-types="nodeTypes"
      :default-edge-options="defaultEdgeOptions"
      :min-zoom="0.4"
      :max-zoom="1.6"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="true"
      :delete-key-code="null"
      fit-view-on-init
      @node-click="onNodeClick"
    >
      <Background pattern-color="var(--border)" :gap="20" :size="1" />
      <Controls position="bottom-right" :show-interactive="false" />
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
// Read-only VueFlow graph of a session's fork lineage. Maps useSessionForkTree's
// nodes/edges → VueFlow elements with a simple layered layout (depth → x, pre-order
// row → y). Clicking a node navigates to that session. Mirrors WorkflowCanvas's
// VueFlow wiring (useVueFlow created internally), minus the editing affordances.
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import {
  MarkerType,
  VueFlow,
  type Edge,
  type Node,
  type NodeComponent,
  type NodeMouseEvent,
  type NodeTypesObject,
} from '@vue-flow/core'
import { computed, markRaw } from 'vue'
import SessionForkNode from '~/components/session/SessionForkNode.vue'
import { useSessionForkTree } from '~/composables/useSessionForkTree'

const props = defineProps<{ clientId: number }>()
const emit = defineEmits<{ navigate: [clientId: number] }>()

const { treeFor } = useSessionForkTree()
const tree = computed(() => treeFor(props.clientId))

const nodeTypes: NodeTypesObject = {
  fork: markRaw(SessionForkNode) as unknown as NodeComponent,
}

const COL = 230
const ROW = 86

const vfElements = computed<(Node | Edge)[]>(() => {
  const nodes: Node[] = tree.value.nodes.map((n) => ({
    id: n.id,
    type: 'fork',
    position: { x: n.depth * COL, y: n.row * ROW },
    data: { title: n.title, when: n.when, isCurrent: n.isCurrent, clientId: n.clientId },
    selectable: true,
  }))
  const edges: Edge[] = tree.value.edges.map((e, i) => ({
    id: `${e.from}-${e.to}-${i}`,
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

function onNodeClick(e: NodeMouseEvent) {
  const cid = (e.node.data as { clientId?: number })?.clientId
  if (typeof cid === 'number') emit('navigate', cid)
}
</script>

<style scoped>
.forkcanvas {
  position: relative;
  width: 100%;
  height: 100%;
  background-image: none;
}
</style>

<style>
/* Blend VueFlow internals with the AWOG palette (unscoped — reaches the controls). */
.forkcanvas .vue-flow__handle {
  width: 7px;
  height: 7px;
  background: var(--borderStrong);
  border: 2px solid var(--bgEl);
}
.forkcanvas .vue-flow__controls {
  box-shadow: none;
  border-radius: 8px;
  overflow: hidden;
}
.forkcanvas .vue-flow__controls button {
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
}
.forkcanvas .vue-flow__controls button:hover {
  background: var(--bgHover);
  color: var(--text);
}
.forkcanvas .vue-flow__controls button svg {
  fill: currentColor;
}
</style>
