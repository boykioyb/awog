<template>
  <!-- Màn Graph kiến trúc & luồng request (Mốc 5, G1). SFC này chỉ ghép khối + bind;
       toàn bộ state + lời gọi RPC nằm ở `useInfraGraph()` (khuôn page-controller).

       TỰ ĐỨNG ĐƯỢC: props duy nhất là minh chứng phiên (không bắt buộc) để ghi nhật
       ký. Người tích hợp chỉ cần nhét component này vào một tab — nó tự đọc ngữ cảnh
       hạ tầng đang ghim qua `useInfraContext()`.

       BỐ CỤC: thanh điểm vào/độ sâu → các dải nói thật (nguồn lưu lượng · chạm trần
       độ sâu · ghi chú · lỗi) → canvas + panel chi tiết. -->
  <div class="ig">
    <header class="ig-top">
      <div class="ig-field">
        <div class="ig-lbl">{{ t('infra.graph.root.label') }}</div>
        <AppSelect
          :model-value="activeRootId"
          :options="rootOptions"
          :placeholder="t('infra.graph.root.placeholder')"
          :disabled="busy || !roots.length"
          width="240px"
          @update:model-value="onRootSelect"
        />
      </div>

      <div class="ig-field">
        <div class="ig-lbl">{{ t('infra.graph.depth.label') }}</div>
        <AppSelect
          :model-value="String(depth)"
          :options="depthOptions"
          :disabled="busy"
          width="96px"
          @update:model-value="onDepthSelect"
        />
      </div>

      <span class="ig-gap" />

      <span
        v-if="hasGraph"
        class="chip"
        :class="`s-${trafficSource}`"
        :title="t('infra.graph.traffic.label')"
      >
        <Icon name="activity" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ trafficLabel }}
      </span>
      <span v-if="loadedAt" class="ig-when">{{ t('infra.graph.loadedAt', { time: hhmm }) }}</span>

      <button
        class="btn sm"
        type="button"
        :disabled="busy || !activeRootId"
        :aria-busy="resolving"
        @click="onReload"
      >
        <Icon
          name="refresh"
          :class="{ spin: resolving }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ t('infra.graph.reload') }}
      </button>
    </header>

    <p v-if="hasGraph" class="ig-info">{{ trafficNote }}</p>
    <p v-if="truncated" class="ig-warn">
      {{ t('infra.graph.depth.truncated', { max: GRAPH_MAX_DEPTH }) }}
    </p>
    <p v-if="notes.length" class="ig-info">{{ t('infra.graph.notes.title') }}: {{ notesText }}</p>
    <p v-if="graphError && hasGraph" class="ig-error">{{ graphError }}</p>

    <div class="ig-body">
      <div class="ig-canvas">
        <!-- `:nodes-draggable="false"`: toạ độ do bố cục tầng ở `useInfraGraph` tính
             ra và KHÔNG có đường ghi ngược (khác `WorkflowCanvas` — ở đó kéo xong là
             ghi `x/y` về store). Để kéo được thì cú chạm lại của lượt dựng sau sẽ
             giật node về chỗ cũ, tệ hơn là không cho kéo. -->
        <VueFlow
          :model-value="vfElements"
          :node-types="nodeTypes"
          :edge-types="edgeTypes"
          :default-edge-options="defaultEdgeOptions"
          :min-zoom="0.25"
          :max-zoom="2"
          :nodes-connectable="false"
          :nodes-draggable="false"
          :delete-key-code="null"
          fit-view-on-init
          @node-click="onNodeClick"
          @pane-click="onPaneClick"
        >
          <Background pattern-color="var(--border)" :gap="20" :size="1" />
          <Controls position="bottom-right" :show-interactive="false" />
          <MiniMap position="bottom-left" pannable zoomable />
        </VueFlow>

        <div v-if="!hasGraph && !resolving" class="ig-overlay">
          <template v-if="graphError">
            <p class="ig-overlay-err">{{ graphError }}</p>
            <button class="btn sm" type="button" @click="onRetry">
              <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.graph.retry') }}
            </button>
          </template>
          <InfraGraphRoots
            v-else
            :roots="roots"
            :loading="rootsLoading"
            :error="rootsError"
            :notes="rootsNotes"
            @select="onRootSelect"
            @retry="onRootsRetry"
          />
        </div>

        <div v-else-if="resolving" class="ig-overlay" :class="{ ghost: hasGraph }">
          <p class="ig-overlay-busy">
            <Icon
              name="refresh"
              class="spin"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ t('infra.graph.loading') }}
          </p>
        </div>
      </div>

      <InfraGraphPanel
        v-if="selectedNode"
        :node="selectedNode"
        :is-root="graphRootIds.includes(selectedNode.id)"
        :expanding="expandingNodeId === selectedNode.id"
        @expand="onExpand"
        @close="selectNode('')"
      />
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
  type Edge,
  type EdgeComponent,
  type EdgeTypesObject,
  type Node,
  type NodeComponent,
  type NodeMouseEvent,
  type NodeTypesObject,
} from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { computed, markRaw, nextTick, onMounted } from 'vue'
import InfraGraphEdgeComponent from '~/components/infra/graph/InfraGraphEdge.vue'
import InfraGraphNodeComponent from '~/components/infra/graph/InfraGraphNode.vue'
import InfraGraphPanel from '~/components/infra/graph/InfraGraphPanel.vue'
import InfraGraphRoots from '~/components/infra/graph/InfraGraphRoots.vue'
import { useInfraGraph, GRAPH_DEPTHS, GRAPH_MAX_DEPTH } from '~/composables/useInfraGraph'
import type { InfraGraphNode as GraphNodeEntity } from '~/composables/useInfraGraphApi'

