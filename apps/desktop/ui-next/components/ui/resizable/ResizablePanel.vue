<template>
  <SplitterPanel v-bind="forwarded">
    <slot />
  </SplitterPanel>
</template>

<script setup lang="ts">
import {
  SplitterPanel,
  type SplitterPanelEmits,
  type SplitterPanelProps,
  useForwardPropsEmits,
} from 'reka-ui'

const props = defineProps<SplitterPanelProps>()
const emits = defineEmits<SplitterPanelEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>
