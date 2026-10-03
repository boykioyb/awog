<template>
  <SplitterGroup
    v-bind="forwarded"
    :class="cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', props.class)"
  >
    <slot />
  </SplitterGroup>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import {
  SplitterGroup,
  type SplitterGroupEmits,
  type SplitterGroupProps,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<SplitterGroupProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<SplitterGroupEmits>()

const delegatedProps = computed(() => {
  const { class: _c, ...delegated } = props
  return delegated
})

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>
