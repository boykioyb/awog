<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Appearance</h2>
      <div class="text-xs" :style="{ color: t.textDim }">
        Toggle theme using the icon in the sidebar
      </div>
    </div>
    <div class="text-[12px]" :style="{ color: t.textMuted }">
      Use the moon/sun toggle in the bottom-left of the sidebar to switch between dark and light
      mode.
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useTheme()
</script>
