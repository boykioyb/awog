<template>
  <ContextMenuTrigger v-bind="rest" :class="cn('block', $attrs.class)">
    <slot />
  </ContextMenuTrigger>
</template>

<script setup lang="ts">
import { ContextMenuTrigger } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const rest = useForwardAttrs('class')
</script>
