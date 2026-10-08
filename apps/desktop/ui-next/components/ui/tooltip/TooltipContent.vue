<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="{ sideOffset: 6, ...$attrs }"
      :class="
        cn(
          'z-[180] overflow-hidden rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
          $attrs.class,
        )
      "
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>

<script setup lang="ts">
// reka-ui's `TooltipContentProps` extends an internal `TooltipContentImplProps`
// that the SFC compiler cannot resolve in production builds. Declare no props
// and forward `$attrs` instead — same surface, no type-level dependency.
import { TooltipContent, TooltipPortal } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })
</script>
