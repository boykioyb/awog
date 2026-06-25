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
import { useSettingsStore } from '~/stores/settings'
import { useAppearanceDom } from '~/composables/useAppearanceDom'

// SPA (ssr:false) — paint persisted theme + locale + appearance on mount, so a
// reload reflects saved prefs without needing to open the Settings panel.
const { init } = useTheme()
const { initLocale } = useI18n()
const settings = useSettingsStore()
const { applyAll } = useAppearanceDom()
onMounted(() => {
  init()
  initLocale()
  applyAll(settings.appearance)
})
</script>
