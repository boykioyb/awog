<template>
  <ContextMenuItem
    v-bind="rest"
    :class="
      cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        inset && 'pl-8',
        $attrs.class,
      )
    "
  >
    <slot />
  </ContextMenuItem>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ContextMenuItem } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const [rest, attrs] = useForwardAttrs('class', 'inset')
const inset = computed(() => attrs.inset === true || attrs.inset === '')
</script>
