<template>
  <DropdownMenuItem
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
  </DropdownMenuItem>
</template>

<script setup lang="ts">
// `inset` is a wrapper-only style flag: read it, keep it out of the forward.
import { computed } from 'vue'
import { DropdownMenuItem } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const [rest, attrs] = useForwardAttrs('class', 'inset')
const inset = computed(() => attrs.inset === true || attrs.inset === '')
</script>
