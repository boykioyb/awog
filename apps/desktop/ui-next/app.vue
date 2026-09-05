<template>
  <div>
    <IconSprite />
    <NuxtLayout>
      <!-- keepalive: pages persist across navigation (desktop-app feel) — leaving a
           page must NOT lose its UI state or tear down live things (Sessions
           transcript/active session, SSH terminals + connections, scroll, filters).
           A page can opt out with definePageMeta({ keepalive: false }). -->
      <NuxtPage keepalive />
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
// Native window chrome: publish platform + fullscreen onto <body> for app-shell.css.
// Runs in setup (not onMounted) so the traffic-light inset is in place before the
// shell's first paint — applying it later shifts the NavRail one frame in.
useWindowChrome()
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
