<template>
  <DialogTitle
    v-bind="$attrs"
    :class="cn('text-base font-semibold leading-none tracking-tight', $attrs.class)"
  >
    <slot />
  </DialogTitle>
</template>

<script setup lang="ts">
import { DialogTitle } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })
</script>
