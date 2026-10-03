<template>
  <!-- `data-[state=inactive]:hidden` (0,2,0) must beat display utilities like
       `flex` — reka sets the [hidden] attr on inactive panels, but Tailwind's
       `display:none` on [hidden] loses to `.flex`, so inactive panels kept
       stacking real height above the active one (the browser-tab gap). -->
  <TabsContent
    v-bind="delegatedProps"
    :class="cn('focus-visible:outline-none data-[state=inactive]:hidden', props.class)"
  >
    <slot />
  </TabsContent>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { TabsContent, type TabsContentProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<TabsContentProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = computed(() => {
  const { class: _c, ...delegated } = props
  return delegated
})
</script>
