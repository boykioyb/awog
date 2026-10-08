<template>
  <SplitterGroup
    v-bind="$attrs"
    :direction="($attrs.direction as 'horizontal' | 'vertical' | undefined) ?? 'horizontal'"
    :class="cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', $attrs.class)"
  >
    <slot />
  </SplitterGroup>
</template>

<script setup lang="ts">
import { SplitterGroup } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })
</script>
