<template>
  <th
    data-slot="table-head"
    :class="
      cn(
        'h-9 px-2 text-left align-middle font-medium text-muted-foreground has-[[role=checkbox]]:pr-0 *:[[role=checkbox]]:translate-y-[2px]',
        props.class,
      )
    "
  >
    <slot />
  </th>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
