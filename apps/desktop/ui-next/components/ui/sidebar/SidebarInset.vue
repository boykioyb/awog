<template>
  <main :class="cn('relative flex min-w-0 flex-1 flex-col bg-background', props.class)">
    <slot />
  </main>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
