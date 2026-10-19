<template>
  <!-- Wrapper chỉ để làm CONTAINER cho container-query: số cột phải theo bề rộng
       của PANEL, không theo bề rộng cửa sổ (nav rail và drawer làm hai cái lệch
       nhau vài trăm px). -->
  <div class="@container">
    <!-- 2 hoặc 4 cột, KHÔNG BAO GIỜ 3: bốn thẻ chia làm 3 cột thì thẻ thứ tư đứng lẻ
         một mình một hàng. Ngưỡng 760px = mỗi thẻ còn ≥ 180px, đủ cho dòng chú
         thích không bị cắt. Vạch mức 4px (h-1) là HÌNH DẠNG, không phải cỡ chữ. -->
    <div class="grid grid-cols-2 gap-2.5 @min-[760px]:grid-cols-4">
      <Card class="flex min-w-0 flex-col gap-1 px-3.5 py-3">
        <div class="text-xs text-faint">{{ t('monitor.cards.cpu', { scope: scopeLabel }) }}</div>
        <div class="text-2xl tabular-nums" :class="levelText(cpuLvl)">
          {{ warmingUp ? '…' : formatCpuLoad(totals.cpuPercent) }}
        </div>
        <!-- Vạch mức = phần công suất đã dùng trên TỔNG của máy. Con số "134%" một
             mình không nói được nó là nhiều hay ít; cùng con số đó trên máy 2 lõi
             và máy 10 lõi là hai câu chuyện khác nhau. -->
        <div class="h-1 overflow-hidden rounded-full bg-muted" :aria-hidden="true">
          <i
            class="block h-full rounded-full transition-[width] duration-250"
            :class="levelBg(cpuLvl)"
            :style="{ width: `${cpuFill(totals.cpuPercent, coreCount) * 100}%` }"
          />
        </div>
        <div class="truncate text-xs text-dim">
          {{ t('monitor.cards.cpuHint', { cores: coreCount }) }}
        </div>
      </Card>

      <Card class="flex min-w-0 flex-col gap-1 px-3.5 py-3">
        <div class="text-xs text-faint">{{ t('monitor.cards.mem', { scope: scopeLabel }) }}</div>
        <div class="text-2xl tabular-nums" :class="levelText(memLvl)">
          {{ formatMem(totals.rssKb) }}
        </div>
        <div
          v-if="totalMemKb > 0"
          class="h-1 overflow-hidden rounded-full bg-muted"
          :aria-hidden="true"
        >
          <i
            class="block h-full rounded-full transition-[width] duration-250"
            :class="levelBg(memLvl)"
            :style="{ width: `${memFill(totals.rssKb, totalMemKb) * 100}%` }"
          />
        </div>
        <div class="truncate text-xs text-dim">{{ memSub }}</div>
      </Card>

      <Card class="flex min-w-0 flex-col gap-1 px-3.5 py-3">
        <div class="text-xs text-faint">{{ gpuLabel }}</div>
        <!-- Ưu tiên GPU của ĐÚNG tập đang xem (cộng từ `accumulatedGPUTime` của
             từng tiến trình). `Device Utilization %` của cả máy tụt xuống dòng chú
             thích: nó trả lời câu hỏi khác. -->
        <div class="text-2xl tabular-nums" :class="levelText(gpuLvl)">
          {{ gpuValue }}
        </div>
        <div
          v-if="gpuPercent !== null"
          class="h-1 overflow-hidden rounded-full bg-muted"
          :aria-hidden="true"
        >
          <i
            class="block h-full rounded-full transition-[width] duration-250"
            :class="levelBg(gpuLvl)"
            :style="{ width: `${Math.min(100, gpuPercent)}%` }"
          />
        </div>
        <!-- Nói thẳng đây là số của CẢ MÁY: GPU tách theo tiến trình cần quyền root,
           gán con số này cho AWOG là để người dùng đọc sai. -->
        <div class="truncate text-xs text-dim">{{ gpuHint }}</div>
      </Card>

      <Card class="flex min-w-0 flex-col gap-1 px-3.5 py-3">
        <div class="text-xs text-faint">{{ t('monitor.cards.top') }}</div>
        <!-- Tên tiến trình là chữ, không phải số — cỡ nhỏ hơn để không tràn thẻ, nhưng
             giữ chiều cao dòng của số lớn để bốn thẻ thẳng hàng. -->
        <div class="truncate text-lg leading-(--lh-2xl)" :class="levelText(topLvl)">
          {{ top ? top.label : '—' }}
        </div>
        <div v-if="top" class="h-1 overflow-hidden rounded-full bg-muted" :aria-hidden="true">
          <i
            class="block h-full rounded-full transition-[width] duration-250"
            :class="levelBg(topLvl)"
            :style="{ width: `${Math.min(100, top.cpuPercent ?? 0)}%` }"
          />
        </div>
        <div class="truncate text-xs text-dim">
          {{
            top
              ? t('monitor.cards.topHint', { cpu: formatCpuLoad(top.cpuPercent), pid: top.pid })
              : t('monitor.cards.topNone')
          }}
        </div>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  cpuFill,
  cpuLevel,
  formatCpuLoad,
  formatMem,
  gpuLevel,
  memFill,
  totalCpuLevel,
  totalMemLevel,
  type MonitorProcess,
  type MonitorScope,
} from '~/composables/useMonitorManager'
import { levelBg, levelText } from './monitor-level'

