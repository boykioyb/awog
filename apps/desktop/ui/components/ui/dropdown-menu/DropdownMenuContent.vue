<template>
  <DropdownMenuPortal>
    <DropdownMenuContentImpl
      v-bind="forwarded"
      :class="
        cn(
          'z-50 min-w-[8rem] overflow-hidden rounded-md p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          props.class,
        )
      "
      :style="menuStyle"
    >
      <slot />
    </DropdownMenuContentImpl>
  </DropdownMenuPortal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import {
  DropdownMenuContent as DropdownMenuContentImpl,
  type DropdownMenuContentEmits,
  type DropdownMenuContentProps,
  DropdownMenuPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<DropdownMenuContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    sideOffset: 4,
    align: 'start',
    class: undefined,
  },
)
const emits = defineEmits<DropdownMenuContentEmits>()

const delegatedProps = computed(() => {
  const { class: _class, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegatedProps, emits)

// Teleported to <body> → safe to wear real frost (the in-flow header chrome
// can't, see useGlass.parts). `menu` also covers the glass-off solid fallback.
const { menu } = useGlass()
const menuStyle = computed(() => ({
  background: menu.value.background,
  border: `1px solid ${menu.value.borderColor}`,
  backdropFilter: menu.value.backdropFilter,
  boxShadow: menu.value.boxShadow,
}))
</script>
