<template>
  <div class="font-mono text-[1em]">
    <TraceNodeItem v-for="item in trace" :key="item.id" :item="item" :depth="0" />
  </div>
</template>

<script setup lang="ts">
import type { TraceNode } from '~/types'

defineProps<{
  trace: TraceNode[]
}>()
</script>
