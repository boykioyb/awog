<template>
  <ContextMenuLabel
    :class="
      cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', inset && 'pl-8', props.class)
    "
  >
    <slot />
  </ContextMenuLabel>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ContextMenuLabel } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class']; inset?: boolean }>()
</script>