// Minh chứng phiên để ghi nhật ký hạ tầng — bỏ trống ở bề mặt `/infra`.
const props = defineProps<{ sessionId?: string; messageId?: string }>()

const { t } = useI18n()

const {
  roots,
  rootsNotes,
  rootsLoading,
  rootsError,
  rootOptions,
  loadRoots,
  activeRootId,
  depth,
  nodes,
  edges,
  graphRootIds,
  positions,
  truncated,
  trafficSource,
  notes,
  hasGraph,
  busy,
  resolving,
  expandingNodeId,
  selectedNode,
  graphError,
  loadedAt,
  resolve,
  reload,
  setDepth,
  expand,
  selectNode,
} = useInfraGraph({
  ...(props.sessionId ? { sessionId: props.sessionId } : {}),
  ...(props.messageId ? { messageId: props.messageId } : {}),
})

const { fitView } = useVueFlow()

const nodeTypes: NodeTypesObject = {
  service: markRaw(InfraGraphNodeComponent) as unknown as NodeComponent,
  external: markRaw(InfraGraphNodeComponent) as unknown as NodeComponent,
}
const edgeTypes: EdgeTypesObject = {
  infra: markRaw(InfraGraphEdgeComponent) as unknown as EdgeComponent,
}

type NodeData = {
  node: GraphNodeEntity
  isRoot: boolean
  isExpanding: boolean
  onExpand: (id: string) => void
}

const defaultEdgeOptions = {
  type: 'infra',
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--borderStrong)', width: 16, height: 16 },
}

/** store → VueFlow: vị trí lấy từ bố cục tầng của page-controller. */
const vfElements = computed<(Node | Edge)[]>(() => {
  const rootSet = new Set(graphRootIds.value)
  const flowNodes: Node[] = nodes.value.map((n) => ({
    id: n.id,
    type: n.kind,
    position: positions.value[n.id] ?? { x: 60, y: 60 },
    data: {
      node: n,
      isRoot: rootSet.has(n.id),
      isExpanding: expandingNodeId.value === n.id,
      onExpand: expand,
    } satisfies NodeData,
    selected: selectedNode.value?.id === n.id,
  }))
  const flowEdges: Edge[] = edges.value.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: 'infra',
    data: { edge },
  }))
  return [...flowNodes, ...flowEdges]
})

const depthOptions = computed(() =>
  GRAPH_DEPTHS.map((n) => ({ value: String(n), label: t('infra.graph.depth.value', { n }) })),
)

