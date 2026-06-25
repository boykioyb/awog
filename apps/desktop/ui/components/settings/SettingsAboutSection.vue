<template>
  <div class="space-y-7">
    <div>
      <h2 class="text-lg font-semibold tracking-tight" :style="{ color: t.text }">About</h2>
      <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
        About AWOG and how it stays up to date
      </div>
    </div>

    <!-- App identity -->
    <div
      class="flex items-center gap-3.5 rounded-xl p-4"
      :style="{ background: cardBg, border: `1px solid ${t.border}` }"
    >
      <div
        class="flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}`, color: t.text }"
      >
        <svg viewBox="0 0 32 32" width="28" height="28" role="img" aria-label="AWOG">
          <rect x="4" y="13" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.4" />
          <rect x="7" y="9" width="18" height="14" rx="2.5" fill="currentColor" opacity="0.7" />
          <rect x="10" y="5" width="18" height="14" rx="2.5" fill="currentColor" />
          <rect x="13" y="9.4" width="10" height="1.4" rx="0.7" fill="#60a5fa" />
          <rect x="13" y="12.4" width="7" height="1.4" rx="0.7" fill="#60a5fa" opacity="0.65" />
          <circle cx="25.5" cy="7.5" r="1.6" fill="#fbbf24" />
        </svg>
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-[1em] font-semibold" :style="{ color: t.text }">AWOG</span>
          <span
            class="font-mono text-[12px] leading-none px-1.5 py-0.5 rounded-full"
            :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            v{{ update.currentVersion || '—' }}
          </span>
        </div>
        <div class="text-[1em]" :style="{ color: t.textDim }">
          Artifact Workflow Orchestrate Guild
        </div>
        <div class="text-[1em]" :style="{ color: t.textDim }">
          Local-first AI Team Operating System
        </div>
      </div>
    </div>

    <!-- Repository + updates -->
    <div
      class="rounded-xl px-4 [&>*:last-child]:border-b-0"
      :style="{ background: cardBg, border: `1px solid ${t.border}` }"
    >
      <SettingsField label="Repository" hint="Source code, issues, and releases on GitHub">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-[1em] font-mono transition hover:underline"
          :style="{ color: t.accent }"
          @click="openRepo"
        >
          <Github :size="13" />
          {{ REPO_LABEL }}
          <ExternalLink :size="12" />
        </button>
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
            class="px-3 py-1.5 rounded-lg text-[1em] transition flex items-center gap-1.5 disabled:opacity-50"
            :style="{ border: `1px solid ${t.border}`, color: t.text, background: t.bgSubtle }"
            :disabled="checking"
            @click="onCheckNow"
          >
            <RotateCw :size="13" :class="checking ? 'animate-spin' : ''" />
            Check now
          </button>
        </div>
      </SettingsField>
    </div>

    <div
      v-if="!update.canAutoInstall"
      class="text-[1em] rounded-lg px-3 py-2"
      :style="{ background: t.infoBg, color: t.textDim, border: `1px solid ${t.infoBorder}` }"
    >
      On this platform AWOG notifies you of new versions and opens the download page — installing
      the update is manual.
    </div>

    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="px-3 py-2 rounded-lg text-[1em] shadow"
        :style="toastStyle(toast.kind)"
      >
        {{ toast.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ExternalLink, Github, RotateCw } from 'lucide-vue-next'
import { useUpdateStore } from '~/stores/update'

// Source repository. Matches the GitHub provider the auto-updater pulls releases
// from (apps/desktop/electron/src/updater.ts) and `repository` in package.json.
const REPO_URL = 'https://github.com/boykioyb/awog'
const REPO_LABEL = 'github.com/boykioyb/awog'

const { t } = useTheme()
const { cardBg } = useSettingsSurface()
const update = useUpdateStore()
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

// Open the repo in the OS browser (Electron); fall back to window.open in
// browser-dev where the sidecar bridge isn't available.
const openRepo = () => {
  useSidecar()
    .openExternal(REPO_URL)
    .catch(() => {
      if (typeof window !== 'undefined') window.open(REPO_URL, '_blank', 'noopener,noreferrer')
    })
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