const props = defineProps<{
  totals: {
    cpuPercent: number | null
    /** GPU của ĐÚNG tập đang xem. `null` = nền tảng không đo GPU theo tiến trình. */
    gpuPercent: number | null
    rssKb: number
    processCount: number
  }
  /** Phạm vi đang đo — quyết định NHÃN. Con số của cả máy mà nhãn ghi "của AWOG"
      là đúng loại nói dối mà trang này tồn tại để tránh. */
  scope: MonitorScope
  /** Tên host khi đang xem một máy từ xa. */
  hostLabel?: string
  gpu: { utilizationPercent: number | null; memoryUsedMb: number | null; source: string | null }
  coreCount: number
  /** RAM vật lý của máy đang đo, KiB. 0 = không đọc được ⇒ không vẽ vạch mức. */
  totalMemKb: number
  warmingUp: boolean
  top: MonitorProcess | null
}>()

const { t } = useI18n()

// Ở phạm vi SSH, "—" nói về GPU của MÁY TỪ XA, không phải máy này (máy này lúc
// đó vẫn đang chạy GPU bình thường) — nên nhãn phải mang tên host.
const gpuLabel = computed(() => {
  if (props.scope === 'ssh') {
    return t('monitor.cards.gpuRemoteLabel', { host: props.hostLabel || t('monitor.scope.ssh') })
  }
  // Đo được theo tiến trình ⇒ nhãn đi theo phạm vi như CPU/RAM; không thì vẫn là
  // con số của cả máy và nhãn phải nói đúng thế.
  return props.totals.gpuPercent !== null
    ? t('monitor.cards.gpuScoped', { scope: scopeLabel.value })
    : t('monitor.cards.gpu')
})

// Máy từ xa: lý do KHÔNG đo được khác hẳn máy này. Nói "nền tảng này không cho
// đọc" khi đang xem một máy Linux ở đầu kia SSH là nói sai chỗ.
const gpuHint = computed(() => {
  if (props.scope === 'ssh') return t('monitor.cards.gpuRemote')
  if (!props.gpu.source) return t('monitor.cards.gpuUnavailable')
  const mem = props.gpu.memoryUsedMb === null ? '—' : `${props.gpu.memoryUsedMb} MB`
  // Đo được theo tiến trình ⇒ con số lớn là của TẬP ĐANG XEM, nên phải nói riêng
  // mức của cả máy, kẻo người dùng đọc nhầm hai thứ làm một.
  if (props.totals.gpuPercent !== null && props.gpu.utilizationPercent !== null) {
    return t('monitor.cards.gpuHintScoped', { device: props.gpu.utilizationPercent, mem })
  }
  return t('monitor.cards.gpuHint', { mem })
})

const cpuLvl = computed(() => totalCpuLevel(props.totals.cpuPercent, props.coreCount))
const memLvl = computed(() => totalMemLevel(props.totals.rssKb, props.totalMemKb))
// Số của tập đang xem nếu đo được theo tiến trình; nếu không thì rơi về số cả máy.
const gpuPercent = computed(() => props.totals.gpuPercent ?? props.gpu.utilizationPercent)
const gpuValue = computed(() =>
  gpuPercent.value === null
    ? '—'
    : `${gpuPercent.value < 10 ? gpuPercent.value.toFixed(1) : Math.round(gpuPercent.value)}%`,
)
const gpuLvl = computed(() => gpuLevel(gpuPercent.value))
const topLvl = computed(() => cpuLevel(props.top?.cpuPercent ?? null))

// Có biết RAM máy thì nói phần trăm — "4.1 GB" một mình không cho biết nhiều hay ít.
const memSub = computed(() => {
  const count = t('monitor.cards.memHint', { count: props.totals.processCount })
  if (props.totalMemKb <= 0) return count
  const pct = Math.round((props.totals.rssKb / props.totalMemKb) * 100)
  return `${count} · ${t('monitor.cards.memOfTotal', { pct, total: formatMem(props.totalMemKb) })}`
})

const scopeLabel = computed(() => {
  if (props.scope === 'machine') return t('monitor.scope.machine')
  if (props.scope === 'ssh') return props.hostLabel || t('monitor.scope.ssh')
  return 'AWOG'
})
</script>
