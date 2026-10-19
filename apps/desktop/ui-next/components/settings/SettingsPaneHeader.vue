<template>
  <div class="mb-2.5">
    <div class="text-lg font-semibold text-foreground">{{ title }}</div>
    <div v-if="subtitle || $slots.default" class="mt-1 text-sm text-muted-foreground">
      <slot>{{ subtitle }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
// Tiêu đề chính của một pane cài đặt (+ phụ đề tuỳ chọn). Nhãn nhóm con bên trong
// pane dùng SettingsGroupLabel.
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
  }>(),
  { subtitle: '' },
)
</script>
