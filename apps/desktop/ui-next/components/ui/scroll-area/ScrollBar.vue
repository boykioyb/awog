<template>
  <ScrollAreaScrollbar
    v-bind="rest"
    :class="
      cn(
        'flex touch-none select-none transition-colors',
        orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent p-px',
        orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent p-px',
        $attrs.class,
      )
    "
  >
    <ScrollAreaThumb class="relative flex-1 rounded-full bg-border" />
  </ScrollAreaScrollbar>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const [rest, attrs] = useForwardAttrs('class')
// `orientation` defaults to vertical (reka's own default is the same — we keep
// it explicit because the class list branches on it). Read the raw attrs —
// `rest` only drops `class`, so it works too, but `attrs` is the convention.
const orientation = computed(
  () => (attrs.orientation as 'vertical' | 'horizontal' | undefined) ?? 'vertical',
)
</script>
