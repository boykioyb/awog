<template>
  <Checkbox :model-value="state" @update:model-value="toggle" @click.stop>
    <template #default="{ state: s }">
      <Minus v-if="s === 'indeterminate'" class="size-3.5" />
      <Check v-else class="size-3.5" />
    </template>
  </Checkbox>
</template>

<script setup lang="ts">
// Checkbox nhỏ theo token (hàng bulk-select trong CollectionList…) — ruột là shadcn
// `Checkbox`, API cũ giữ nguyên: `checked` + `indeterminate` vào, `update:checked`
// ra. Click không nổi lên row cha (stop).
import { Check, Minus } from 'lucide-vue-next'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ checked?: boolean; indeterminate?: boolean }>(), {
  checked: false,
  indeterminate: false,
})
const emit = defineEmits<{ 'update:checked': [value: boolean] }>()

// reka nhận 'indeterminate' như một giá trị của modelValue; bản cũ chỉ vẽ dấu trừ
// khi chưa `checked`.
const state = computed<boolean | 'indeterminate'>(() =>
  props.indeterminate && !props.checked ? 'indeterminate' : props.checked,
)

// Bỏ qua giá trị reka đề xuất — luôn phát đảo của `checked` như bản cũ (bấm khi
// đang indeterminate ⇒ true).
function toggle() {
  emit('update:checked', !props.checked)
}
</script>
