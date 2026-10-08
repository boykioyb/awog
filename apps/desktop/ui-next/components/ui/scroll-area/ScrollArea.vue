<template>
  <ScrollAreaRoot v-bind="rest" :class="cn('relative overflow-hidden', $attrs.class)">
    <ScrollAreaViewport class="h-full w-full rounded-[inherit]">
      <slot />
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

<script setup lang="ts">
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from 'reka-ui'
import { cn } from '~/lib/utils'
import ScrollBar from './ScrollBar.vue'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const rest = useForwardAttrs('class')
</script>
