<template>
  <TabsTrigger
    v-bind="$attrs"
    :value="value"
    :class="
      cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5 [&_svg]:shrink-0',
        $attrs.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>

<script setup lang="ts">
// `value` is required by TabsTrigger — hoist the attrs read + cast into the
// script (an inline `as` in the template trips no-deprecated-filter on `|`).
import { computed, useAttrs } from 'vue'
import { TabsTrigger } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const value = computed(() => attrs.value as string | number)
</script>
