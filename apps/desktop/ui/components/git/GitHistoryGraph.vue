<template>
  <svg
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="block flex-shrink-0"
    :style="{ background: 'transparent' }"
    aria-hidden="true"
  >
    <!-- Edges first so the commit dots sit on top. -->
    <path
      v-for="(edge, idx) in edgePaths"
      :key="`e-${idx}`"
      :d="edge.d"
      fill="none"
      :stroke="edge.color"
      :stroke-width="edge.fromLane === edge.toLane ? 1.5 : 1.25"
      stroke-linecap="round"
    />
    <g v-for="dot in dotLayouts" :key="`d-${dot.hash}`">
      <circle
        :cx="dot.cx"
        :cy="dot.cy"
        :r="dot.isSelected ? 5 : 4"
        :fill="dot.color"
        :stroke="dot.isSelected ? t.text : t.bgPanel"
        :stroke-width="dot.isSelected ? 2 : 1.5"
        class="cursor-pointer"
        @click="emit('select', dot.hash)"
      />
    </g>
  </svg>
</template>

<script setup lang="ts">
import type { GitCommit } from '~/types'
import { computeDagLayout, type DagLayout } from '~/utils/dag-layout'

type Props = {
  commits: GitCommit[]
  selectedHash: string | null
  rowHeight?: number
  laneWidth?: number
  // Optional pre-computed layout from parent to avoid duplicate work when the
  // table needs `laneCount` for padding. Falls back to recomputing if absent.
  layout?: DagLayout
}

const props = withDefaults(defineProps<Props>(), {
  rowHeight: 28,
  laneWidth: 20,
  selectedHash: null,
  layout: undefined,
})

const emit = defineEmits<{ select: [hash: string] }>()

const { t } = useTheme()

const laneColor = (lane: number): string => {
  const tk = t.value
  const palette = [tk.accent, tk.info, tk.warning, tk.success, tk.danger]
  return palette[lane % palette.length] ?? tk.accent
}

const layout = computed<DagLayout>(() => props.layout ?? computeDagLayout(props.commits))

const xForLane = (lane: number) => lane * props.laneWidth + props.laneWidth / 2
const yForRow = (row: number) => row * props.rowHeight + props.rowHeight / 2

const cubicEdge = (x1: number, y1: number, x2: number, y2: number): string => {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const midY = (y1 + y2) / 2
  const ctrlOffset = props.rowHeight / 2
  return `M ${x1} ${y1} C ${x1} ${midY + ctrlOffset / 2}, ${x2} ${midY - ctrlOffset / 2}, ${x2} ${y2}`
}

const dotLayouts = computed(() =>
  layout.value.dots.map((d) => ({
    hash: d.hash,
    cx: xForLane(d.lane),
    cy: yForRow(d.row),
    color: laneColor(d.lane),
    isSelected: props.selectedHash === d.hash,
  })),
)

const edgePaths = computed(() =>
  layout.value.edges.map((e) => ({
    d: cubicEdge(xForLane(e.fromLane), yForRow(e.fromRow), xForLane(e.toLane), yForRow(e.toRow)),
    color: laneColor(e.toLane),
    fromLane: e.fromLane,
    toLane: e.toLane,
  })),
)

const width = computed(() => Math.max(2, layout.value.laneCount) * props.laneWidth)
const height = computed(() => props.commits.length * props.rowHeight)
</script>
