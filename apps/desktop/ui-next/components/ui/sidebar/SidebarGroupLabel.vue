<template>
  <div
    :class="
      cn(
        'flex h-7 items-center px-2 text-xs font-medium text-sidebar-foreground/70 group-data-[collapsible=icon]/sidebar:hidden',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
