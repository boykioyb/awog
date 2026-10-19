<template>
  <!-- Phân bố trạng thái pod.

       VÌ SAO DONUT CHỨ KHÔNG PHẢI THANH NGANG (đổi 2026-09-17). Thanh ngang xếp
       chồng trả lời được "cái nào nhiều hơn cái nào", nhưng nó ăn trọn bề ngang
       card cho một thông tin mà 90% thời gian chỉ có MỘT giá trị (`Running 13`).
       Donut giữ con số tổng ở giữa — thứ người đọc nhìn trước — và mỗi trạng thái
       là một cung đọc được tỉ lệ ngay, trong một ô vuông 120px.

       Một trạng thái duy nhất vẫn vẽ nguyên vòng: vòng tròn liền ĐÚNG NGHĨA "tất
       cả pod cùng một trạng thái", không phải một lỗi vẽ. -->
  <div class="flex flex-wrap items-center gap-4">
    <!-- Cung bắt đầu ở 12 giờ, không phải 3 giờ — người đọc quen đọc vòng từ đỉnh. -->
    <svg
      class="size-30 shrink-0 -rotate-90"
      :viewBox="`0 0 ${BOX} ${BOX}`"
      role="img"
      :aria-label="label"
    >
      <circle class="fill-none stroke-border" :stroke-width="STROKE" :cx="C" :cy="C" :r="R" />
      <circle
        v-for="arc in arcs"
        :key="arc.status"
        class="fill-none"
        :class="RATE_STROKE[arc.rate]"
        :stroke-width="STROKE"
        :cx="C"
        :cy="C"
        :r="R"
        :stroke-dasharray="`${arc.len} ${CIRC - arc.len}`"
        :stroke-dashoffset="-arc.start"
      />
      <!-- Chữ nằm trong SVG đã xoay −90° ⇒ phải xoay ngược lại, nếu không số tổng
           nằm dọc. Cỡ chữ là thuộc tính SVG trong viewBox 120 — scale theo SVG chứ
           không theo Appearance. -->
      <text
        class="origin-center rotate-90 fill-foreground font-semibold"
        :x="C"
        :y="C"
        font-size="22"
        text-anchor="middle"
        dominant-baseline="central"
      >
        {{ total }}
      </text>
    </svg>
    <ul class="flex min-w-0 flex-col gap-1">
      <li
        v-for="arc in arcs"
        :key="arc.status"
        class="grid grid-cols-[0.5rem_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs"
      >
        <span class="size-2 rounded-full" :class="RATE_BG[arc.rate]" />
        <span class="truncate text-muted-foreground" :title="arc.status">{{ arc.status }}</span>
        <b class="font-semibold text-foreground tabular-nums">{{ arc.n }}</b>
        <span class="text-faint tabular-nums">{{ arc.pct }}%</span>
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
/** Bề dày nét vòng (đơn vị viewBox). */
const STROKE = 16

const RATE_STROKE: Record<string, string> = {
  ok: 'stroke-success',
  warn: 'stroke-warning',
  bad: 'stroke-destructive',
  unknown: 'stroke-faint',
}
const RATE_BG: Record<string, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  unknown: 'bg-faint',
}

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
