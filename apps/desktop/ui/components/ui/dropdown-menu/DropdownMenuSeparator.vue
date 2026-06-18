<template>
  <DropdownMenuSeparatorImpl :class="cn('-mx-1 my-1 h-px bg-border', props.class)" />
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DropdownMenuSeparator as DropdownMenuSeparatorImpl } from 'reka-ui'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
