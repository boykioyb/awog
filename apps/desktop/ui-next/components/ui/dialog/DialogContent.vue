<template>
  <DialogPortal>
    <DialogOverlay
      class="fixed inset-0 z-170 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
    />
    <DialogContent
      v-bind="$attrs"
      :class="
        cn(
          'fixed left-1/2 top-1/2 z-170 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2 sm:rounded-xl',
          $attrs.class,
        )
      "
    >
      <slot />
      <DialogClose
        class="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none [&_svg]:size-4"
        aria-label="Close"
      >
        <X />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>

<script setup lang="ts">
// reka *Props/*Emits types can't be resolved by compiler-sfc in production
// builds — forward `$attrs` (which also carries `onEscapeKeyDown` & friends
// as listeners) and keep the root free of declared props.
import { DialogClose, DialogContent, DialogOverlay, DialogPortal } from 'reka-ui'
import { X } from 'lucide-vue-next'
import { cn } from '~/lib/utils'

// Hộp căn giữa bằng translate(-50%,-50%). Keyframe enter/exit của tailwindcss-animate
// ghi đè cả `transform` bằng translate(--tw-enter-translate-*) ⇒ thiếu giá trị thì frame
// đầu hộp lệch về góc phải-dưới rồi trượt vào giữa. `slide-*-1/2` đặt các biến đó = -50%
// (animation chỉ còn zoom + fade quanh tâm). Phải dùng chính utility này CÙNG biến thể
// data-[state]: `data-[state=open]:animate-in` reset các biến về `initial` với độ ưu tiên
// class+attribute, nên class arbitrary trơn `[--tw-enter-translate-x:-50%]` bị đè.

defineOptions({ inheritAttrs: false })
</script>
