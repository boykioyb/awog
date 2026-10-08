<template>
  <Separator
    v-bind="rest"
    :class="
      cn(
        'shrink-0 bg-border',
        orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
        $attrs.class,
      )
    "
  >
    <span
      v-if="label"
      class="relative top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground"
    >
      {{ label }}
    </span>
  </Separator>
</template>

<script setup lang="ts">
// Attrs-only wrapper: `orientation`, `decorative` and `label` are declared
// locally because the template reads them; everything else passes through.
import { computed } from 'vue'
import { Separator } from 'reka-ui'
import { cn } from '~/lib/utils'
import { useForwardAttrs } from '~/composables/useForwardAttrs'

defineOptions({ inheritAttrs: false })

const attrs = useForwardAttrs('class', 'label')
const rest = computed(() => ({
  decorative: true,
  orientation: 'horizontal' as const,
  ...attrs.value,
}))
const orientation = computed(() => rest.value.orientation as string)
const label = computed(() => attrs.value.label as string | undefined)
</script>
