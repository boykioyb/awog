<template>
  <TooltipTrigger v-bind="$attrs">
    <slot />
  </TooltipTrigger>
</template>

<script setup lang="ts">
import { TooltipTrigger } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
