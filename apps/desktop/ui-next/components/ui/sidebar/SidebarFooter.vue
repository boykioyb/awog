<template>
  <div
    :class="
      cn(
        'flex shrink-0 items-center gap-1 border-t border-sidebar-border p-2 group-data-[collapsible=icon]/sidebar:flex-col group-data-[collapsible=icon]/sidebar:items-center',
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
