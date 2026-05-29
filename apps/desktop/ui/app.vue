<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useWorkspaceStore } from '~/stores/workspace'

useAppearance()

// Global hydration: every page (including /mcp-servers, /skills) needs the
// active Anthropic account in the store, not just /settings and /sessions.
const settings = useSettingsStore()
const workspace = useWorkspaceStore()

let unsubscribeFs: (() => void) | null = null

onMounted(() => {
  settings.hydrateFromSidecar().catch(() => {
    // Silent: hydration logs its own warning if sidecar is offline.
  })
  // Subscribe to filesystem watcher events (Sprint 3 C1). One subscription
  // for the whole app; each page just needs its store to be re-hydrated when
  // the matching `*.fs-changed` event arrives.
  workspace
    .subscribeFsEvents()
    .then((unlisten: () => void) => {
      unsubscribeFs = unlisten
    })
    .catch(() => {
      // Sidecar offline / event channel unavailable — skip.
    })
})

onBeforeUnmount(() => {
  if (unsubscribeFs) unsubscribeFs()
})
</script>
