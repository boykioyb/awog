<template>
  <input
    v-model="model"
    :class="
      cn(
        'flex w-full rounded-md border border-input bg-transparent text-[1em] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 py-1' : 'h-8 px-3 py-1',
        props.class,
      )
    "
  />
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

// shadcn-vue Input (ADR 0044): transparent over the bridged `input`/`ring`
// tokens with a real focus-visible ring (the inline-:style AppInput couldn't
// express :focus-visible). `defineModel` for two-way binding.
const props = withDefaults(
  defineProps<{ class?: HTMLAttributes['class']; size?: 'sm' | 'default' }>(),
  {
    class: undefined,
    size: 'default',
  },
)

const model = defineModel<string>({ default: '' })
</script>
