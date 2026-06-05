<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Updates</h2>
      <div class="text-[1em]" :style="{ color: t.textDim }">
        How AWOG checks for and installs new versions
      </div>
    </div>

    <div class="space-y-4">
      <SettingsField label="Current version" hint="The version of AWOG you're running now">
        <div class="text-[1em] font-mono" :style="{ color: t.text }">
          {{ update.currentVersion || '—' }}
        </div>
      </SettingsField>

      <SettingsField
        label="Automatic update checks"
        hint="Check for new versions in the background (on launch, every few hours, and on window focus)"
      >
        <AppToggle :model-value="autoUpdate.enabled" @update:model-value="onToggle" />
      </SettingsField>

      <SettingsField label="Last checked" hint="When AWOG last looked for a new version">
        <div class="flex items-center gap-3">
          <span class="text-[1em]" :style="{ color: t.textDim }">{{ lastCheckedLabel }}</span>
          <button
            type="button"
            class="px-2.5 py-1 rounded text-[1em] transition flex items-center gap-1.5 disabled:opacity-50"
            :style="{ border: `1px solid ${t.border}`, color: t.text }"
            :disabled="checking"
            @click="onCheckNow"
          >
            <RotateCw :size="13" :class="checking ? 'animate-spin' : ''" />
            Check now
          </button>
        </div>
      </SettingsField>

      <SettingsField
        label="Diagnostics"
        hint="Open the app log file — updater activity, engine output, and errors"
      >
        <button
          type="button"
          class="px-2.5 py-1 rounded text-[1em] transition flex items-center gap-1.5"
          :style="{ border: `1px solid ${t.border}`, color: t.text }"
          @click="onOpenLogs"
        >
          <ScrollText :size="13" />
          Open logs
        </button>
      </SettingsField>

      <div
        v-if="!update.canAutoInstall"
        class="text-[1em] rounded px-3 py-2"
        :style="{ background: t.infoBg, color: t.textDim, border: `1px solid ${t.infoBorder}` }"
      >
        On this platform AWOG notifies you of new versions and opens the download page — installing
        the update is manual.
      </div>
    </div>

    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="px-3 py-2 rounded text-[1em] shadow"
        :style="toastStyle(toast.kind)"
      >
        {{ toast.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RotateCw, ScrollText } from 'lucide-vue-next'
import { useUpdateStore } from '~/stores/update'

const { t } = useTheme()
const update = useUpdateStore()
const sidecar = useSidecar()
const { autoUpdate, update: updateSettings } = useUpdateSettings()
const { toasts, pushToast, toastStyle } = useToasts()

const checking = computed(() => update.status === 'checking')

const lastCheckedLabel = computed(() => {
  const iso = autoUpdate.value.lastCheckedAt
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
})

const onToggle = (enabled: boolean) => {
  updateSettings({ enabled })
}

// A manual "Check now" surfaces its outcome as a toast (the up-to-date / error
// cases have no banner). An update being available is handled by UpdateBanner.
const manualPending = ref(false)

const onCheckNow = async () => {
  if (!update.isPackaged) {
    pushToast('Updates are only available in the installed app', 'info')
    return
  }
  manualPending.value = true
  await update.checkNow()
}

const onOpenLogs = async () => {
  try {
    await sidecar.openLogs()
  } catch {
    pushToast('Logs are only available in the installed app', 'info')
  }
}

watch(
  () => update.status,
  (status) => {
    if (status === 'checking' || !manualPending.value) return
    manualPending.value = false
    if (status === 'not-available') {
      pushToast("You're on the latest version", 'success')
    } else if (status === 'error') {
      pushToast(update.errorMessage || "Couldn't check for updates", 'error')
    }
  },
)
</script>
