<template>
  <ul :class="cn('flex w-full flex-col gap-0.5', props.class)">
    <slot />
  </ul>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
