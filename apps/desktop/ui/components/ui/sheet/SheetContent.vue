<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      :style="{ background: t.overlay }"
    />
    <DialogContent
      v-bind="forwarded"
      :class="cn(sheetVariants({ side }), props.class)"
      :style="cardStyle"
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cva, type VariantProps } from 'class-variance-authority'
import {
  DialogContent,
  type DialogContentEmits,
  type DialogContentProps,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { cn } from '~/lib/utils'

const sheetVariants = cva(
  'fixed z-50 flex flex-col text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 max-h-[85vh] border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 max-h-[85vh] border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full w-[min(520px,90vw)] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        right:
          'inset-y-0 right-0 h-full w-[min(520px,90vw)] border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
      },
    },
    defaultVariants: { side: 'right' },
  },
)
type SheetVariants = VariantProps<typeof sheetVariants>

const props = withDefaults(
  defineProps<
    DialogContentProps & { class?: HTMLAttributes['class']; side?: SheetVariants['side'] }
  >(),
  { side: 'right', class: undefined },
)
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = computed(() => {
  const { class: _class, side: _side, ...rest } = props
  return rest
})
const forwarded = useForwardPropsEmits(delegatedProps, emits)

const { t } = useTheme()
const { overlay } = useGlass()
// Only the edge-facing border shows (others sit off-screen); set color via the
// glass surface, side via the cva `border-*` width above.
const cardStyle = computed(() => ({
  background: overlay.value.background,
  borderColor: overlay.value.borderColor,
  backdropFilter: overlay.value.backdropFilter,
  boxShadow: overlay.value.boxShadow,
}))
</script>
