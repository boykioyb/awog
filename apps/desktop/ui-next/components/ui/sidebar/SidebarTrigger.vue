<template>
  <Button variant="ghost" size="iconSm" :class="cn(props.class)" @click="toggle">
    <PanelLeft />
    <span class="sr-only">Toggle sidebar</span>
  </Button>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { PanelLeft } from 'lucide-vue-next'
import { cn } from '~/lib/utils'
import { useSidebar } from './utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const { toggle } = useSidebar()
</script>
