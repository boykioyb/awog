<template>
  <div>
    <IconSprite />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { useAppearanceDom } from '~/composables/useAppearanceDom'

// SPA (ssr:false) — paint persisted theme + locale + appearance on mount, so a
// reload reflects saved prefs without needing to open the Settings panel.
const { init } = useTheme()
const { initLocale } = useI18n()
const settings = useSettingsStore()
const { applyAll, applyReducedMotion } = useAppearanceDom()
const { maybeStart } = useOnboarding()
onMounted(() => {
  init()
  initLocale()
  applyAll(settings.appearance)
  // Reduce-motion lives in the sessions slice (not AppearanceExtras): paint the
  // saved value here, then keep <html data-reduced-motion> in sync with the
  // in-app toggle regardless of the OS prefers-reduced-motion setting.
  applyReducedMotion(settings.sessions.reducedMotion)
  watch(
    () => settings.sessions.reducedMotion,
    (on) => applyReducedMotion(on),
  )
  // First-run setup wizard — shows only for users without an account yet (it
  // hydrates accounts from the sidecar first), and never after it's completed.
  void maybeStart()
})
</script>
