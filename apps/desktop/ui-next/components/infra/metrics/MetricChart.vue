<template>
  <!-- MỘT BIỂU ĐỒ = MỘT CARD. Trước 2026-09-17 tiêu đề và chú giải trôi thẳng trên
       nền trang còn riêng vùng vẽ có khung, nên mỗi ô đọc ra thành HAI thứ rời:
       một dòng chữ, rồi một cái hộp (ảnh người dùng). Da card dùng chung `.icard`
       của khu hạ tầng (app-shell.css) — cùng bề mặt với thanh công cụ và các khối
       của màn Chi phí, không tự khai riêng một kiểu nữa. -->
  <div class="mc icard">
    <div class="mc-head">
      <span class="mc-title">{{ title }}</span>
      <span class="mc-head-right">
        <span class="mc-unit">{{ unitLabel }}</span>
        <!-- Một ngưỡng đang sửa được (đã có bản nháp) > cảnh báo đã có > chưa có gì.
             Ba nhánh loại trừ nhau: hiện nút "Đặt ngưỡng" cạnh cảnh báo đã có là mời
             người dùng tạo cảnh báo thứ hai cho ĐÚNG metric đó mà không nói ra.
             Bọc trong `showAlarm` vì bảng điều khiển dùng LẠI đúng biểu đồ này: ở đó
             không có ngưỡng, không có bản nháp, và một nút "Đặt ngưỡng" bấm vào không
             dẫn tới đâu cả. -->
        <template v-if="showAlarm">
          <button
            v-if="threshold && threshold.editable"
            class="mc-chip on"
            type="button"
            :title="t('infra.monitoring.alarm.dragHint')"
          >
            <Icon name="move" class="mc-ic" />
            {{
              t('infra.monitoring.alarm.thresholdValue', {
                v: formatMetricValue(threshold.value, unit),
              })
            }}
          </button>
          <button
            v-else-if="threshold"
            class="mc-chip"
            type="button"
            :title="t('infra.monitoring.alarm.edit')"
            @click="emit('alarm-edit')"
          >
            <Icon name="bell" class="mc-ic" />
            {{ threshold.label }}
          </button>
          <button
            v-else-if="hasData"
            class="mc-chip"
            type="button"
            :title="t('infra.monitoring.alarm.create')"
            @click="emit('alarm-create')"
          >
            <Icon name="plus" class="mc-ic" />
            {{ t('infra.monitoring.alarm.create') }}
          </button>
        </template>
      </span>
    </div>

    <!-- Bảng chú giải: danh tính chuỗi KHÔNG bao giờ chỉ dựa vào màu, và trạng thái
         "thiếu dữ liệu" nói ra ở đây vì không có gì để vẽ trên khung. -->
    <ul class="mc-legend">
      <li v-for="s in series" :key="s.key" class="mc-leg">
        <span class="mc-swatch" :style="{ background: s.color, opacity: s.shade }" />
        <span class="mc-leg-label">{{ s.label }}</span>
        <span v-if="s.missing" class="mc-leg-missing">{{ t('infra.monitoring.missing') }}</span>
      </li>
    </ul>

    <div ref="plotRoot" class="mc-plot">
      <svg
        v-if="hasData && vw >= MIN_W"
        ref="svgRef"
        class="mc-svg"
        :viewBox="`0 0 ${vw} ${H}`"
        role="img"
        :aria-label="title"
        @pointermove="onHover"
        @pointerleave="onLeave"
      >
        <!-- Dải sự cố vẽ TRƯỚC lưới và chuỗi: nó là bối cảnh, không được che số liệu. -->
        <rect
          v-for="b in bands"
          :key="b.key"
          class="mc-band"
          :x="b.x"
          :y="PAD_T"
          :width="b.w"
          :height="PLOT_H"
        />

        <!-- Lưới + nhãn trục -->
        <template v-for="(tick, i) in yTicks" :key="`y${i}`">
          <line class="mc-grid" :x1="PAD_L" :x2="vw - PAD_R" :y1="yOf(tick)" :y2="yOf(tick)" />
          <text
            class="mc-tick"
            :x="PAD_L - 6"
            :y="yOf(tick)"
            text-anchor="end"
            dominant-baseline="middle"
          >
            {{ formatMetricValue(tick, unit) }}
          </text>
        </template>
        <!-- `ms` chứ không `t`: `t` là hàm dịch của i18n ở scope ngoài, đặt trùng tên
             thì trong vòng lặp này không còn gọi được hàm dịch nữa. -->
        <template v-for="(ms, i) in xTicks" :key="`x${i}`">
          <line class="mc-grid" :x1="xOf(ms)" :x2="xOf(ms)" :y1="PAD_T" :y2="PAD_T + PLOT_H" />
          <text class="mc-tick" :x="xOf(ms)" :y="H - 6" text-anchor="middle">
            {{ formatAxisTime(ms, windowSeconds) }}
          </text>
        </template>
        <line class="mc-baseline" :x1="PAD_L" :x2="vw - PAD_R" :y1="yOf(0)" :y2="yOf(0)" />

        <!-- Chuỗi -->
        <template v-for="s in series" :key="s.key">
          <path
            v-if="s.points.length > 1 && kind === 'area'"
            class="mc-area"
            :d="areaPath(s.points)"
            :style="{ fill: s.color, fillOpacity: s.shade * 0.18 }"
          />
          <path
            v-if="s.points.length > 1 && kind !== 'bar'"
            class="mc-line"
            :d="linePath(s.points)"
            :style="{ stroke: s.color, strokeOpacity: s.shade }"
          />
          <template v-if="kind === 'bar'">
            <rect
              v-for="(b, i) in barsFor(s.points)"
              :key="`b${s.key}${i}`"
              class="mc-bar"
              :x="b.x"
              :y="b.y"
              :width="b.w"
              :height="b.h"
              :style="{ fill: s.color }"
            />
          </template>
          <circle
            v-if="s.points.length === 1"
            class="mc-dot"
            :cx="xOf(s.points[0]?.t ?? 0)"
            :cy="yOf(s.points[0]?.v ?? 0)"
            r="3"
            :style="{ fill: s.color }"
          />
          <!-- Nhãn ghi thẳng ở cuối đường: p50/p95/p99 là một hue ba bậc, đọc màu
               không phân biệt được, nên danh tính phải nằm ở chữ.

               `y` lấy từ `endLabels` chứ KHÔNG từ `yOf(giá trị cuối)`: hai chuỗi kết
               thúc ở cùng một mức (CPU trung bình ≈ đỉnh ≈ 0%) sẽ vẽ hai nhãn đè lên
               nhau thành một mớ chữ không đọc được — lỗi thật, ảnh người dùng
               2026-09-17. Xem `spreadLabels`. -->
          <text
            v-if="endLabels[s.key] !== undefined"
            class="mc-end"
            :x="Math.min(vw - PAD_R + 6, xOf(lastOf(s.points).t) + 6)"
            :y="endLabels[s.key]"
            dominant-baseline="middle"
          >
            {{ s.label }}
          </text>
        </template>

        <!-- Ngưỡng cảnh báo -->
        <template v-if="threshold">
          <line
            class="mc-threshold"
            :x1="PAD_L"
            :x2="vw - PAD_R"
            :y1="yOf(threshold.value)"
            :y2="yOf(threshold.value)"
          />
          <rect
            v-if="threshold.editable"
            class="mc-grip"
            :x="PAD_L + 4"
            :y="yOf(threshold.value) - 7"
            width="14"
            height="14"
            rx="4"
            @pointerdown="onGripDown"
            @pointermove="onGripMove"
            @pointerup="onGripUp"
            @pointercancel="onGripUp"
          />
        </template>

        <!-- Lớp hover: đường dóng + điểm. Tooltip là DOM bên dưới, không phải SVG —
             chữ trong SVG không xuống dòng được. -->
        <template v-if="hover">
          <line class="mc-cross" :x1="hover.x" :x2="hover.x" :y1="PAD_T" :y2="PAD_T + PLOT_H" />
          <circle
            v-for="r in hover.rows"
            :key="`h${r.key}`"
            class="mc-dot"
            :cx="hover.x"
            :cy="r.y"
            r="3"
            :style="{ fill: r.color }"
          />
        </template>
      </svg>

      <div v-if="!hasData" class="mc-empty">{{ t('infra.monitoring.missing') }}</div>
      <div v-if="loading" class="mc-loading">{{ t('infra.monitoring.loading') }}</div>

      <div v-if="hover" class="mc-tip" :style="tipStyle">
        <div class="mc-tip-time">{{ formatAxisTime(hover.t, windowSeconds) }}</div>
        <div v-for="r in hover.rows" :key="`t${r.key}`" class="mc-tip-row">
          <span class="mc-swatch" :style="{ background: r.color }" />
          <span class="mc-tip-label">{{ r.label }}</span>
          <span class="mc-tip-value">{{ formatMetricValue(r.v, unit) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Biểu đồ SVG vẽ TAY (Mốc 6, 6.1 · 6.3 · 6.4).
//
// VÌ SAO KHÔNG DÙNG THƯ VIỆN: bốn biểu đồ của màn này cần đúng bốn thứ — trục thời
// gian chung, dải sự cố vẽ xuyên khung, lớp hover, và một tay nắm kéo được để đặt
// ngưỡng. Một thư viện chart mang theo theme, legend, tooltip và một hệ toạ độ
// riêng để lệch với token của app, đổi lấy thứ ở đây không ai dùng. (Hợp đồng mốc
// 6 §0 cũng cấm thêm dependency.)
//
// VÌ SAO viewBox THEO PIXEL THẬT (`0 0 <bề rộng> 160`) chứ không phải `1000×160` +
// `preserveAspectRatio="none"`: kéo giãn phi đều làm CHỮ trên trục bị bóp ngang
// theo. Đo bề rộng thật rồi vẽ trong hệ pixel khiến toạ độ chuột ⇒ toạ độ vẽ là
// phép cộng, không phải một phép chia phải đoán tỉ lệ scale.
//
// LUẬT VẼ (hợp đồng §8) — áp đủ:
//   · Không bao giờ hai trục y. Lượt gọi và tỉ lệ lỗi là HAI khung, chung trục thời gian.
//   · Dữ liệu có thứ tự (p50 < p95 < p99) = một hue chia bậc đậm nhạt (prop `shade`).
//   · Hạng mục rời (CPU vs RAM) = hai hue khác nhau + NHÃN ghi ở cuối đường.
//   · Màu trạng thái (--danger/--amber/--green) không bị mượn làm chuỗi dữ liệu.
//   · Nét 2px, lưới mờ, lớp hover bắt buộc.
import type {
  ChartSeriesView,
  ChartThreshold,
  IncidentBand,
  WirePoint,
} from '~/composables/useInfraMetrics'
import { formatAxisTime, formatMetricValue } from '~/composables/useInfraMetrics'

const props = withDefaults(
  defineProps<{
    title: string
    kind: 'line' | 'area' | 'bar'
    unit: string
    series: ChartSeriesView[]
    window: { startMs: number; endMs: number } | null
    windowSeconds: number
    /** Bước nhóm — cột được đặt giữa CHU KỲ chứ không ở mốc đầu (AWS trả mốc đầu). */
    periodSeconds: number
    incidents: IncidentBand[]
    threshold: ChartThreshold | null
    loading?: boolean
    /**
     * Mặc định TẮT. Cả chuỗi nút cảnh báo là chuyện của màn Giám sát; component này
     * vẫn giữ cờ vì nó là biểu đồ dùng chung, và bề mặt nào chỉ muốn VẼ thì không
     * phải mang theo ba nút bấm vào không dẫn tới đâu.
     */
    showAlarm?: boolean
  }>(),
  { loading: false, showAlarm: false },
)

const emit = defineEmits<{
  'threshold-change': [value: number]
  'alarm-create': []
  'alarm-edit': []
}>()

const { t } = useI18n()

/** Cao cố định (chẵn) — biểu đồ trong lưới 2×2, cao thay đổi theo từng ô là lưới lệch. */
const H = 160
/** Chừa chỗ cho nhãn trục y bên trái và nhãn cuối đường bên phải. */
const PAD_L = 48
const PAD_R = 56
const PAD_T = 12
const PAD_B = 18
/** Dưới ngưỡng này thì trục và nhãn chồng lên nhau — thà trắng còn hơn rối. */
const MIN_W = 220
const PLOT_H = H - PAD_T - PAD_B

const plotRoot = useTemplateRef<HTMLElement>('plotRoot')
const svgRef = useTemplateRef<SVGSVGElement>('svgRef')

const vw = ref(0)
const hoverT = ref<number | null>(null)
const dragging = ref(false)
let ro: ResizeObserver | null = null

onMounted(() => {
  const el = plotRoot.value
  if (!el) return
  vw.value = el.clientWidth
  if (typeof ResizeObserver === 'undefined') return
  // Khung co giãn theo bề rộng cửa sổ và theo cột của lưới 2×2 — đo lại mỗi lần đổi.
  ro = new ResizeObserver(() => {
    vw.value = el.clientWidth
  })
  ro.observe(el)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

const plotW = computed(() => Math.max(0, vw.value - PAD_L - PAD_R))
const hasData = computed(() => props.series.some((s) => s.points.length > 0))

const unitLabel = computed(() => {
  const key = `infra.monitoring.unit.${props.unit.toLowerCase()}`
  const label = t(key)
  return label === key ? props.unit : label
})

// ─── Tỉ lệ ──────────────────────────────────────────────────────────────────

/**
 * Bậc chia "đẹp" (1/2/2,5/5 × 10^k) và trần làm tròn lên theo bậc đó.
 *
 * `minStep` là sàn cho bậc: với dữ liệu đếm được, bậc 0,25 sinh bốn nhãn đều làm
 * tròn thành "0" — trục nói dối rằng mọi mức đều bằng nhau.
 */
function niceTicks(maxValue: number, minStep: number): { max: number; step: number } {
  if (!Number.isFinite(maxValue) || maxValue <= 0)
    return { max: Math.max(minStep, 1), step: Math.max(minStep, 1) / 4 }
  const rough = Math.max(minStep, maxValue / 4)
  const exp = 10 ** Math.floor(Math.log10(rough))
  const frac = rough / exp
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10
  const step = Math.max(minStep, nice * exp)
  return { max: Math.ceil(maxValue / step) * step, step }
}

const yScale = computed(() => {
  let max = 0
  for (const s of props.series) {
    for (const p of s.points) if (p.v > max) max = p.v
  }
  if (props.threshold) max = Math.max(max, props.threshold.value)
  // Phần trăm luôn đọc trên thang 0–100 khi dữ liệu chưa vượt: bốn khung cạnh nhau
  // mà mỗi khung một thang thì "một nửa chiều cao" nghĩa là bốn mức khác nhau.
  if (props.unit === 'Percent' && max <= 100) max = 100
  return niceTicks(max, props.unit === 'Count' ? 1 : 0)
})

const yTicks = computed(() => {
  const { max, step } = yScale.value
  const out: number[] = []
  for (let v = 0; v <= max + step / 2 && out.length < 8; v += step) out.push(v)
  return out
})

const xTicks = computed(() => {
  const w = props.window
  if (!w) return []
  const span = w.endMs - w.startMs
  return [0, 1 / 3, 2 / 3, 1].map((f) => w.startMs + span * f)
})

function xOf(t: number): number {
  const w = props.window
  if (!w || w.endMs <= w.startMs) return PAD_L
  return PAD_L + ((t - w.startMs) / (w.endMs - w.startMs)) * plotW.value
}

function yOf(v: number): number {
  const { max } = yScale.value
  return PAD_T + PLOT_H - (max > 0 ? (v / max) * PLOT_H : 0)
}

/** Khoảng cách tối thiểu giữa hai nhãn cuối đường, tính bằng đơn vị của viewBox.
 *  Bằng một hộp dòng `--fs-xs`: sát hơn thì hai chữ dính vào nhau. */
const LABEL_GAP = 12

/**
 * Đẩy các nhãn cuối đường ra xa nhau khi chúng trùng chỗ.
 *
 * ⚠ VÌ SAO CẦN — LỖI THẬT, ảnh người dùng 2026-09-17. Nhãn được đặt ở đúng `y` của
 * điểm cuối mỗi chuỗi, mà hai chuỗi của cùng một biểu đồ RẤT HAY kết thúc ở cùng
 * một mức: CPU trung bình ≈ đỉnh ≈ 0% trên một service rảnh, "đang chạy" = "mong
 * muốn" = 1 trên một service khoẻ. Khi đó hai nhãn vẽ chồng lên nhau và ra một mớ
 * chữ (`đình`/`trung bình` đè nhau) — đúng những lúc hệ thống BÌNH THƯỜNG, tức là
 * hầu hết thời gian.
 *
 * Thuật toán: sắp theo `y` mong muốn, quét một lượt đẩy xuống cho đủ khoảng cách,
 * rồi nếu tràn đáy thì đẩy ngược cả cụm lên. Giữ THỨ TỰ theo giá trị — nhãn của
 * đường trên vẫn ở trên — vì đảo thứ tự mới là thứ làm người đọc gán nhầm tên.
 *
 * Hàm THUẦN (không đọc `props`, không chạm DOM) nên đo được bằng cách gọi tay —
 * `<script setup>` KHÔNG cho `export`, nên nó ở lại đây thay vì ra `utils/`: đây là
 * hình học của riêng biểu đồ này, không phải thứ màn nào khác dùng lại.
 */
function spreadLabels(
  wanted: readonly { key: string; y: number }[],
  top: number,
  bottom: number,
  gap = LABEL_GAP,
): Record<string, number> {
  const sorted = [...wanted].sort((a, b) => a.y - b.y)
  const out: Record<string, number> = {}
  let prev = -Infinity
  for (const item of sorted) {
    const y = Math.max(item.y, prev + gap)
    out[item.key] = y
    prev = y
  }
  // Tràn đáy ⇒ dời NGUYÊN cụm lên, không nén khoảng cách: nén lại là quay về đúng
  // cái chồng chữ vừa gỡ. Cụm cao hơn khung thì đành tràn — nhưng mỗi nhãn vẫn đọc
  // được, và đó là điều duy nhất quan trọng ở đây.
  const lowest = prev
  if (lowest > bottom) {
    const shift = Math.min(lowest - bottom, out[sorted[0]!.key]! - top)
    if (shift > 0) for (const k of Object.keys(out)) out[k] = out[k]! - shift
  }
  return out
}

/** Vị trí `y` ĐÃ TÁCH của nhãn cuối mỗi chuỗi, tra theo `key` của chuỗi. */
const endLabels = computed<Record<string, number>>(() =>
  spreadLabels(
    props.series
      .filter((s) => s.points.length > 0)
      .map((s) => ({ key: s.key, y: yOf(lastOf(s.points).v) })),
    PAD_T,
    PAD_T + PLOT_H,
  ),
)

// ─── Đường · vùng · cột ─────────────────────────────────────────────────────

function linePath(points: readonly WirePoint[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(2)},${yOf(p.v).toFixed(2)}`)
    .join(' ')
}

function areaPath(points: readonly WirePoint[]): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  const base = yOf(0).toFixed(2)
  const line = points.map((p) => `${xOf(p.t).toFixed(2)},${yOf(p.v).toFixed(2)}`).join(' L')
  return `M${xOf(first.t).toFixed(2)},${base} L${line} L${xOf(last.t).toFixed(2)},${base} Z`
}

/** Trần bề rộng cột: cửa sổ ngắn chỉ có vài điểm, không thì một cột cao bằng nửa khung. */
const MAX_BAR_W = 28

function barsFor(points: readonly WirePoint[]): { x: number; y: number; w: number; h: number }[] {
  const n = points.length
  if (n === 0) return []
  const slot = plotW.value / n
  const bw = Math.max(1, Math.min(slot * 0.7, MAX_BAR_W))
  const base = yOf(0)
  // Dịch nửa chu kỳ: mốc AWS trả là ĐẦU chu kỳ, cột đặt ở đó là cột lệch trái so với
  // khoảng thời gian nó thật sự nói tới.
  const shift = (props.periodSeconds * 1000) / 2
  return points.map((p) => {
    const y = Math.min(yOf(p.v), base)
    return { x: xOf(p.t + shift) - bw / 2, y, w: bw, h: Math.max(1, Math.abs(base - y)) }
  })
}

function lastOf(points: readonly WirePoint[]): WirePoint {
  return points[points.length - 1] ?? { t: 0, v: 0 }
}

/** Dải sự cố, cắt vào trong khung vẽ. Nhãn chỉ hiện khi dải đủ rộng để chứa nó. */
const bands = computed(() => {
  const w = props.window
  if (!w) return []
  const left = PAD_L
  const right = PAD_L + plotW.value
  return props.incidents
    .map((b, i) => {
      const x0 = Math.max(left, Math.min(right, xOf(b.startMs)))
      const x1 = Math.max(left, Math.min(right, xOf(b.endMs)))
      return {
        key: `${b.label}-${String(i)}`,
        x: x0,
        w: Math.max(1, x1 - x0),
        label: b.label.length > 16 ? `${b.label.slice(0, 15)}…` : b.label,
      }
    })
    .filter((b) => b.w > 1)
})

// ─── Lớp hover ──────────────────────────────────────────────────────────────

/** Điểm gần nhất theo thời gian. Chuỗi đã được sidecar sắp theo `t`. */
function nearest(points: readonly WirePoint[], t: number): WirePoint | null {
  let best: WirePoint | null = null
  let bestGap = Infinity
  for (const p of points) {
    const gap = Math.abs(p.t - t)
    if (gap < bestGap) {
      bestGap = gap
      best = p
    }
  }
  return best
}

function viewX(e: PointerEvent): number {
  const el = svgRef.value
  if (!el) return PAD_L
  const rect = el.getBoundingClientRect()
  if (rect.width === 0) return PAD_L
  return ((e.clientX - rect.left) / rect.width) * vw.value
}

function viewY(e: PointerEvent): number {
  const el = svgRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  if (rect.height === 0) return 0
  return ((e.clientY - rect.top) / rect.height) * H
}

function onHover(e: PointerEvent): void {
  if (dragging.value) return
  const w = props.window
  if (!w || plotW.value <= 0) return
  const f = (viewX(e) - PAD_L) / plotW.value
  const t = w.startMs + Math.max(0, Math.min(1, f)) * (w.endMs - w.startMs)
  hoverT.value = t
}

function onLeave(): void {
  if (!dragging.value) hoverT.value = null
}

/**
 * Đường dóng BÁM vào một cột dữ liệu thật (`snapped`) thay vì đứng ở đúng chỗ con
 * trỏ: nếu không thì đường dóng ở một mốc còn điểm tròn ở một mốc khác, và mắt đọc
 * hai thứ đó là hai giá trị.
 */
const hover = computed(() => {
  const t = hoverT.value
  if (t === null) return null
  const anchor = props.series.find((s) => s.points.length > 0)
  if (!anchor) return null
  const snapped = nearest(anchor.points, t)
  if (!snapped) return null
  const rows = props.series
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const p = nearest(s.points, snapped.t)
      return p ? { key: s.key, label: s.label, color: s.color, y: yOf(p.v), v: p.v } : null
    })
    .filter(
      (r): r is { key: string; label: string; color: string; y: number; v: number } => r !== null,
    )
  if (rows.length === 0) return null
  return { x: xOf(snapped.t), t: snapped.t, rows }
})

const tipStyle = computed(() => {
  const x = hover.value?.x ?? 0
  if (x < 110) return { left: `${String(x + 12)}px`, transform: 'none' }
  if (x > vw.value - 110) return { left: `${String(x - 12)}px`, transform: 'translateX(-100%)' }
  return { left: `${String(x)}px`, transform: 'translateX(-50%)' }
})

// ─── Kéo ngưỡng (6.4) ───────────────────────────────────────────────────────

/**
 * Làm tròn theo lượng tử của đơn vị. Số ngưỡng đi thẳng vào argv của
 * `put-metric-alarm`, nên `80.00000000000001` không phải là một ngưỡng ai đó muốn.
 */
function quantise(v: number): number {
  if (props.unit === 'Count') return Math.round(v)
  if (props.unit === 'Seconds') return Math.round(v * 1000) / 1000
  return Math.round(v * 100) / 100
}

function onGripDown(e: PointerEvent): void {
  if (!props.threshold?.editable) return
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  dragging.value = true
  hoverT.value = null
  e.stopPropagation()
}

function onGripMove(e: PointerEvent): void {
  if (!dragging.value) return
  const { max } = yScale.value
  const raw = ((PAD_T + PLOT_H - viewY(e)) / PLOT_H) * max
  emit('threshold-change', quantise(Math.max(0, Math.min(max, raw))))
}

function onGripUp(e: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  ;(e.target as Element).releasePointerCapture?.(e.pointerId)
}
</script>

<style scoped>
.mc {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  /* Da (viền, bo góc, nền, đổ bóng) do `.icard` cấp — ở đây chỉ có lề trong. */
  padding: 10px 12px;
}

.mc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mc-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.mc-head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mc-unit {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.mc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.mc-chip:hover {
  color: var(--text);
  border-color: var(--borderStrong);
}

.mc-chip.on {
  color: var(--amber);
  border-color: var(--amberBorder);
  background: var(--amberDim);
}

.mc-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

.mc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mc-leg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.mc-swatch {
  width: 8px;
  height: 8px;
  border-radius: var(--r-xs);
  flex: 0 0 auto;
}

.mc-leg-missing {
  color: var(--textFaint);
}

/* CARD LỒNG CARD THÌ KHỬ KHUNG CON. Cả khối nay là `.icard`, nên một viền thứ hai
   quanh vùng vẽ chỉ vẽ lại đúng hình dạng đã có, cách vào trong vài pixel — đọc ra
   thành hai hộp lồng nhau. Nền `--bgEl` GIỮ LẠI: nó tách vùng vẽ khỏi phần chữ của
   card, và đó là việc nền làm được mà viền không làm được. */
.mc-plot {
  position: relative;
  border-radius: var(--r-sm);
  background: var(--bgEl);
  overflow: hidden;
}

/* Bề rộng 100% + cao 160px (chẵn): class này CHỈ gắn trên <svg> nên guard coi nó là
   hộp icon (R5) — px lẻ ở đây sẽ bị bắt. */
.mc-svg {
  display: block;
  width: 100%;
  height: 160px;
  cursor: crosshair;
  touch-action: none;
}

.mc-grid {
  stroke: var(--border);
  stroke-width: 1;
}

.mc-baseline {
  stroke: var(--borderStrong);
  stroke-width: 1;
}

.mc-tick {
  fill: var(--textFaint);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}

.mc-band {
  fill: var(--danger);
  opacity: 0.12;
}

.mc-line {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.mc-area {
  stroke: none;
}

.mc-bar {
  stroke: none;
}

.mc-dot {
  stroke: var(--bgEl);
  stroke-width: 1;
}

.mc-end {
  fill: var(--textDim);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}

.mc-threshold {
  stroke: var(--amber);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}

.mc-grip {
  fill: var(--amber);
  cursor: ns-resize;
}

.mc-cross {
  stroke: var(--textDim);
  stroke-width: 1;
  stroke-dasharray: 2 2;
}

.mc-empty,
.mc-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.mc-tip {
  position: absolute;
  top: 6px;
  z-index: 2;
  min-width: 120px;
  padding: 6px 8px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-sm);
  background: var(--bgPanel);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.28);
  pointer-events: none;
}

.mc-tip-time {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.mc-tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.mc-tip-label {
  flex: 1 1 auto;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.mc-tip-value {
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
</style>
