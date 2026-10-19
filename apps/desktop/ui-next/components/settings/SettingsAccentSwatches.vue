<template>
  <div class="flex gap-2" role="radiogroup" :aria-label="label">
    <!-- Ô màu: nền inline là chính giá trị accent người dùng chọn (dữ liệu ghi vào
         theme), không phải token để tô UI. -->
    <Button
      v-for="color in ACCENTS"
      :key="color"
      type="button"
      variant="ghost"
      size="iconSm"
      role="radio"
      :aria-checked="color === accent"
      :title="color"
      class="size-6 rounded-md p-0 ring-offset-2 ring-offset-background"
      :class="{ 'ring-2 ring-foreground': color === accent }"
      :style="{ background: color }"
      @click="setAccent(color)"
    />
  </div>
</template>

<script setup lang="ts">
// Bảng chọn màu accent dùng chung cho Settings → Appearance và bước Appearance của
// onboarding. Ghi thẳng qua useTheme (áp dụng + lưu ngay).
defineProps<{ label: string }>()

// Bảng accent là DỮ LIỆU người dùng chọn, không phải màu tô UI.
// hex-ok: bảng màu accent cho người dùng chọn — là dữ liệu, không phải màu tô UI
const ACCENTS = ['#10b981', '#60a5fa', '#a78bfa', '#f59e0b', '#f43f5e', '#22d3ee', '#fafafa']

// theme-ok: chỉ đọc/ghi trạng thái theme, không tô màu
const { accent, setAccent } = useTheme()
</script>
