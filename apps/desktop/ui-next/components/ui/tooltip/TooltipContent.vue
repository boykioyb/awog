<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="forwarded"
      :class="
        cn(
          'z-[180] overflow-hidden rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
          props.class,
        )
      "
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { TooltipContent, type TooltipContentProps, TooltipPortal, useForwardProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<TooltipContentProps & { class?: HTMLAttributes['class'] }>(),
  { sideOffset: 6 },
)

const delegatedProps = computed(() => {
  const { class: _c, ...delegated } = props
  return delegated
})

const forwarded = useForwardProps(delegatedProps)
</script>
