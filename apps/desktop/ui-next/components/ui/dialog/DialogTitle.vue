<template>
  <DialogTitle :class="cn('text-base font-semibold leading-none tracking-tight', props.class)">
    <slot />
  </DialogTitle>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DialogTitle, type DialogTitleProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<DialogTitleProps & { class?: HTMLAttributes['class'] }>()
</script>
