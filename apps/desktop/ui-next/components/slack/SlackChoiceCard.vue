<template>
  <button
    type="button"
    role="radio"
    class="slk-choice"
    :class="{ on: selected }"
    :aria-checked="selected"
    @click="emit('select')"
  >
    <span class="slk-choice-hd">
      <span class="slk-choice-title">{{ title }}</span>
      <Icon v-if="selected" name="check" class="slk-choice-check" />
    </span>
    <span v-if="desc" class="slk-choice-desc">{{ desc }}</span>
  </button>
</template>

<script setup lang="ts">
// Thẻ chọn một-trong-nhiều (radio) của bảng Cài đặt dịch Slack: tiêu đề + mô tả + dấu
// check. Thẻ đang chọn = accent-tint (`--accentDim` + `--accentBorder`), KHÔNG nền xám
// đặc — theo quy ước selection của app. `<button>` thô vì `Button` của shadcn có chiều
// cao cố định một dòng, không chứa được tiêu đề + mô tả nhiều dòng.
defineProps<{ title: string; desc?: string; selected: boolean }>()
const emit = defineEmits<{ select: [] }>()
</script>

<style scoped>
/* Khối thẻ nhiều dòng (tiêu đề + mô tả) — Tailwind không có sẵn token màu/radius của app. */
.slk-choice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.slk-choice:hover {
  background: var(--bgHover);
}
.slk-choice:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.slk-choice.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
}
.slk-choice-hd {
  display: flex;
  align-items: center;
  gap: 6px;
}
.slk-choice-title {
  flex: 1;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}
.slk-choice-check {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--accent);
}
.slk-choice-desc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
</style>
