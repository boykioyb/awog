<template>
  <ContextMenuSeparator
    v-bind="delegatedProps"
    :class="cn('-mx-1 my-1 h-px bg-border', props.class)"
  />
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { ContextMenuSeparator, type ContextMenuSeparatorProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<ContextMenuSeparatorProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = computed(() => {
  const { class: _c, ...delegated } = props
  return delegated
})
</script>
