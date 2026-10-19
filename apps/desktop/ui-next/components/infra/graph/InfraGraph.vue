<template>
  <!-- Màn Graph kiến trúc & luồng request (Mốc 5, G1). SFC này chỉ ghép khối + bind;
       toàn bộ state + lời gọi RPC nằm ở `useInfraGraph()` (khuôn page-controller).

       TỰ ĐỨNG ĐƯỢC: props duy nhất là minh chứng phiên (không bắt buộc) để ghi nhật
       ký. Người tích hợp chỉ cần nhét component này vào một tab — nó tự đọc ngữ cảnh
       hạ tầng đang ghim qua `useInfraContext()`.

       BỐ CỤC: thanh điểm vào/độ sâu → các dải nói thật (nguồn lưu lượng · chạm trần
       độ sâu · ghi chú · lỗi) → canvas + panel chi tiết. -->
  <div class="flex h-full min-h-0 flex-col">
    <!-- Thanh công cụ là một CARD nổi trên canvas full-bleed (margin thay padding để
         thanh vẫn là một khối tách khỏi canvas bên dưới). Ô nhãn-trên-control nên
         thanh căn theo ĐÁY: nhãn cao thấp khác nhau thì căn giữa đẩy các ô lệch. -->
    <header
      class="mx-3.5 mt-2.5 mb-2 flex shrink-0 flex-wrap items-end gap-2.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm"
    >
      <div class="flex min-w-35 flex-col gap-1">
        <Label class="text-xs font-normal text-muted-foreground">
          {{ t('infra.graph.root.label') }}
        </Label>
        <AppSelect
          :model-value="activeRootId"
          :options="rootOptions"
          :placeholder="t('infra.graph.root.placeholder')"
          :disabled="busy || !roots.length"
          width="240px"
          @update:model-value="onRootSelect"
        />
      </div>

      <div class="flex min-w-27.5 flex-col gap-1">
        <Label class="text-xs font-normal text-muted-foreground">
          {{ t('infra.graph.depth.label') }}
        </Label>
        <AppSelect
          :model-value="String(depth)"
          :options="depthOptions"
          :disabled="busy"
          width="96px"
          @update:model-value="onDepthSelect"
        />
      </div>

      <!-- `ml-auto` đẩy cụm về mép phải mà không cần một <div> trống làm spacer. -->
      <div class="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
        <Badge
          v-if="hasGraph"
          variant="outline"
          :class="TRAFFIC_TONE[trafficSource]"
          :title="t('infra.graph.traffic.label')"
        >
          <Icon name="act" />
          {{ trafficLabel }}
        </Badge>
        <span v-if="loadedAt" class="text-xs text-faint tabular-nums">
          {{ t('infra.graph.loadedAt', { time: hhmm }) }}
        </span>

        <Button
          type="button"
          :disabled="busy || !activeRootId"
          :aria-busy="resolving"
          variant="outline"
          size="sm"
          @click="onReload"
        >
          <Icon name="refresh" :class="{ 'motion-safe:animate-spin': resolving }" />
          {{ t('infra.graph.reload') }}
        </Button>
      </div>
    </header>

    <!-- G4: dải nói rõ sơ đồ đang bị lọc theo một request, kèm đường thoát. Không
         có dải này thì một sơ đồ mờ quá nửa trông như sơ đồ hỏng. -->
    <p
      v-if="traceHighlight.on.value"
      :class="[BAND, 'flex flex-wrap items-center gap-2 text-muted-foreground']"
    >
      <span>
        {{
          t('infra.graph.trace.banner', {
            id: traceHighlight.traceId.value,
            n: tracePathCount,
          })
        }}
      </span>
      <span v-if="tracePathCount === 0" class="text-warning">
        {{ t('infra.graph.trace.noMatch') }}
      </span>
      <Button type="button" variant="outline" size="sm" @click="traceHighlight.clear()">
        {{ t('infra.graph.trace.clear') }}
      </Button>
    </p>
    <p v-if="hasGraph" :class="[BAND, 'text-muted-foreground']">{{ trafficNote }}</p>
    <p v-if="truncated" :class="[BAND, 'text-warning']">
      {{ t('infra.graph.depth.truncated', { max: GRAPH_MAX_DEPTH }) }}
    </p>
    <p v-if="notes.length" :class="[BAND, 'text-muted-foreground']">
      {{ t('infra.graph.notes.title') }}: {{ notesText }}
    </p>
    <p v-if="graphError && hasGraph" :class="[BAND, 'text-destructive']">{{ graphError }}</p>

    <div class="flex min-h-0 flex-1">
      <!-- hook-ok: `.ig-canvas` là gốc phạm vi cho khối style toàn cục (DOM VueFlow) bên dưới -->
      <div class="ig-canvas relative min-w-0 flex-1">
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
          <!-- ⚠ `position` GIỮ NGUYÊN `bottom-right`, còn chỗ đứng thật thì do CSS
               kéo lên trên — xem `.ig-canvas .vue-flow__panel.vue-flow__controls`.

               VÌ SAO KHÔNG DÙNG `top-right`: prop đó khiến VueFlow gắn class `top`
               lên chính phần tử, mà `.top` LÀ THANH TIÊU ĐỀ CỦA APP trong
               prototype.css — `height: 44px; gap: 12px; padding: 0 18px; box-shadow:
               inset 0 -1px 0 var(--border)`, cộng `-webkit-app-region: drag` ở
               app-shell.css. Chồng zoom vì thế phình thành một hộp cao 44px, ba nút
               giãn ra 12px, có một vạch kẻ bên trong, và vùng đệm quanh nó thành tay
               kéo cửa sổ (đo 2026-09-16, sau khi người dùng nói "css đang không được
               đẹp với các button"). `bottom`/`left`/`right` không đụng class toàn cục
               nào — chỉ `top`. Cùng họ lỗi với `.grow` sáng nay. -->
          <Controls position="bottom-right" :show-interactive="false" />
          <MiniMap position="bottom-left" pannable zoomable />
        </VueFlow>

        <!-- Lớp phủ trạng thái rỗng KHÔNG được nuốt thao tác kéo/zoom của canvas:
             chỉ thẻ bên trong mới nhận con trỏ. -->
        <div v-if="!hasGraph && !resolving" :class="[OVERLAY, 'bg-background']">
          <template v-if="graphError">
            <p class="text-center text-sm text-destructive">{{ graphError }}</p>
            <Button type="button" variant="outline" size="sm" @click="onRetry">
              <Icon name="refresh" />
              {{ t('infra.graph.retry') }}
            </Button>
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

        <!-- Đang dựng LẠI mà graph đã có sẵn (đổi độ sâu, bấm ↻): graph cũ vẫn là thứ
             người dùng đang đọc nên không phủ mờ nó — chỉ treo một nhãn nhỏ ở giữa. -->
        <div
          v-else-if="resolving"
          :class="[OVERLAY, hasGraph ? 'bg-transparent' : 'bg-background']"
        >
          <p
            class="flex items-center gap-2 text-sm text-muted-foreground"
            :class="hasGraph && 'rounded-full border bg-card px-3 py-1.5 shadow-md'"
          >
            <Icon name="refresh" class="size-3.5 motion-safe:animate-spin" />
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
        @open-logs="emit('open-logs', $event)"
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
import { useInfraTraceHighlight } from '~/composables/useInfraTraceHighlight'
import type { InfraGraphNode as GraphNodeEntity } from '~/composables/useInfraGraphApi'
import Button from '~/components/ui/button/Button.vue'

// Minh chứng phiên để ghi nhật ký hạ tầng — bỏ trống ở bề mặt `/infra`.
const props = defineProps<{ sessionId?: string; messageId?: string }>()

/** Node → màn Logs (G4). Sơ đồ KHÔNG tự mở tab: trang sở hữu việc chuyển tab. */
const emit = defineEmits<{
  'open-logs': [group: { kind: 'exact' | 'prefix'; value: string }]
}>()

const { t } = useI18n()

/** Màu badge nguồn lưu lượng: X-Ray (đo thật) xanh, CloudWatch (suy từ số đo) vàng. */
const TRAFFIC_TONE: Record<string, string> = {
  xray: 'border-success text-success',
  cloudwatch: 'border-warning text-warning',
  none: 'text-dim',
}
/** Dải nói thật full-bleed phía trên canvas (nguồn lưu lượng · trần độ sâu · lỗi). */
const BAND = 'shrink-0 bg-muted px-3.5 py-1.5 text-xs'
/** Lớp phủ trên canvas; `*:pointer-events-auto` để chỉ thẻ bên trong nhận con trỏ. */
const OVERLAY =
  'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-4 *:pointer-events-auto'

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

// Bản sao hình dạng `data` mà `InfraGraphNode.vue` đọc. Hai bản phải khớp từng
// trường — VueFlow không kiểm kiểu qua `data`, nên lệch một trường là một cờ luôn
// `undefined` mà không ai báo.
type NodeData = {
  node: GraphNodeEntity
  isRoot: boolean
  isExpanding: boolean
  onExpand: (id: string) => void
  onPath: boolean
  offPath: boolean
  failed: boolean
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
      // `onPath === null` nghĩa là KHÔNG có đường đi nào đang tô ⇒ không node nào
      // bị làm mờ. Khác hẳn "đường đi rỗng", thứ sẽ làm mờ cả sơ đồ.
      onPath: tracePath.value?.has(n.id) ?? false,
      offPath: tracePath.value !== null && !tracePath.value.has(n.id),
      failed: traceFailed.value.has(n.id),
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

// ── Tô đường đi của một request (G4) ────────────────────────────────────────
const traceHighlight = useInfraTraceHighlight()

/** Node nằm trên đường đi, hoặc `null` khi không có đường nào đang tô. */
const tracePath = computed(() => traceHighlight.matchOf(nodes.value))
const traceFailed = computed(() => traceHighlight.failedOf(nodes.value))
const tracePathCount = computed(() => tracePath.value?.size ?? 0)

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

<style>
/* style-ok: DOM nội bộ của VueFlow (handle · chồng zoom · minimap) — class không chạm
   tới được, nên hoà nó vào bảng màu AWOG bằng selector toàn cục dưới `.ig-canvas`. */
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
/* Chồng zoom: KÉO LÊN GÓC TRÊN-PHẢI bằng CSS, vì góc dưới-phải của khung nhìn thuộc
   về bong bóng phiên (`InfraBubble` — `position: fixed; right: 16px`, z-index 96) và
   chồng dock thu nhỏ ngay dưới nó, nên ba nút zoom nằm đúng dưới viên chat (ảnh người
   dùng 2026-09-16). Đẩy sang trái không cứu được: mở bong bóng ra là một khung 360×520
   ở đúng góc đó, nên mọi con số `right` đều sai ở một trong hai trạng thái. Trên-phải
   trống ở CẢ HAI, và vẫn trống khi cột chi tiết node mở ra (cột đó là anh em flex của
   canvas — nó làm canvas hẹp lại chứ không phủ lên).

   BA CLASS trong selector chứ không phải hai: `.vue-flow__panel.bottom` của thư viện
   là 0-2-0, ngang với `.ig-canvas .vue-flow__controls`, và hoà thì thứ tự nạp quyết
   định — một thứ không nên phụ thuộc. Thêm `.vue-flow__panel` cho ra 0-3-0 là thắng
   dứt điểm, không cần `!important`. */
.ig-canvas .vue-flow__panel.vue-flow__controls {
  top: 0;
  bottom: auto;
}

/* Cụm nút TỰ KHAI TỪ ĐẦU. Bản của thư viện để nút `content-box` 16×16 + đệm 5px và
   một `border-bottom` xám nhạt ghim cứng — màu đó không theo theme, và với
   hàng NGANG thì nó vẽ gạch chân dưới từng nút chứ không ngăn được gì. Nền đặt ở
   CỤM, nút để trong suốt: nút có nền riêng thì mỗi nút thành một viên nổi bên trong
   một cái khung, đúng thứ trông lộn xộn ở ảnh người dùng. */
.ig-canvas .vue-flow__controls {
  display: flex;
  padding: 0;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.ig-canvas .vue-flow__controls button {
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
}

.ig-canvas .vue-flow__controls button:last-child {
  border-right: none;
}
.ig-canvas .vue-flow__controls button:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ig-canvas .vue-flow__controls button svg {
  width: var(--icon-xs);
  height: var(--icon-xs);
  max-width: none;
  max-height: none;
  fill: currentColor;
}
.ig-canvas .vue-flow__minimap {
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--bgPanel);
}
</style>
