<template>
  <DialogDescriptionImpl :class="cn('text-[1em] text-muted-foreground', props.class)">
    <slot />
  </DialogDescriptionImpl>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DialogDescription as DialogDescriptionImpl } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
