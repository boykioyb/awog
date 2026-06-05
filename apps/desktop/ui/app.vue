<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useWorkspaceStore } from '~/stores/workspace'
import { useTasksStore } from '~/stores/tasks'
import { useWorkflowsStore } from '~/stores/workflows'
import { useUpdateStore } from '~/stores/update'

useAppearance()
// Load the persisted auto-update toggle before the store schedules checks.
useUpdateSettings()

// Global hydration: every page (including /mcp-servers, /skills) needs the
// active Anthropic account in the store, not just /settings and /sessions.
const settings = useSettingsStore()
const workspace = useWorkspaceStore()
// Tasks run in the background and survive navigation, so their store hydrates +
// subscribes at app lifetime (not per-page). TopBar / edit pages read tasks too.
const tasks = useTasksStore()
const workflows = useWorkflowsStore()
const update = useUpdateStore()

let unsubscribeFs: (() => void) | null = null
let unsubscribeTasks: (() => void) | null = null
let unsubscribeUpdate: (() => void) | null = null

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

  // Tasks: subscribe to task.* execution events FIRST (so nothing is missed
  // during hydrate), then hydrate the list + the workflows they reference.
  tasks
    .subscribe()
    .then((unlisten) => {
      unsubscribeTasks = unlisten
    })
    .catch(() => {})
  tasks.hydrateFromSidecar().catch(() => {})
  workflows.hydrateFromSidecar().catch(() => {})

  // Auto-update: read app info, listen for updater events, schedule checks.
  update
    .subscribe()
    .then((unlisten) => {
      unsubscribeUpdate = unlisten
    })
    .catch(() => {})
})

onBeforeUnmount(() => {
  if (unsubscribeFs) unsubscribeFs()
  if (unsubscribeTasks) unsubscribeTasks()
  if (unsubscribeUpdate) unsubscribeUpdate()
})
</script>
