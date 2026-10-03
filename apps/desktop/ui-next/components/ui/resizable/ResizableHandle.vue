<template>
  <SplitterResizeHandle
    v-bind="forwarded"
    :class="
      cn(
        'relative flex w-px items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 hover:bg-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90',
        props.class,
      )
    "
  >
    <div
      v-if="props.withHandle"
      class="z-10 flex h-8 w-3 items-center justify-center rounded-sm border border-border bg-popover"
    >
      <GripVertical class="h-3 w-3" />
    </div>
  </SplitterResizeHandle>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { GripVertical } from 'lucide-vue-next'
import {
  SplitterResizeHandle,
  type SplitterResizeHandleEmits,
  type SplitterResizeHandleProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<
  SplitterResizeHandleProps & { class?: HTMLAttributes['class']; withHandle?: boolean }
>()
const emits = defineEmits<SplitterResizeHandleEmits>()

const delegatedProps = computed(() => {
  const { class: _c, withHandle: _w, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>
