<template>
  <DialogTitleImpl :class="cn('text-[1em] font-medium text-foreground', props.class)">
    <slot />
  </DialogTitleImpl>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DialogTitle as DialogTitleImpl } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
