<template>
  <ContextMenuRoot v-bind="$attrs">
    <slot />
  </ContextMenuRoot>
</template>

<script setup lang="ts">
import { ContextMenuRoot } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
