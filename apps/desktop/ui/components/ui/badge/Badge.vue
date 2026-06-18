<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(badgeVariants({ variant, size }), props.class)"
    :style="semanticStyle"
  >
    <slot />
  </Primitive>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { cn } from '~/lib/utils'
import { type BadgeVariants, badgeVariants } from '.'

interface Props extends PrimitiveProps {
  variant?: BadgeVariants['variant']
  size?: BadgeVariants['size']
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'span',
  variant: 'default',
  size: 'default',
  class: undefined,
})

const { t } = useTheme()

// warning/info live outside the shadcn token bridge — paint them from the live
// theme so they track accent/preset/dark-light like every other semantic chip.
const semanticStyle = computed(() => {
  if (props.variant === 'warning') return { background: t.value.warningBg, color: t.value.warning }
  if (props.variant === 'info') return { background: t.value.infoBg, color: t.value.info }
  return undefined
})
</script>
