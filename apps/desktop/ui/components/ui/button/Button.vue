<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>

<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'
import { type ButtonVariants, buttonVariants } from '.'

// shadcn-vue Button (ADR 0044): reka-ui Primitive (supports `as` / `asChild`) +
// cva variants over the AWOG-bridged shadcn tokens. AppButton wraps this with the
// AWOG-flavored prop API (active / loading / block + danger→destructive alias).
interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  variant: 'default',
  size: 'default',
  class: undefined,
})
</script>
