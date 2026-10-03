<template>
  <ContextMenuItem
    v-bind="forwarded"
    :class="
      cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        inset && 'pl-8',
        props.class,
      )
    "
  >
    <slot />
  </ContextMenuItem>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { ContextMenuItem, type ContextMenuItemProps, useForwardProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<
  ContextMenuItemProps & { class?: HTMLAttributes['class']; inset?: boolean }
>()

const delegatedProps = computed(() => {
  const { class: _c, inset: _i, ...delegated } = props
  return delegated
})

const forwarded = useForwardProps(delegatedProps)
</script>
