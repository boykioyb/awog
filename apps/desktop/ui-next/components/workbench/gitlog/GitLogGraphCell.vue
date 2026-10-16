<template>
  <!-- Một ô graph của một hàng log (utils/git-graph.ts): nửa trên nối từ mép trên tới
       node, nửa dưới từ node toả xuống parent. Rẽ nhánh / merge vẽ cong, làn đi qua
       vẽ thẳng — các ô xếp chồng liền nhau thành graph liền mạch. -->
  <svg class="block flex-none" :width="width * LANE_W + PAD * 2" :height="ROW_H" aria-hidden="true">
    <path
      v-for="(s, i) in row.upper"
      :key="`u${i}`"
      :d="seg(x(s.from), 0, x(s.to), ROW_H / 2)"
      :stroke="laneColor(s.color)"
      fill="none"
      stroke-width="1.6"
    />
    <path
      v-for="(s, i) in row.lower"
      :key="`l${i}`"
      :d="seg(x(s.from), ROW_H / 2, x(s.to), ROW_H)"
      :stroke="laneColor(s.color)"
      fill="none"
      stroke-width="1.6"
    />
    <!-- Merge commit: vòng rỗng; commit thường: chấm đặc (như JetBrains). -->
    <circle
      :cx="x(row.lane)"
      :cy="ROW_H / 2"
      :r="row.merge ? 3.5 : 4"
      :fill="row.merge ? 'var(--background)' : laneColor(row.color)"
      :stroke="laneColor(row.color)"
      :stroke-width="row.merge ? 1.8 : 0"
    />
  </svg>
</template>

<script setup lang="ts">
import type { GraphRow } from '~/utils/git-graph'

defineProps<{ row: GraphRow; width: number }>()

// Hình học của graph: chiều cao hàng = chiều cao hàng của bảng log (GitLogTable).
const ROW_H = 26
const LANE_W = 14
const PAD = 7

// Bảng màu làn — token theme, xoay vòng theo chỉ số màu của nhánh.
const PALETTE = [
  'var(--primary)',
  'var(--violet)',
  'var(--success)',
  'var(--warning)',
  'var(--info)',
  'var(--destructive)',
  'var(--amber)',
]
const laneColor = (c: number): string => PALETTE[c % PALETTE.length] ?? 'var(--primary)'

const x = (lane: number): number => PAD + lane * LANE_W

// Thẳng khi cùng làn, cong chữ S khi đổi làn (rẽ nhánh / hội nhánh).
function seg(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`
  const my = (y1 + y2) / 2
  return `M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
}
</script>
