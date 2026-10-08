<template>
  <TabsRoot v-bind="$attrs">
    <slot />
  </TabsRoot>
</template>

<script setup lang="ts">
// reka *Props types chain through internal .d.ts `extends` that compiler-sfc
// cannot resolve in production builds — declare nothing and forward attrs:
// `onUpdate:*` listeners ride inside `$attrs`, so v-model still reaches the
// reka root untouched.
import { TabsRoot } from 'reka-ui'

defineOptions({ inheritAttrs: false })
</script>
