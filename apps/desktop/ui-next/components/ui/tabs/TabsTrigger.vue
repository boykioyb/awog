<template>
  <TabsTrigger
    v-bind="delegatedProps"
    :class="
      cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5 [&_svg]:shrink-0',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { TabsTrigger, type TabsTriggerProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = computed(() => {
  const { class: _c, ...delegated } = props
  return delegated
})
</script>
