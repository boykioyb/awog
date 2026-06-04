<template>
  <div>
    <label
      class="text-[1em] uppercase tracking-wider block mb-1.5 font-medium"
      :style="{ color: t.textDim }"
    >
      {{ label }}
    </label>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
const { t } = useTheme()
</script>
