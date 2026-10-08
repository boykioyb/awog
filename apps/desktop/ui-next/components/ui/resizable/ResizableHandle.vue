<template>
  <SplitterResizeHandle
    v-bind="rest"
    :class="
      cn(
        'relative flex w-px items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 hover:bg-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90',
        $attrs.class,
      )
    "
  >
    <div
      v-if="withHandle"
      class="z-10 flex h-8 w-3 items-center justify-center rounded-sm border border-border bg-popover"
    >
      <GripVertical class="h-3 w-3" />
    </div>
  </SplitterResizeHandle>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import { SplitterResizeHandle } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const rest = useForwardAttrs('class', 'withHandle')
const withHandle = computed(() => rest.value.withHandle === true || rest.value.withHandle === '')
</script>
