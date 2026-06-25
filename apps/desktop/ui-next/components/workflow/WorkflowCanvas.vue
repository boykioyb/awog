<template>
  <div class="canvas">
    <div class="wftoolbar">
      <span class="chip chipbtn">{{ t('workflow.toolbar.scope') }}</span>
      <span class="chip">{{ t('workflow.toolbar.dag', { n: nodes.length }) }}</span>
      <span style="flex: 1" />
      <button class="btn pri sm" @click="$emit('run')">
        <Icon name="play" />
        {{ t('workflow.toolbar.run') }}
      </button>
    </div>
    <svg style="position: absolute; inset: 0; width: 100%; height: 100%" aria-hidden="true">
      <path v-for="(edge, i) in EDGES" :key="i" class="wedge" :d="edge" />
    </svg>
    <WorkflowNode
      v-for="node in nodes"
      :key="node.id"
      :node="node"
      :selected="node.id === selected"
      @click="$emit('select', node.id)"
    />
  </div>
</template>

<script setup lang="ts">
// Dotted workflow canvas: toolbar + SVG connector edges + hand-placed absolute
// nodes. Ported verbatim from awog-prototype.html (data-page="workflows", WF state).
export type WorkflowNodeData = {
  id: string
  name: string
  badge: string
  badgeBg: string
  badgeColor: string
  meta: string
  model: string
  skill: string
  dep: string
  prompt: string
  left: string
  top: string
  hasOut: boolean
}

defineProps<{ nodes: WorkflowNodeData[]; selected: string }>()
defineEmits<{ select: [id: string]; run: [] }>()

const { t } = useI18n()

// Cubic Bézier edge paths copied 1:1 from the prototype's inline SVG.
const EDGES = [
  'M170 130 C 220 130, 220 130, 270 130',
  'M420 130 C 470 130, 470 100, 520 100',
  'M420 130 C 470 130, 470 190, 520 190',
  'M670 100 C 720 100, 720 150, 770 150',
  'M670 190 C 720 190, 720 160, 770 150',
]
</script>
