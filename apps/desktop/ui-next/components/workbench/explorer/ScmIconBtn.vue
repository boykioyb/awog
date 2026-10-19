<template>
  <!-- Icon-button vuông của Source Control view (header sync, branch popover
       toolbar, hover-actions trong row/section). `.sbi`-look: nền trong suốt,
       hover `bg-accent` (rows) / `bg-muted` (nút nằm TRÊN bề mặt đang hover),
       `active` = accent.
       NGOẠI LỆ shadcn (workbench-shadcn-migration.md): Button size nhỏ nhất
       `iconSm` = --ctrl-h-xs ≈ 28px — quá lớn cho hover-action 16/18/20px trong
       row 22-24px; ép `size-*` lại đấu thêm `[&_svg]:size-3.5` của variant và
       prop `hover:"active"`/`active`/`danger` không có variant tương đương, nên
       giữ nút HTML thô như WbChip. -->
  <!-- raw-ok: hover-action 16–20px trong row 22–24px, Button nhỏ nhất (iconSm) là 28px -->
  <button
    type="button"
    class="grid flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-40"
    :class="[
      SIZE_CLS[size],
      danger
        ? 'hover:bg-muted hover:text-destructive disabled:hover:bg-transparent disabled:hover:text-dim'
        : `${HOVER_CLS[hover]} hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-dim`,
      active ? 'bg-selected text-primary' : 'text-dim',
    ]"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })
withDefaults(
  defineProps<{
    size?: 16 | 18 | 20
    /** accent tint — toggle đang bật (tree view, pin-only, branch popover) */
    active?: boolean
    /** hover đỏ — hành động huỷ (xoá nhánh) */
    danger?: boolean
    /** `active` = nút đặt trên row/section đã hover (cần `--bgActive` để thấy) */
    hover?: 'hover' | 'active'
    disabled?: boolean
  }>(),
  { size: 20, hover: 'hover' },
)

const SIZE_CLS: Record<number, string> = {
  // px cố định — hộp nút icon chẵn để icon căn giữa trúng lưới pixel (ADR 0079);
  // size-N là rem nên ở base 13px ra phân số (16.25px) → icon nhoè.
  16: 'size-4',
  18: 'size-4.5',
  20: 'size-5',
}
const HOVER_CLS: Record<string, string> = {
  hover: 'hover:bg-accent',
  active: 'hover:bg-muted',
}
</script>
