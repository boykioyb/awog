<template>
  <!-- Tooltip only in icon-collapsed mode (label hidden) — mirrors shadcn's
       `tooltip` prop on SidebarMenuButton. -->
  <Tooltip v-if="tooltip">
    <TooltipTrigger as-child>
      <component
        :is="as"
        v-bind="delegated"
        :class="cn(sidebarMenuButtonVariants({ isActive }), props.class)"
      >
        <slot />
      </component>
    </TooltipTrigger>
    <TooltipContent side="right">{{ tooltip }}</TooltipContent>
  </Tooltip>
  <component
    :is="as"
    v-else
    v-bind="delegated"
    :class="cn(sidebarMenuButtonVariants({ isActive }), props.class)"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cva } from 'class-variance-authority'
import { cn } from '~/lib/utils'

// Stock shadcn sidebar-menu-button shape: hover/active resolve to
// --sidebar-accent, icon-collapse keeps the icon centered.
const sidebarMenuButtonVariants = cva(
  'peer/menu-button relative flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left text-sm text-sidebar-foreground/70 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 group-data-[collapsible=icon]/sidebar:justify-center group-data-[collapsible=icon]/sidebar:px-0 [&>span:last-child]:truncate group-data-[collapsible=icon]/sidebar:[&>span:last-child]:hidden',
  {
    variants: {
      isActive: {
        true: 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        false: '',
      },
    },
  },
)

const props = withDefaults(
  defineProps<{
    isActive?: boolean
    tooltip?: string
    class?: HTMLAttributes['class']
    as?: string
    href?: string
  }>(),
  { as: 'button' },
)

const delegated = computed(() => {
  const { class: _c, isActive: _a, tooltip: _t, as: _as, ...rest } = props
  return rest
})
</script>
