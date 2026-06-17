<template>
  <NuxtLayout>
    <!-- keepalive: section tabs stay mounted when switching tabs so their state
         survives and background work keeps running (multi-tab shell). Fullscreen
         param-driven pages opt out via `definePageMeta({ keepalive: false })`. -->
    <NuxtPage :keepalive="true" />
  </NuxtLayout>
</template>

<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useWorkspaceStore } from '~/stores/workspace'
import { useTasksStore } from '~/stores/tasks'
import { useWorkflowsStore } from '~/stores/workflows'
import { useUpdateStore } from '~/stores/update'
import { useQuotaStore } from '~/stores/quota'

useAppearance()
// Load the persisted session launch defaults so a new Session/Task picks up the
// user's saved provider/model/mode instead of the hardcoded fallbacks.
useSessionDefaults()
// Load the persisted auto-update toggle before the store schedules checks.
useUpdateSettings()
// Load the persisted quota-warning toggle/threshold before the watcher polls.
useQuotaWarningSettings()
// Seed git + composer slices from localStorage at boot so they're present in the
// first snapshot the settings-sync bridge pushes to ~/.awog/settings.json.
useGitSettings()
useComposerSettings()
// Settings-sync bridges the localStorage FOUC cache ↔ ~/.awog/settings.json
// (durable source of truth, written by the sidecar). See ADR 0045.
const settingsSync = useSettingsSync()

// Global hydration: every page (including /mcp-servers, /skills) needs the
// active Anthropic account in the store, not just /settings and /sessions.
const settings = useSettingsStore()
const workspace = useWorkspaceStore()
// Tasks run in the background and survive navigation, so their store hydrates +
// subscribes at app lifetime (not per-page). HeaderTabBar / edit pages read tasks too.
const tasks = useTasksStore()
const workflows = useWorkflowsStore()
const update = useUpdateStore()
const quota = useQuotaStore()

let unsubscribeFs: (() => void) | null = null
let unsubscribeTasks: (() => void) | null = null
let unsubscribeUpdate: (() => void) | null = null
let unsubscribeQuota: (() => void) | null = null

onMounted(() => {
  settings.hydrateFromSidecar().catch(() => {
    // Silent: hydration logs its own warning if sidecar is offline.
  })
  // Reconcile against ~/.awog/settings.json — file wins; seed it on first run.
  settingsSync.hydrate().catch(() => {})
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

  // Quota watcher: poll plan usage and warn / auto-abort when over threshold.
  unsubscribeQuota = quota.subscribe()
})

onBeforeUnmount(() => {
  if (unsubscribeFs) unsubscribeFs()
  if (unsubscribeTasks) unsubscribeTasks()
  if (unsubscribeUpdate) unsubscribeUpdate()
  if (unsubscribeQuota) unsubscribeQuota()
})
</script>
