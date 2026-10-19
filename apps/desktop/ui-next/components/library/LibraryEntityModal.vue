<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <!-- Bề rộng theo prop `width` (px), chặn 94vw; nút X là DialogClose có sẵn của
         DialogContent nên header chừa pr-12. -->
    <DialogContent
      class="flex max-h-[86vh] max-w-[94vw] flex-col gap-0 overflow-hidden border-input bg-card p-0 sm:rounded-2xl"
      :style="{ width: widthPx }"
      @pointer-down-outside="onPointerOutside"
      @focus-outside.prevent
      @escape-key-down="onEscape"
    >
      <DialogHeader class="flex-none flex-row items-center gap-2.5 border-b px-4.5 py-3.5 pr-12">
        <DialogTitle class="text-lg font-semibold">{{ title }}</DialogTitle>
        <span v-if="$slots['header-extra']" class="flex items-center gap-1.5">
          <slot name="header-extra" />
        </span>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto p-4.5">
        <slot />
      </div>
      <div
        v-if="$slots.footer"
        class="flex flex-none items-center justify-end gap-2 border-t px-4.5 py-3"
      >
        <slot name="footer" />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'

// Generic library modal shell — the BaseModal/EditorShell idiom for ui-next, dựng
// trên Dialog shadcn: header có tiêu đề, slot body, slot footer tuỳ chọn cho nút
// hành động. Dùng cho mọi editor / body-edit dialog của thư viện. Escape + bấm
// scrim đóng (trừ khi `lockScrim` bật cho luồng đang chạy).
//
// focus-outside bị chặn: modal cũ chỉ đóng khi bấm đúng scrim, không đóng khi focus
// nhảy sang một bề mặt teleport khác (toast, popover tự viết…).

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    lockScrim?: boolean
    // Card width in px; defaults to 560 (form editors). Pass a larger value for
    // wide editors. Capped to 94vw responsively.
    width?: number
  }>(),
  { lockScrim: false, width: 560 },
)

const emit = defineEmits<{ close: [] }>()

const widthPx = `${props.width}px`

const onPointerOutside = (e: Event) => {
  if (props.lockScrim) e.preventDefault()
}
const onEscape = (e: KeyboardEvent) => {
  if (props.lockScrim) e.preventDefault()
}
</script>
