<template>
  <PopoverPortal>
    <PopoverContentImpl
      v-bind="forwarded"
      :class="
        cn(
          'z-50 overflow-hidden rounded-md text-popover-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          props.class,
        )
      "
      :style="menuStyle"
    >
      <slot />
    </PopoverContentImpl>
  </PopoverPortal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import {
  PopoverContent as PopoverContentImpl,
  type PopoverContentEmits,
  type PopoverContentProps,
  PopoverPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<PopoverContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    align: 'start',
    sideOffset: 4,
    class: undefined,
  },
)
const emits = defineEmits<PopoverContentEmits>()

const delegatedProps = computed(() => {
  const { class: _class, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegatedProps, emits)

const { menu } = useGlass()
const menuStyle = computed(() => ({
  background: menu.value.background,
  border: `1px solid ${menu.value.borderColor}`,
  backdropFilter: menu.value.backdropFilter,
  boxShadow: menu.value.boxShadow,
}))
</script>
