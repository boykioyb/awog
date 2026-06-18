<template>
  <SeparatorRoot
    :as="as"
    :as-child="asChild"
    :orientation="orientation"
    :decorative="decorative"
    :class="
      cn(
        'shrink-0 bg-border',
        orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
        props.class,
      )
    "
  />
</template>

<script setup lang="ts">
import { Separator as SeparatorRoot, type SeparatorProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

// shadcn-vue Separator (ADR 0044): reka-ui Separator over the bridged `border`
// token. Replaces the app's hand-rolled `borderBottom: 1px solid t.border` /
// `<span class="w-px">` dividers with one a11y-correct primitive.
interface Props extends SeparatorProps {
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'div',
  orientation: 'horizontal',
  decorative: true,
  class: undefined,
})
</script>
