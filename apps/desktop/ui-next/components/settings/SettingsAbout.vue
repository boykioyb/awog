<template>
  <div>
    <SettingsPaneHeader :title="t('settings.about.heading')" />

    <!-- App identity + version. When an update is actionable, the primary action
         (Download / Open download page / Restart) sits next to "Check now". -->
    <SettingsField :name="t('settings.about.appName')" :desc="versionLine">
      <div class="keyrow justify-end">
        <button
          v-if="action"
          class="btn sm pri"
          :disabled="update.actionBusy"
          @click="update.runPrimaryAction()"
        >
          <Icon :name="action.icon" :class="{ uaspin: update.actionBusy }" />
          {{ action.label }}
        </button>
        <button class="btn sm" :disabled="!available || checking" @click="onCheckNow">
          <Icon name="refresh" />
          {{ checking ? t('settings.about.checking') : t('settings.about.checkNow') }}
        </button>
      </div>
    </SettingsField>

    <!-- Repository -->
    <SettingsField :name="t('settings.about.repo.name')" :desc="t('settings.about.repo.desc')">
      <button class="btn sm" @click="onOpenRepo">{{ t('settings.about.repo.open') }}</button>
    </SettingsField>

    <!-- Onboarding — re-run the setup wizard / replay the interface tour. Closes
         this modal first so the wizard + spotlight render over the shell. -->
    <SettingsField :name="t('onboarding.settings.name')" :desc="t('onboarding.settings.desc')">
      <div class="keyrow justify-end">
        <button class="btn sm" @click="onRerunSetup">
          <Icon name="sparkles" />
          {{ t('onboarding.settings.rerunSetup') }}
        </button>
        <button class="btn sm" @click="onReplayTour">
          {{ t('onboarding.settings.replayTour') }}
        </button>
      </div>
    </SettingsField>

    <!-- Automatic update checks -->
    <SettingsField
      :name="t('settings.about.autoUpdate.name')"
      :desc="t('settings.about.autoUpdate.desc')"
    >
      <SettingsTog v-model="autoUpdateEnabled" />
    </SettingsField>

    <!-- Last checked -->
    <SettingsField
      :name="t('settings.about.lastChecked.name')"
      :desc="t('settings.about.lastChecked.desc')"
    >
      <span style="color: var(--textDim); font-size: var(--fs-sm)">{{ lastCheckedLabel }}</span>
    </SettingsField>

    <!-- Live status line (reflects the shared update store). -->
    <div v-if="statusLine" class="fd" :style="statusStyle">{{ statusLine }}</div>

    <div class="fd" style="margin-top: 8px">
      {{ t('settings.about.tagline') }} · {{ t('settings.about.tagline2') }}
    </div>

    <!-- Platform manual-install note (installed app on notify-only platforms). -->
    <div v-if="needsManualInstall" class="fd" style="margin-top: 8px; color: var(--amber)">
      {{ t('settings.about.manualInstallNote') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { useUpdateStore } from '~/stores/update'
import { useSidecar } from '~/composables/useSidecar'

// About panel — reads the shared update store (state machine + app info live
// there; the auto-update plugin owns the single app-lifetime subscription). The
// auto-update preference lives in the settings store. "Check now" drives a
// one-shot manual check; outcome surfaces via the store-derived status line.
const { t } = useI18n()
const store = useSettingsStore()
const update = useUpdateStore()
const sidecar = useSidecar()
const { action } = useUpdateAction()
const { closeSettings } = useSettingsModal()
const { reset: rerunSetup } = useOnboarding()
const { start: startTour } = useTour()

const REPO_URL = 'https://github.com/boykioyb/awog'

// Replay entry points — close the Settings modal first so the wizard / spotlight
// overlay isn't stacked over a modal whose backdrop hides the highlighted shell.
const onRerunSetup = () => {
  closeSettings()
  rerunSetup()
}
const onReplayTour = () => {
  closeSettings()
  startTour('intro')
}

const available = sidecar.available

const versionLine = computed(() =>
  update.currentVersion ? `v${update.currentVersion}` : t('settings.about.versionFallback'),
)

// Manual install note only matters in the installed app on notify-only platforms.
const needsManualInstall = computed(() => update.isPackaged && !update.canAutoInstall)

// --- auto-update preference (store proxy; never mutate state directly) ---
const autoUpdateEnabled = computed<boolean>({
  get: () => store.autoUpdate.enabled,
  set: (enabled) => store.updateAutoUpdate({ enabled }),
})

const lastCheckedLabel = computed(() => {
  const iso = store.autoUpdate.lastCheckedAt
  if (!iso) return t('settings.about.lastChecked.never')
  return new Date(iso).toLocaleString()
})

// --- "Check now" flow (delegates to the store) ---
const checking = computed(() => update.status === 'checking')

const onCheckNow = () => {
  if (!available || checking.value) return
  void update.checkNow()
}

// Status line derived from the shared store, so it stays in sync with the banner.
const statusLine = computed(() => {
  switch (update.status) {
    case 'available':
      return t('settings.about.status.available', { version: update.newVersion ?? '' })
    case 'downloading':
      return t('settings.about.status.downloading', { percent: update.progressPercent })
    case 'downloaded':
      return t('settings.about.status.downloaded')
    case 'not-available':
      return t('settings.about.status.latest')
    case 'error':
      return update.errorMessage || t('settings.about.status.error')
    default:
      // In dev / browser there's no real updater — make "Check now" explain itself.
      return available && !update.isPackaged ? t('settings.about.status.devOnly') : ''
  }
})
const statusStyle = computed(() => ({
  marginTop: '8px',
  color: update.status === 'error' ? 'var(--amber)' : 'var(--accent)',
}))

// Open the repo in the OS browser (Electron); fall back to window.open in
// browser-dev where the sidecar bridge isn't available.
const onOpenRepo = () => {
  sidecar.openExternal(REPO_URL).catch(() => {
    if (typeof window !== 'undefined') window.open(REPO_URL, '_blank', 'noopener,noreferrer')
  })
}
</script>

<style scoped>
/* Spinner for the in-flight update primary action (restart/open-releases don't
   flip the status synchronously). No rotate keyframe in the shared prototype.css. */
.uaspin {
  animation: uaspin 0.8s linear infinite;
}
@keyframes uaspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .uaspin {
    animation: none;
  }
}
</style>
