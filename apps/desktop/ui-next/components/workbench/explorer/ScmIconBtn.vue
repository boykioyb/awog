<template>
  <!-- Icon-button vuông của Source Control view (header sync, branch popover
       toolbar, hover-actions trong row/section). `.sbi`-look: nền trong suốt,
       hover `--bgHover` (rows) / `--bgActive` (nút nằm TRÊN bề mặt đang hover),
       `active` = accent.
       NGOẠI LỆ shadcn (workbench-shadcn-migration.md): Button size nhỏ nhất
       `iconSm` = --ctrl-h-xs ≈ 28px — quá lớn cho hover-action 16/18/20px trong
       row 22-24px; ép `size-*` lại đấu thêm `[&_svg]:size-3.5` của variant và
       prop `hover:"active"`/`active`/`danger` không có variant tương đương, nên
       giữ raw <button> như WbChip. -->
  <button
    type="button"
    class="grid flex-none cursor-pointer place-items-center rounded-[var(--r-xs)] border-0 bg-transparent p-0 disabled:cursor-default disabled:opacity-40"
    :class="[
      SIZE_CLS[size],
      danger
        ? 'hover:bg-[var(--bgActive)] hover:text-[var(--destructive)] disabled:hover:bg-transparent disabled:hover:text-[var(--textDim)]'
        : `${HOVER_CLS[hover]} hover:text-[var(--text)] disabled:hover:bg-transparent disabled:hover:text-[var(--textDim)]`,
      active ? 'bg-[var(--accentDim)] text-[var(--accent)]' : 'text-[var(--textDim)]',
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
  16: 'size-[16px]',
  18: 'size-[18px]',
  20: 'size-[20px]',
}
const HOVER_CLS: Record<string, string> = {
  hover: 'hover:bg-[var(--bgHover)]',
  active: 'hover:bg-[var(--bgActive)]',
}
</script>
