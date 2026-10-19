<template>
  <!-- raw-ok: thẻ chọn nhiều dòng (tiêu đề + mô tả) — Button shadcn cao cố định một dòng -->
  <button
    type="button"
    role="radio"
    class="flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border bg-transparent px-3 py-2.5 text-left text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    :class="selected ? 'border-selected-border bg-selected' : 'hover:bg-accent'"
    :aria-checked="selected"
    @click="emit('select')"
  >
    <span class="flex items-center gap-1.5">
      <span class="flex-1 text-base font-semibold">{{ title }}</span>
      <Icon v-if="selected" name="check" class="size-3.5 text-primary" />
    </span>
    <span v-if="desc" class="text-sm text-dim">{{ desc }}</span>
  </button>
</template>

<script setup lang="ts">
// Thẻ chọn một-trong-nhiều (radio) của bảng Cài đặt dịch Slack: tiêu đề + mô tả + dấu
// check. Thẻ đang chọn = accent-tint (`bg-selected` + `border-selected-border`), KHÔNG nền xám
// đặc — theo quy ước selection của app. Nút HTML thô vì `Button` của shadcn có chiều
// cao cố định một dòng, không chứa được tiêu đề + mô tả nhiều dòng.
defineProps<{ title: string; desc?: string; selected: boolean }>()
const emit = defineEmits<{ select: [] }>()
</script>
