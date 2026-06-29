<template>
  <div>
    <SettingsPaneHeader :title="t('settings.about.heading')" />

    <!-- App identity + version -->
    <SettingsField :name="t('settings.about.appName')" :desc="versionLine">
      <button class="btn sm" :disabled="!available || checking" @click="onCheckNow">
        <Icon name="refresh" />
        {{ checking ? t('settings.about.checking') : t('settings.about.checkNow') }}
      </button>
    </SettingsField>

    <!-- Repository -->
    <SettingsField :name="t('settings.about.repo.name')" :desc="t('settings.about.repo.desc')">
      <button class="btn sm" @click="onOpenRepo">{{ t('settings.about.repo.open') }}</button>
    </SettingsField>

    <!-- Onboarding — re-run the setup wizard / replay the interface tour. Closes
         this modal first so the wizard + spotlight render over the shell. -->
    <SettingsField :name="t('onboarding.settings.name')" :desc="t('onboarding.settings.desc')">
      <div class="keyrow">
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
      <span style="color: var(--textDim); font-size: 0.8846rem">{{ lastCheckedLabel }}</span>
    </SettingsField>

    <!-- Transient check status -->
    <div v-if="statusLine" class="fd" :style="statusStyle">{{ statusLine }}</div>

    <div class="fd" style="margin-top: 8px">
      {{ t('settings.about.tagline') }} · {{ t('settings.about.tagline2') }}
    </div>

    <!-- Platform manual-install note -->
    <div v-if="needsManualInstall" class="fd" style="margin-top: 8px; color: var(--amber)">
      {{ t('settings.about.manualInstallNote') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSettingsStore } from '~/stores/settings'
import { useSidecar } from '~/composables/useSidecar'
import type { UnlistenFn, UpdateEvent } from '~/composables/useSidecar'

// About panel — ports setSecHtml('about') and wires it to the real update bridge.
// App identity + version come from the sidecar (getAppInfo on mount); auto-update
// preference lives in the settings store; "Check now" drives a one-shot background
// check whose outcome is surfaced as a transient inline status line.
const { t } = useI18n()
const store = useSettingsStore()
const sidecar = useSidecar()
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

// --- version + platform info (sidecar truth; static fallback in browser-dev) ---
const version = ref('')
// `null` until known; only the explicit `false` from the sidecar shows the note.
const canAutoInstall = ref<boolean | null>(null)
const needsManualInstall = computed(() => canAutoInstall.value === false)

const versionLine = computed(() =>
  version.value ? `v${version.value}` : t('settings.about.versionFallback'),
)

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

// --- "Check now" flow ---
const checking = ref(false)
const statusLine = ref('')
type StatusKind = 'info' | 'error'
const statusKind = ref<StatusKind>('info')
const statusStyle = computed(() => ({
  marginTop: '8px',
  color: statusKind.value === 'error' ? 'var(--amber)' : 'var(--accent)',
}))

let unlisten: UnlistenFn | null = null

const handleUpdateEvent = (event: UpdateEvent) => {
  if (event.type === 'checking') return
  // Any resolved outcome ends the pending check and records the timestamp.
  checking.value = false
  store.updateAutoUpdate({ lastCheckedAt: new Date().toISOString() })
  if (event.type === 'available') {
    statusKind.value = 'info'
    statusLine.value = t('settings.about.status.available', { version: event.version })
  } else if (event.type === 'not-available') {
    statusKind.value = 'info'
    statusLine.value = t('settings.about.status.latest')
  } else if (event.type === 'error') {
    statusKind.value = 'error'
    statusLine.value = event.message || t('settings.about.status.error')
  }
}

const onCheckNow = async () => {
  if (!available || checking.value) return
  checking.value = true
  statusLine.value = ''
  try {
    if (!unlisten) unlisten = await sidecar.onUpdateEvent(handleUpdateEvent)
    await sidecar.checkForUpdates()
  } catch {
    checking.value = false
    statusKind.value = 'error'
    statusLine.value = t('settings.about.status.error')
  }
}

// Open the repo in the OS browser (Electron); fall back to window.open in
// browser-dev where the sidecar bridge isn't available.
const onOpenRepo = () => {
  sidecar.openExternal(REPO_URL).catch(() => {
    if (typeof window !== 'undefined') window.open(REPO_URL, '_blank', 'noopener,noreferrer')
  })
}

onMounted(async () => {
  if (!available) return
  try {
    const info = await sidecar.getAppInfo()
    version.value = info.version
    canAutoInstall.value = info.canAutoInstall
  } catch {
    // Leave the static fallback in place when app info can't be read.
  }
})

onUnmounted(() => {
  unlisten?.()
  unlisten = null
})
</script>
