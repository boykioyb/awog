<template>
  <!-- Phân bố trạng thái pod.

       VÌ SAO DONUT CHỨ KHÔNG PHẢI THANH NGANG (đổi 2026-09-17). Thanh ngang xếp
       chồng trả lời được "cái nào nhiều hơn cái nào", nhưng nó ăn trọn bề ngang
       card cho một thông tin mà 90% thời gian chỉ có MỘT giá trị (`Running 13`).
       Donut giữ con số tổng ở giữa — thứ người đọc nhìn trước — và mỗi trạng thái
       là một cung đọc được tỉ lệ ngay, trong một ô vuông 120px.

       Một trạng thái duy nhất vẫn vẽ nguyên vòng: vòng tròn liền ĐÚNG NGHĨA "tất
       cả pod cùng một trạng thái", không phải một lỗi vẽ. -->
  <div class="ikrd">
    <svg class="ikrd-svg" :viewBox="`0 0 ${BOX} ${BOX}`" role="img" :aria-label="label">
      <circle class="ikrd-track" :cx="C" :cy="C" :r="R" />
      <circle
        v-for="arc in arcs"
        :key="arc.status"
        class="ikrd-arc"
        :class="`seg-${arc.rate}`"
        :cx="C"
        :cy="C"
        :r="R"
        :stroke-dasharray="`${arc.len} ${CIRC - arc.len}`"
        :stroke-dashoffset="-arc.start"
      />
      <text class="ikrd-n" :x="C" :y="C" text-anchor="middle" dominant-baseline="central">
        {{ total }}
      </text>
    </svg>
    <ul class="ikrd-legend">
      <li v-for="arc in arcs" :key="arc.status" class="ikrd-leg">
        <span class="ikrd-dot" :class="`seg-${arc.rate}`" />
        <span class="ikrd-name" :title="arc.status">{{ arc.status }}</span>
        <b class="ikrd-v">{{ arc.n }}</b>
        <span class="ikrd-pct">{{ arc.pct }}%</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { statusRate } from '~/composables/useInfraKubeReport'
import type { KubeStatusCount } from '~/composables/useInfraKubeReport'

const props = defineProps<{ statuses: KubeStatusCount[]; label: string }>()

/** Hình học của vòng: hộp 120, bán kính 44, nét 16 ⇒ lỗ giữa đủ rộng cho số tổng. */
const BOX = 120
const C = BOX / 2
const R = 44
const CIRC = 2 * Math.PI * R

const total = computed(() => props.statuses.reduce((acc, s) => acc + s.n, 0))

/** Cung của từng trạng thái, cộng dồn theo thứ tự đã xếp (nhiều nhất trước). */
const arcs = computed(() => {
  const sum = total.value
  if (sum <= 0) return []
  let start = 0
  return props.statuses.map((s) => {
    const len = (s.n / sum) * CIRC
    const arc = {
      status: s.status,
      n: s.n,
      pct: Math.round((s.n / sum) * 100),
      rate: statusRate(s.status),
      len,
      start,
    }
    start += len
    return arc
  })
})
</script>

<style scoped>
.ikrd {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.ikrd-svg {
  flex: 0 0 auto;
  width: 120px;
  height: 120px;
  /* Cung bắt đầu ở 12 giờ, không phải 3 giờ — người đọc quen đọc vòng từ đỉnh. */
  transform: rotate(-90deg);
}
.ikrd-track {
  fill: none;
  stroke: var(--bgActive);
  stroke-width: 16;
}
.ikrd-arc {
  fill: none;
  stroke-width: 16;
}
.ikrd-arc.seg-ok {
  stroke: var(--green);
}
.ikrd-arc.seg-warn {
  stroke: var(--amber);
}
.ikrd-arc.seg-bad {
  stroke: var(--danger);
}
.ikrd-arc.seg-unknown {
  stroke: var(--textFaint);
}
/* Chữ nằm trong SVG đã xoay −90° ⇒ phải xoay ngược lại, nếu không số tổng nằm dọc. */
.ikrd-n {
  transform: rotate(90deg);
  transform-origin: center;
  fill: var(--text);
  font-size: 22px; /* design-token-ok: cỡ chữ TRONG viewBox 120, scale theo SVG chứ không theo Appearance */
  font-weight: 600;
}
.ikrd-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ikrd-leg {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrd-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
}
.ikrd-dot.seg-ok {
  background: var(--green);
}
.ikrd-dot.seg-warn {
  background: var(--amber);
}
.ikrd-dot.seg-bad {
  background: var(--danger);
}
.ikrd-dot.seg-unknown {
  background: var(--textFaint);
}
.ikrd-name {
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikrd-v {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.ikrd-pct {
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
}
</style>
