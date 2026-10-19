<template>
  <LibraryEntityModal
    :open="open"
    :title="title"
    :lock-scrim="lockScrim"
    :width="480"
    @close="emit('close')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Khung hộp thoại nhỏ dùng chung cho các dialog OAuth / Codex / sửa tài khoản của
// Models — bọc LibraryEntityModal (Dialog shadcn): header có tiêu đề + nút đóng, slot
// body, slot footer tuỳ chọn. Escape / bấm scrim đóng, trừ khi `lockScrim` bật (luồng
// đang chạy không được tự đóng).
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    lockScrim?: boolean
  }>(),
  { lockScrim: false },
)

const emit = defineEmits<{ close: [] }>()
</script>
