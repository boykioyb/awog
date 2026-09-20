<template>
  <div class="tile monsys">
    <div class="monsysgrid">
      <!-- CPU: từng lõi. Trung bình của các lõi là % bận THẬT của máy (tính cả
           thời gian nhân), khác với tổng CPU của các tiến trình ở hàng thẻ trên. -->
      <div class="monsyscol">
        <div class="monsyshd">
          <span class="monsyst">{{ t('monitor.system.cpu') }}</span>
          <span class="monsysval tnum" :style="{ color: levelColor(cpuLvl) }">
            {{ sys.cpuPercent === null ? '—' : `${Math.round(sys.cpuPercent)}%` }}
          </span>
        </div>
        <div v-if="sys.cores.length > 0" class="moncores">
          <div
            v-for="(c, i) in sys.cores"
            :key="i"
            class="moncore"
            :title="`C${i}: ${Math.round(c)}%`"
          >
            <div class="moncorebar">
              <i :style="{ height: `${c}%`, background: levelColor(cpuLevel(c)) }" />
            </div>
            <span class="moncorelbl tnum">{{ Math.round(c) }}</span>
          </div>
        </div>
        <div class="monsyssub">
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
      <div class="monsyscol">
        <div class="monsyshd">
          <span class="monsyst">{{ t('monitor.system.mem') }}</span>
          <span class="monsysval tnum" :style="{ color: levelColor(memLvl) }">
            {{ formatMem(sys.memUsedKb) }} / {{ formatMem(sys.memTotalKb) }}
          </span>
        </div>
        <!-- Hai đoạn: phần bị chiếm thật, rồi file cache (nhạt). Gộp cache vào
             "đã dùng" là cách bản đầu ra 99% trên mọi máy — đúng về chữ nghĩa
             nhưng vô dụng, vì macOS luôn lấp đầy RAM bằng cache. -->
        <div class="monmeter monmeter2">
          <i :style="{ width: `${memPct}%`, background: levelColor(memLvl) }" />
          <i
            class="monmetercache"
            :style="{ width: `${cachePct}%`, background: levelColor(memLvl) }"
          />
        </div>
        <div class="monsyssub">{{ memSub }}</div>

        <template v-if="sys.swapUsedKb > 0">
          <div class="monsyshd monsysswaphd">
            <span class="monsyst">{{ t('monitor.system.swap') }}</span>
            <!-- CHỈ số tuyệt đối. `swapTotal` là kích thước swapfile HIỆN TẠI mà
                 macOS tự nới khi cần, không phải trần — hiện "11.4/12.0 GB" là
                 bịa ra một cái trần rồi báo động vì sắp chạm nó. -->
            <span class="monsysval tnum" :style="{ color: levelColor(swapLvl) }">
              {{ formatMem(sys.swapUsedKb) }}
            </span>
          </div>
          <div class="monmeter">
            <i :style="{ width: `${swapVsRam}%`, background: levelColor(swapLvl) }" />
          </div>
          <div class="monsyssub">{{ t('monitor.system.swapHint') }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  cpuLevel,
  formatMem,
  levelColor,
  type SystemStats,
  type UsageLevel,
} from '~/composables/useMonitorManager'

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

<style scoped>
.monsys {
  padding: 12px 14px;
}
.monsysgrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
}
.monsyscol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.monsyshd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.monsysswaphd {
  margin-top: 8px;
}
.monsyst {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.monsysval {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
}
.monsyssub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* Một cột dọc cho mỗi lõi — đọc được "lõi nào đang gánh" trong một cái liếc,
   và không phụ thuộc số lõi (8, 10, 16 đều vừa). */
.moncores {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.moncore {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.moncorebar {
  width: 100%;
  height: 34px; /* design-token-ok: chiều cao cột chính là hình dạng */
  border-radius: var(--r-xs);
  background: var(--bgActive);
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
.moncorebar > i {
  display: block;
  width: 100%;
  border-radius: var(--r-xs);
  transition: height 0.25s ease;
}
.moncorelbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.monmeter {
  height: 6px; /* design-token-ok: độ dày vạch chính là hình dạng */
  border-radius: var(--r-pill);
  background: var(--bgActive);
  overflow: hidden;
}
.monmeter > i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  transition: width 0.25s ease;
}
/* Hai đoạn nằm cạnh nhau trên cùng một vạch. */
.monmeter2 {
  display: flex;
}
/* Cache mờ đi: nó CÓ chiếm chỗ nhưng nhường lại ngay khi cần, nên không được
   trông ngang hàng với phần bị chiếm thật. */
.monmetercache {
  opacity: 0.28;
}
</style>
