<template>
  <Separator
    v-bind="delegatedProps"
    :class="
      cn(
        'shrink-0 bg-border',
        props.orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
        props.class,
      )
    "
  >
    <span
      v-if="props.label"
      class="relative top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground"
    >
      {{ props.label }}
    </span>
  </Separator>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { Separator, type SeparatorProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<SeparatorProps & { class?: HTMLAttributes['class']; label?: string }>(),
  { orientation: 'horizontal', decorative: true },
)

const delegatedProps = computed(() => {
  const { class: _c, ...delegated } = props
  return delegated
})
</script>
