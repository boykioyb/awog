<template>
  <TabsList
    v-bind="$attrs"
    :class="
      cn(
        'inline-flex h-[var(--ctrl-h)] items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        $attrs.class,
      )
    "
  >
    <slot />
  </TabsList>
</template>

<script setup lang="ts">
import { TabsList } from 'reka-ui'
import { cn } from '~/lib/utils'

defineOptions({ inheritAttrs: false })
</script>
