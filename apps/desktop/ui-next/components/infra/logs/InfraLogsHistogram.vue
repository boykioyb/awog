<template>
  <div class="lhg">
    <div class="lhg-head">
      <span class="lhg-title">{{ t('infra.logs.hist.title') }}</span>
      <span class="lhg-hint">
        {{ fromRows ? t('infra.logs.hist.fromRows') : t('infra.logs.hist.fromQuery') }}
      </span>
    </div>

    <div v-if="buckets.length === 0" class="lhg-empty">{{ t('infra.logs.hist.empty') }}</div>

    <svg
      v-else
      ref="svgRef"
      class="lhg-svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="t('infra.logs.hist.title')"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onUp"
    >
      <!-- Lưới ngang: 4 mức, đủ để đọc độ cao mà không biến thành biểu đồ. -->
      <line
        v-for="g in 4"
        :key="g"
        class="lhg-grid"
        :x1="0"
        :x2="W"
        :y1="(H * g) / 5"
        :y2="(H * g) / 5"
      />
      <rect
        v-for="(b, i) in bars"
        :key="i"
        class="lhg-bar"
        :x="b.x"
        :y="b.y"
        :width="b.w"
        :height="b.h"
      />
      <rect v-if="sel" class="lhg-sel" :x="sel.x" :y="0" :width="sel.w" :height="H" />
    </svg>

    <div v-if="buckets.length > 0" class="lhg-axis">
      <span>{{ fmt(buckets[0]?.t ?? 0) }}</span>
      <span v-if="sel">{{ selLabel }}</span>
      <span>{{ fmt(buckets[buckets.length - 1]?.t ?? 0) }}</span>
    </div>

    <div v-if="sel" class="lhg-actions">
      <button class="btn sm" type="button" @click="applyZoom">
        <Icon name="search" class="lhg-ic" />
        {{ t('infra.logs.hist.zoom') }}
      </button>
      <button class="btn sm" type="button" @click="sel = null">
        {{ t('infra.logs.hist.clear') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Histogram SVG kéo-zoom (Mốc 2 việc 2.5).
//
// VÌ SAO SVG TỰ VẼ thay vì một thư viện chart: biểu đồ ở đây có ĐÚNG một việc —
// cho thấy mật độ log theo thời gian và cho kéo chọn một khoảng để thu hẹp cửa sổ.
// Một thư viện chart kéo theo theme, tooltip, legend và một hệ toạ độ nữa để lệch
// với token của app, đổi lấy thứ không ai dùng ở đây.
//
// `preserveAspectRatio="none"`: chiều rộng co giãn theo khung, chiều cao cố định.
// Nhờ vậy toạ độ chuột ⇒ chỉ số bucket là một phép chia theo bề rộng thật, không
// cần biết viewBox đang bị scale bao nhiêu — chỉ cần đúng tỉ lệ X.
//
// Kéo chọn KHÔNG tự chạy lại truy vấn: nó chỉ đặt lại cửa sổ thời gian và để
// người dùng nhìn con số ước lượng mới trước khi bấm Chạy (2.6).
import { useTemplateRef } from 'vue'

const props = defineProps<{
  buckets: { n: number; t: number }[]
  fromRows?: boolean
}>()

const emit = defineEmits<{ zoom: [startMs: number, endMs: number] }>()

const { t } = useI18n()
const W = 1000
const H = 120

const svgRef = useTemplateRef<SVGSVGElement>('svgRef')
const dragStart = ref<number | null>(null)
const dragEnd = ref<number | null>(null)

const max = computed(() => Math.max(1, ...props.buckets.map((b) => b.n)))

const bars = computed(() => {
  const n = props.buckets.length
  if (n === 0) return []
  const slot = W / n
  const bw = Math.max(1, slot * 0.86)
  return props.buckets.map((b, i) => {
    const h = Math.max(1, (b.n / max.value) * (H - 8))
    return { x: i * slot + (slot - bw) / 2, y: H - h, w: bw, h }
  })
})

/** Vùng đang kéo, quy về toạ độ viewBox. */
const sel = computed<{ x: number; w: number } | null>(() => {
  if (dragStart.value === null || dragEnd.value === null) return null
  const x = Math.min(dragStart.value, dragEnd.value)
  const w = Math.abs(dragEnd.value - dragStart.value)
  return w < 4 ? null : { x, w }
})

const selLabel = computed(() => {
  const range = timeRange()
  if (!range) return ''
  return `${fmt(range[0])} → ${fmt(range[1])}`
})

/** Vị trí con trỏ ⇒ toạ độ X trong hệ viewBox. Dùng bề rộng THẬT của phần tử. */
function toViewX(e: PointerEvent): number {
  const el = svgRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  if (rect.width === 0) return 0
  return ((e.clientX - rect.left) / rect.width) * W
}

function onDown(e: PointerEvent): void {
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  dragStart.value = toViewX(e)
  dragEnd.value = dragStart.value
}

function onMove(e: PointerEvent): void {
  if (dragStart.value === null) return
  dragEnd.value = toViewX(e)
}

function onUp(): void {
  // Giữ vùng chọn lại cho người dùng bấm "Thu hẹp"; chỉ bỏ trạng thái kéo.
  if (sel.value === null) {
    dragStart.value = null
    dragEnd.value = null
  }
}

/**
 * Vùng chọn ⇒ khoảng thời gian. Mỗi bucket đại diện cho khoảng giữa bucket trước
 * và bucket sau (Insights trả mốc ĐẦU của mỗi bin), nên biên phải của vùng chọn
 * phải cộng thêm một nửa bước — nếu không, dòng cuối cùng của vùng bị rơi ra ngoài
 * và người dùng tưởng AWOG nuốt mất dữ liệu.
 */
function timeRange(): [number, number] | null {
  const s = sel.value
  if (!s || props.buckets.length === 0) return null
  const n = props.buckets.length
  const step = (props.buckets[1]?.t ?? props.buckets[0]!.t + 60_000) - props.buckets[0]!.t
  const first = Math.max(0, Math.min(n - 1, Math.floor((s.x / W) * n)))
  const last = Math.max(0, Math.min(n - 1, Math.ceil(((s.x + s.w) / W) * n) - 1))
  const start = props.buckets[first]!.t
  const end = props.buckets[last]!.t + Math.max(step, 60_000)
  return end > start ? [start, end] : null
}

function applyZoom(): void {
  const range = timeRange()
  if (!range) return
  emit('zoom', range[0], range[1])
  dragStart.value = null
  dragEnd.value = null
}

function fmt(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<style scoped>
.lhg {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lhg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.lhg-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.lhg-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lhg-empty {
  padding: 18px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}

.lhg-svg {
  display: block;
  width: 100%;
  height: 120px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
  cursor: crosshair;
  touch-action: none;
}

.lhg-grid {
  stroke: var(--border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.lhg-bar {
  fill: var(--accent);
  opacity: 0.72;
}

.lhg-bar:hover {
  opacity: 1;
}

.lhg-sel {
  fill: var(--accent);
  opacity: 0.18;
}

.lhg-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.lhg-actions {
  display: flex;
  gap: 4px;
}

.lhg-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
</style>
