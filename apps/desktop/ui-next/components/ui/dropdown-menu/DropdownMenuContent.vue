<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      v-bind="rest"
      :class="
        cn(
          'z-[180] min-w-[10rem] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
          $attrs.class,
        )
      "
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>

<script setup lang="ts">
// reka *Props types can't be resolved by compiler-sfc in production builds —
// forward attrs with the sideOffset default inlined (attrs win over it).
import { computed } from 'vue'
import { DropdownMenuContent, DropdownMenuPortal } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const attrs = useForwardAttrs('class')
const rest = computed(() => ({ sideOffset: 6, ...attrs.value }))
</script>
