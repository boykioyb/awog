<template>
  <DialogRoot v-bind="$attrs">
    <slot />
  </DialogRoot>
</template>

<script setup lang="ts">
import { DialogRoot } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
