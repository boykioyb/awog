<template>
  <!-- Một cạnh của graph kiến trúc. Hợp đồng §3: `inferred` PHẢI vẽ nét đứt VÀ nhãn
       phải nói rõ đây là suy luận — cạnh đọc được từ cấu hình thật không bao giờ
       được trông giống cạnh đoán. -->
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" :style="edgeStyle" />
  <EdgeLabelRenderer>
    <div class="ige" :class="{ inf: inferred }" :style="labelStyle">{{ text }}</div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@vue-flow/core'
import { computed } from 'vue'
import type { CSSProperties } from 'vue'
import type { Position } from '@vue-flow/core'
import type { InfraGraphEdge } from '~/composables/useInfraGraphApi'

// `EdgeWrapper` của VueFlow đẩy vào mọi component cạnh ~30 prop (`sourceNode`,
// `targetNode`, `selected`, `animated`, `events`, `updatable`…) và ta chỉ khai 9
// prop mình dùng: phần còn lại thành attr rơi xuống. Cạnh này có HAI nút gốc
// (`BaseEdge` + nhãn), mà Vue không tự gán attr được cho component nhiều gốc nên nó
// cảnh báo mỗi lần vẽ một cạnh. Tắt kế thừa attr là cách nói đúng ý định — chính
// `BaseEdge` của thư viện cũng khai `inheritAttrs: false` vì lý do y hệt.
defineOptions({ inheritAttrs: false })

type EdgeData = { edge: InfraGraphEdge }

// Toạ độ/neo khai bằng builtin (không phải type của VueFlow) để trình biên dịch
// template sinh được props runtime; `Position` chỉ dùng ở phép cast bên dưới.
const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
  markerEnd?: string
  data?: EdgeData
}>()

const { t } = useI18n()

const inferred = computed(() => props.data?.edge.inferred === true)

const bezier = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition as Position,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition as Position,
  }),
)

const path = computed(() => bezier.value[0])
const labelX = computed(() => bezier.value[1])
const labelY = computed(() => bezier.value[2])

/** `label` của hợp đồng là một tập giá trị cố định ⇒ đi qua i18n; giá trị lạ giữ nguyên. */
const text = computed(() => {
  const edge = props.data?.edge
  if (!edge) return ''
  const key = `infra.graph.edge.label.${edge.label}`
  const translated = t(key)
  const base = translated === key ? edge.label : translated
  return edge.inferred ? `${base} · ${t('infra.graph.edge.inferred')}` : base
})

const edgeStyle = computed<CSSProperties>(() =>
  inferred.value
    ? { stroke: 'var(--textFaint)', strokeWidth: 1.6, strokeDasharray: '6 4' }
    : { stroke: 'var(--borderStrong)', strokeWidth: 1.8 },
)

const labelStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  transform: `translate(-50%, -50%) translate(${labelX.value}px, ${labelY.value}px)`,
  pointerEvents: 'none',
}))
</script>

<style scoped>
.ige {
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bgPanel);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
}

/* Nhãn của cạnh suy luận mang đúng cảnh báo như nét đứt: đọc ra là biết độ tin. */
.ige.inf {
  color: var(--amber);
  border-color: var(--amber);
  border-style: dashed;
}
</style>
