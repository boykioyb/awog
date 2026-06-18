<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(cardVariants({ variant }), props.class)"
    :style="variant === 'glass' ? glassStyle : undefined"
  >
    <slot />
  </Primitive>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { cn } from '~/lib/utils'
import { type CardVariants, cardVariants } from '.'

interface Props extends PrimitiveProps {
  variant?: CardVariants['variant']
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'div',
  variant: 'flat',
  class: undefined,
})

// Glass variant routes through the single useGlass() source so the app-wide
// liquid-glass toggle still flips it; flat surfaces are intentionally
// toggle-independent.
const { elevated } = useGlass()
const glassStyle = computed(() => ({
  background: elevated.value.background,
  border: `1px solid ${elevated.value.borderColor}`,
  backdropFilter: elevated.value.backdropFilter,
  boxShadow: elevated.value.boxShadow,
}))
</script>
