<template>
  <Card class="gap-0 px-3.5 py-3">
    <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4.5">
      <!-- CPU: từng lõi. Trung bình của các lõi là % bận THẬT của máy (tính cả
           thời gian nhân), khác với tổng CPU của các tiến trình ở hàng thẻ trên. -->
      <div class="flex min-w-0 flex-col gap-1.5">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-faint">{{ t('monitor.system.cpu') }}</span>
          <span class="text-lg tabular-nums" :class="levelText(cpuLvl)">
            {{ sys.cpuPercent === null ? '—' : `${Math.round(sys.cpuPercent)}%` }}
          </span>
        </div>
        <!-- Một cột dọc cho mỗi lõi — đọc được "lõi nào đang gánh" trong một cái liếc,
             và không phụ thuộc số lõi (8, 10, 16 đều vừa). -->
        <div v-if="sys.cores.length > 0" class="flex items-end gap-1">
          <div
            v-for="(c, i) in sys.cores"
            :key="i"
            class="flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5"
            :title="`C${i}: ${Math.round(c)}%`"
          >
            <!-- Chiều cao cột (34px) chính là hình dạng của biểu đồ. -->
            <div class="flex h-8.5 w-full items-end overflow-hidden rounded-sm bg-muted">
              <i
                class="block w-full rounded-sm transition-[height] duration-250"
                :class="levelBg(cpuLevel(c))"
                :style="{ height: `${c}%` }"
              />
            </div>
            <span class="text-xs tabular-nums text-faint">{{ Math.round(c) }}</span>
          </div>
        </div>
        <div class="text-xs text-faint">
          {{
            t('monitor.system.load', {
              a: fmt(sys.loadAvg[0]),
              b: fmt(sys.loadAvg[1]),
              c: fmt(sys.loadAvg[2]),
            })
          }}
        </div>
      </div>

      <!-- RAM + swap: "đang dùng / tổng", vì một con số tuyệt đối không cho biết
           còn bao nhiêu. Swap đã dùng nhiều = máy đang thiếu RAM thật. -->
      <div class="flex min-w-0 flex-col gap-1.5">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-xs text-faint">{{ t('monitor.system.mem') }}</span>
          <span class="text-lg tabular-nums" :class="levelText(memLvl)">
            {{ formatMem(sys.memUsedKb) }} / {{ formatMem(sys.memTotalKb) }}
          </span>
        </div>
        <!-- Hai đoạn: phần bị chiếm thật, rồi file cache (nhạt). Gộp cache vào
             "đã dùng" là cách bản đầu ra 99% trên mọi máy — đúng về chữ nghĩa
             nhưng vô dụng, vì macOS luôn lấp đầy RAM bằng cache. Cache mờ đi: nó CÓ
             chiếm chỗ nhưng nhường lại ngay khi cần. -->
        <div class="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <i
            class="block h-full rounded-full transition-[width] duration-250"
            :class="levelBg(memLvl)"
            :style="{ width: `${memPct}%` }"
          />
          <i
            class="block h-full rounded-full opacity-28 transition-[width] duration-250"
            :class="levelBg(memLvl)"
            :style="{ width: `${cachePct}%` }"
          />
        </div>
        <div class="text-xs text-faint">{{ memSub }}</div>

        <template v-if="sys.swapUsedKb > 0">
          <div class="mt-2 flex items-baseline justify-between gap-2">
            <span class="text-xs text-faint">{{ t('monitor.system.swap') }}</span>
            <!-- CHỈ số tuyệt đối. `swapTotal` là kích thước swapfile HIỆN TẠI mà
                 macOS tự nới khi cần, không phải trần — hiện "11.4/12.0 GB" là
                 bịa ra một cái trần rồi báo động vì sắp chạm nó. -->
            <span class="text-lg tabular-nums" :class="levelText(swapLvl)">
              {{ formatMem(sys.swapUsedKb) }}
            </span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-muted">
            <i
              class="block h-full rounded-full transition-[width] duration-250"
              :class="levelBg(swapLvl)"
              :style="{ width: `${swapVsRam}%` }"
            />
          </div>
          <div class="text-xs text-faint">{{ t('monitor.system.swapHint') }}</div>
        </template>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  cpuLevel,
  formatMem,
  type SystemStats,
  type UsageLevel,
} from '~/composables/useMonitorManager'
import { levelBg, levelText } from './monitor-level'

const props = defineProps<{ sys: SystemStats }>()

const { t } = useI18n()

const fmt = (n: number): string => n.toFixed(2)

const pct = (part: number): number =>
  props.sys.memTotalKb > 0 ? Math.min(100, (part / props.sys.memTotalKb) * 100) : 0

const memPct = computed(() => pct(props.sys.memUsedKb))
const cachePct = computed(() => pct(props.sys.memCachedKb))
/** Swap đo theo RAM VẬT LÝ, không theo kích thước swapfile (xem chú thích ở template). */
const swapVsRam = computed(() => pct(props.sys.swapUsedKb))

const cpuLvl = computed(() => cpuLevel(props.sys.cpuPercent))

/**
 * Màu RAM theo ÁP LỰC BỘ NHỚ do nhân báo, không theo phần trăm.
 *
 * Phần trăm là chỉ báo tồi trên macOS: hệ điều hành cố tình giữ RAM đầy, nên
 * một ngưỡng phần trăm sẽ đỏ gần như vĩnh viễn. `memorystatus_vm_pressure_level`
 * là phán quyết của chính nhân — thứ nó dùng để quyết định nén và swap. Nền tảng
 * không cung cấp thì mới rơi về phần trăm.
 */
const memLvl = computed<UsageLevel>(() => {
  if (props.sys.pressure === 'critical') return 'high'
  if (props.sys.pressure === 'warn') return 'warn'
  if (props.sys.pressure === 'normal') return 'ok'
  return memPct.value >= 92 ? 'high' : memPct.value >= 75 ? 'warn' : 'ok'
})

// Swap so với RAM VẬT LÝ: swap bằng nửa RAM là máy đã thiếu bộ nhớ trầm trọng.
const swapLvl = computed<UsageLevel>(() =>
  swapVsRam.value >= 50 ? 'high' : swapVsRam.value >= 20 ? 'warn' : 'ok',
)

const memSub = computed(() => {
  const base = t('monitor.system.memPct', { pct: Math.round(memPct.value) })
  if (props.sys.memCachedKb <= 0) return base
  return `${base} · ${t('monitor.system.memCached', { size: formatMem(props.sys.memCachedKb) })}`
})
</script>
