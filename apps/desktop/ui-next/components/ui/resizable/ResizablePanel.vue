<template>
  <SplitterPanel v-bind="$attrs">
    <slot />
  </SplitterPanel>
</template>

<script setup lang="ts">
import { SplitterPanel } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
