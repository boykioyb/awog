<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      :style="{ background: t.overlay }"
    />
    <DialogContentImpl
      v-bind="forwarded"
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          sizeClass,
          props.class,
        )
      "
      :style="cardStyle"
    >
      <slot />
    </DialogContentImpl>
  </DialogPortal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import {
  DialogContent as DialogContentImpl,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<
    DialogContentProps & { class?: HTMLAttributes['class']; size?: 'sm' | 'md' | 'lg' | 'xl' }
  >(),
  { size: 'md', class: undefined },
)
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = computed(() => {
  const { class: _class, size: _size, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegatedProps, emits)

const SIZE_MAP = {
  sm: 'max-w-[420px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[960px]',
} as const
const sizeClass = computed(() => SIZE_MAP[props.size])

const { t } = useTheme()
// Card surface = the frosted `overlay` glass (honors the liquid-glass toggle);
// the backdrop dim is t.overlay on DialogOverlay above.
const { overlay } = useGlass()
const cardStyle = computed(() => ({
  background: overlay.value.background,
  border: `1px solid ${overlay.value.borderColor}`,
  backdropFilter: overlay.value.backdropFilter,
  boxShadow: overlay.value.boxShadow,
}))
</script>
