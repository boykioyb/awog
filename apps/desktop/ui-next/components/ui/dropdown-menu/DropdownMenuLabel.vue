<template>
  <DropdownMenuLabel
    v-bind="rest"
    :class="
      cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', inset && 'pl-8', $attrs.class)
    "
  >
    <slot />
  </DropdownMenuLabel>
</template>

<script setup lang="ts">
// `inset` is a wrapper-only style flag — kept out of the forward.
import { computed } from 'vue'
import { DropdownMenuLabel } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const [rest, attrs] = useForwardAttrs('class', 'inset')
const inset = computed(() => attrs.inset === true || attrs.inset === '')
</script>
