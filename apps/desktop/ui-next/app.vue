<template>
  <div>
    <IconSprite />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

// SPA (ssr:false) — paint persisted theme + locale on mount.
const { init } = useTheme()
const { initLocale } = useI18n()
onMounted(() => {
  init()
  initLocale()
})
</script>
