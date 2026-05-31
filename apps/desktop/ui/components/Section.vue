<template>
  <div class="mb-6">
    <div
      class="text-[1em] uppercase tracking-wider font-medium mb-2"
      :style="{ color: t.textDim }"
    >
      {{ title }}
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
const { t } = useTheme()
</script>
