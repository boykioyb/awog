<template>
  <div class="rounded p-3" :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }">
    <div
      class="text-[1em] uppercase tracking-wider font-medium mb-1"
      :style="{ color: t.textDim }"
    >
      {{ label }}
    </div>
    <div class="text-[1em] font-mono" :style="{ color: t.text }">{{ value }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string }>()
const { t } = useTheme()
</script>
