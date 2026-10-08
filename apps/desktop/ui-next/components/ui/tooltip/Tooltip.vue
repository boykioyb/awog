<template>
  <TooltipRoot v-bind="$attrs">
    <slot />
  </TooltipRoot>
</template>

<script setup lang="ts">
// See TooltipContent.vue — no reka types; `onUpdate:open` rides in `$attrs`.
import { TooltipRoot } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
