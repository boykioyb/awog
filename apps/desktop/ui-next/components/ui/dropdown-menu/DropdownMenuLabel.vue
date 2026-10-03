<template>
  <DropdownMenuLabel
    v-bind="forwarded"
    :class="
      cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', inset && 'pl-8', props.class)
    "
  >
    <slot />
  </DropdownMenuLabel>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { DropdownMenuLabel, type DropdownMenuLabelProps, useForwardProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<
  DropdownMenuLabelProps & { class?: HTMLAttributes['class']; inset?: boolean }
>()

const delegatedProps = computed(() => {
  const { class: _c, inset: _i, ...delegated } = props
  return delegated
})

const forwarded = useForwardProps(delegatedProps)
</script>
