<template>
  <DropdownMenuLabelImpl
    :class="
      cn('px-2 py-1.5 text-[12px] uppercase tracking-wider text-muted-foreground', props.class)
    "
  >
    <slot />
  </DropdownMenuLabelImpl>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DropdownMenuLabel as DropdownMenuLabelImpl } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
