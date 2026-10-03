<template>
  <ContextMenuTrigger v-bind="forwarded" :class="cn('block', props.class)">
    <slot />
  </ContextMenuTrigger>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ContextMenuTrigger, type ContextMenuTriggerProps, useForwardProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<ContextMenuTriggerProps & { class?: HTMLAttributes['class'] }>()

const forwarded = useForwardProps(props)
</script>
