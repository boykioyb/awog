<template>
  <!-- Nhóm nút liền viền trên vbar của doc: chọn chế độ (Xem trước | Sửa, Sơ đồ |
       Mã nguồn) hoặc thao tác (Thu nhỏ | Vừa khung | Phóng to). `active` = nút
       đang bật (không có thì mọi nút ở trạng thái thường).
       Nút <button> thường, KHÔNG dùng `Button` của ui: Button mang chiều cao
       --ctrl-h (36px) nên dù `h-auto` vẫn cao hơn vbar 32px và viền nhóm tràn
       lên/xuống khỏi header. Nhóm cao cố định 24px. -->
  <span
    class="flex h-6 flex-none items-stretch overflow-hidden rounded-[var(--r-xs)] border border-[var(--border)]"
    role="group"
  >
    <button
      v-for="o in options"
      :key="o.id"
      type="button"
      class="grp-btn"
      :class="{ on: active === o.id }"
      :title="o.title"
      :aria-pressed="active === undefined ? undefined : active === o.id"
      @click="emit('select', o.id)"
    >
      {{ o.label }}
    </button>
  </span>
</template>

<script setup lang="ts" generic="T extends string">
defineProps<{
  options: readonly { id: T; label: string; title?: string }[]
  active?: T | null
}>()
const emit = defineEmits<{ select: [id: T] }>()
</script>

<style scoped>
/* Cao theo nhóm (24px), chữ cỡ xs với hộp dòng token; đang bật = nền nhạt +
   chữ đậm màu. */
.grp-btn {
  display: flex;
  align-items: center;
  padding: 0 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  background: transparent;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.grp-btn + .grp-btn {
  box-shadow: inset 1px 0 0 var(--border);
}
.grp-btn:hover {
  color: var(--text);
  background: var(--bgHover);
}
.grp-btn.on {
  color: var(--text);
  background: var(--bgSubtle);
}
</style>
