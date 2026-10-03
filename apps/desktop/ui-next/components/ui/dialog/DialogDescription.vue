<template>
  <DialogDescription :class="cn('text-sm text-muted-foreground', props.class)">
    <slot />
  </DialogDescription>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DialogDescription, type DialogDescriptionProps } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<DialogDescriptionProps & { class?: HTMLAttributes['class'] }>()
</script>
