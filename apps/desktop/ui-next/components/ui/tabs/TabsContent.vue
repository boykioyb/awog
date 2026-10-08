<template>
  <!-- `data-[state=inactive]:hidden` (0,2,0) must beat display utilities like
       `flex` — reka sets the [hidden] attr on inactive panels, but Tailwind's
       `display:none` on [hidden] loses to `.flex`, so inactive panels kept
       stacking real height above the active one (the browser-tab gap). -->
  <TabsContent
    v-bind="$attrs"
    :value="value"
    :class="cn('focus-visible:outline-none data-[state=inactive]:hidden', $attrs.class)"
  >
    <slot />
  </TabsContent>
</template>

<script setup lang="ts">
// No reka *Props — see Tabs.vue for why; `$attrs` carries every prop.
// `value` is required by TabsContent: read it out of attrs with a computed so
// the cast stays in the script (a bare `as` in the template trips the eslint
// no-deprecated-filter rule on the `|`).
import { computed, useAttrs } from 'vue'
import { TabsContent } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const value = computed(() => attrs.value as string | number)
</script>
