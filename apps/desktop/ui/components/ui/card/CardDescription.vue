<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn('text-[1em] text-muted-foreground', props.class)"
  >
    <slot />
  </Primitive>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { cn } from '~/lib/utils'

interface Props extends PrimitiveProps {
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), { as: 'p', class: undefined })
</script>
