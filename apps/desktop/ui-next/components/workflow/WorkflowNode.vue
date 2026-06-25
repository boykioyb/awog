<template>
  <div class="wnode" :class="{ sel: selected }" :style="{ left: node.left, top: node.top }">
    <div class="wt">
      <span class="wbadge" :style="{ background: node.badgeBg, color: node.badgeColor }">
        {{ node.badge }}
      </span>
      {{ node.name }}
    </div>
    <div class="wm">{{ node.meta }}</div>
    <span v-if="node.hasOut" class="wd" />
  </div>
</template>

<script setup lang="ts">
// One absolute-positioned workflow node — ported verbatim from the .wnode markup
// in awog-prototype.html (data-page="workflows"). Position/color from mock data.
import type { WorkflowNodeData } from './WorkflowCanvas.vue'

defineProps<{ node: WorkflowNodeData; selected: boolean }>()
</script>