const trafficLabel = computed(() => t(`infra.graph.traffic.${trafficSource.value}`))
const trafficNote = computed(() => t(`infra.graph.traffic.note.${trafficSource.value}`))
const notesText = computed(() => notes.value.map((n) => t(n)).join(' · '))
const hhmm = computed(() => {
  const d = new Date(loadedAt.value)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

/** Canh lại khung nhìn sau khi số node đổi — graph mọc thêm thì phải thấy được. */
async function refit(): Promise<void> {
  await nextTick()
  fitView({ padding: 0.2 })
}

async function onRootSelect(id: string): Promise<void> {
  if (!id) return
  await resolve(id)
  await refit()
}

async function onDepthSelect(value: string): Promise<void> {
  await setDepth(Number(value))
  await refit()
}

async function onReload(): Promise<void> {
  await reload()
  await refit()
}

async function onRetry(): Promise<void> {
  if (activeRootId.value) {
    await reload()
    await refit()
    return
  }
  await loadRoots(true)
}

function onRootsRetry(): void {
  void loadRoots(true)
}

function onExpand(id: string): void {
  void expand(id)
}

function onNodeClick(e: NodeMouseEvent): void {
  selectNode(e.node.id)
}

function onPaneClick(): void {
  selectNode('')
}

// Nạp danh sách điểm vào khi bề mặt được mở. Tab này MOUNT LƯỜI (người tích hợp mở
// nó sau một cú bấm), nên `onMounted` chính là "người dùng vừa mở màn Graph" — không
// có lượt ĐỌC nào chạy sau lưng người dùng. Bản thân `resolve` (dựng graph) thì
// KHÔNG tự chạy: nó chỉ chạy khi người dùng chọn một điểm vào.
onMounted(() => {
  void loadRoots()
})
</script>

<style scoped>
.ig {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.ig-top {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  row-gap: 8px;
  padding: 10px 14px 8px;
  flex: 0 0 auto;
  box-shadow: inset 0 -1px 0 var(--border);
}

.ig-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ig-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.ig-gap {
  flex: 1;
}

.ig-when {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
}

.chip.s-xray {
  color: var(--green);
  border-color: var(--green);
}

.chip.s-cloudwatch {
  color: var(--amber);
  border-color: var(--amber);
}

.chip.s-none {
  color: var(--textDim);
}

.ig-info,
.ig-warn,
.ig-error {
  margin: 0;
  padding: 6px 14px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  flex: 0 0 auto;
}

.ig-info {
  color: var(--textMuted);
  background: var(--bgSubtle);
}

.ig-warn {
  color: var(--amber);
  background: var(--bgSubtle);
}

.ig-error {
  color: var(--red);
  background: var(--bgSubtle);
}

.ig-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.ig-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
}

/* Lớp phủ trạng thái rỗng KHÔNG được nuốt thao tác kéo/zoom của canvas: chỉ thẻ
   bên trong mới nhận con trỏ. */
.ig-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  background: var(--bgCanvas);
  pointer-events: none;
}

.ig-overlay > * {
  pointer-events: auto;
}

/* Đang dựng LẠI mà graph đã có sẵn (đổi độ sâu, bấm ↻): graph cũ vẫn là thứ người
   dùng đang đọc nên không phủ mờ nó — chỉ treo một nhãn nhỏ ở giữa. */
.ig-overlay.ghost {
  background: transparent;
}

.ig-overlay.ghost .ig-overlay-busy {
  padding: 6px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bgPanel);
  box-shadow: var(--shadow-md);
}

.ig-overlay-err {
  margin: 0;
  color: var(--red);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}

.ig-overlay-busy {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

/* Cùng khuôn với `.iad-spin` của InfraAccountsDetail.vue: `.spin` KHÔNG phải class
   toàn cục, style scoped nên mỗi SFC tự khai keyframes của mình. */
.spin {
  animation: ig-spin 0.8s linear infinite;
}

@keyframes ig-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>

<style>
/* Hoà VueFlow vào bảng màu AWOG (không scoped — phải chạm tới nội bộ của VueFlow). */
.ig-canvas .vue-flow__node {
  font-family: var(--sans);
}
.ig-canvas .vue-flow__handle {
  width: 9px;
  height: 9px;
  border-radius: var(--r-pill);
  background: var(--borderStrong);
  border: 2px solid var(--bgCanvas);
}
.ig-canvas .vue-flow__controls {
  box-shadow: none;
  border-radius: var(--r-sm);
  overflow: hidden;
}
.ig-canvas .vue-flow__controls button {
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
}
.ig-canvas .vue-flow__controls button:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ig-canvas .vue-flow__controls button svg {
  fill: currentColor;
}
.ig-canvas .vue-flow__minimap {
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--bgPanel);
}
</style>
