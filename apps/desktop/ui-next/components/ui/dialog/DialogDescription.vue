<template>
  <DialogDescription :class="cn('text-sm text-muted-foreground', $attrs.class)" v-bind="rest">
    <slot />
  </DialogDescription>
</template>

<script setup lang="ts">
import { DialogDescription } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const rest = useForwardAttrs('class')
</script>
