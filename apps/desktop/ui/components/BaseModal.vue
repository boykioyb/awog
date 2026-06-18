<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent
      :size="size"
      @escape-key-down="onEscapeKeyDown"
      @interact-outside="onInteractOutside"
    >
      <!-- Header: `title` prop or a custom `#header` slot, plus the close button. -->
      <div
        v-if="$slots.header || title"
        class="flex items-center gap-2 border-b border-border px-4 py-3"
      >
        <slot name="header">
          <DialogTitle>{{ title }}</DialogTitle>
        </slot>
        <DialogClose
          class="ml-auto text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X :size="15" />
        </DialogClose>
      </div>
      <!-- a11y: guarantee exactly one DialogTitle even with a custom header / no title. -->
      <DialogTitle v-if="$slots.header || !title" class="sr-only">
        {{ title || 'Dialog' }}
      </DialogTitle>

      <div class="flex-1 overflow-y-auto">
        <slot />
      </div>

      <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-border px-4 py-3">
        <slot name="footer" />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '~/components/ui/dialog'

// Rebuilt on the shadcn-vue Dialog primitive (ADR 0044) so every modal in the app
// shares one form + a11y (reka-ui handles focus-trap, escape, scroll-lock, aria).
// The public API (open / title / size / closeOnBackdrop / closeOnEscape + `close`
// emit + header/footer/default slots) is unchanged — all ~23 call sites and the
// git/confirm modals keep working untouched.
type Props = {
  open: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  size: 'md',
  closeOnBackdrop: true,
  closeOnEscape: true,
})
const emit = defineEmits<{ close: [] }>()

const onOpenChange = (next: boolean) => {
  if (!next) emit('close')
}
const onEscapeKeyDown = (e: KeyboardEvent) => {
  if (!props.closeOnEscape) e.preventDefault()
}
// Fires for both pointer-down and focus moving outside — one guard covers backdrop
// clicks and tab-out, mirroring the old useClickOutside behaviour.
const onInteractOutside = (e: Event) => {
  if (!props.closeOnBackdrop) e.preventDefault()
}
</script>
