<template>
  <!-- Một dòng whitelist: cả dòng là nhãn của checkbox nên bấm chữ cũng bật/tắt. Dòng đã
       chọn = accent-tint (quy ước selection của app). -->
  <label
    class="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5"
    :class="{ 'bg-selected': checked }"
  >
    <Checkbox :model-value="checked" @update:model-value="emit('toggle')" />
    <slot />
  </label>
</template>

<script setup lang="ts">
defineProps<{ checked: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
</script>
