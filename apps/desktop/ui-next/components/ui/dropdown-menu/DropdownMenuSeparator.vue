<template>
  <DropdownMenuSeparator v-bind="rest" :class="cn('-mx-1 my-1 h-px bg-border', $attrs.class)" />
</template>

<script setup lang="ts">
import { DropdownMenuSeparator } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const rest = useForwardAttrs('class')
</script>
