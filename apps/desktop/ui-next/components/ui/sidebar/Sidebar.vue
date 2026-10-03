<template>
  <aside
    :data-state="state"
    :data-collapsible="state === 'collapsed' ? collapsible : ''"
    :data-side="side"
    :class="
      cn(
        'group/sidebar relative flex h-full shrink-0 flex-col gap-0 overflow-hidden border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out',
        side === 'left' ? 'border-r' : 'border-l',
        props.class,
      )
    "
    :style="{
      width: open ? SIDEBAR_WIDTH : collapsible === 'icon' ? SIDEBAR_WIDTH_ICON : '0px',
    }"
  >
    <slot />
  </aside>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_ICON, useSidebar } from './utils'

const props = withDefaults(
  defineProps<{
    side?: 'left' | 'right'
    class?: HTMLAttributes['class']
  }>(),
  { side: 'left' },
)

const { open, collapsible, state } = useSidebar()
</script>
