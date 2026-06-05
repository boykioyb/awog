<template>
  <div
    v-if="update.bannerVisible"
    class="flex items-center gap-3 px-4 py-2 border-b"
    :style="{ background: barBg, borderColor: barBorder }"
  >
    <component :is="leadingIcon" :size="15" class="shrink-0" :style="{ color: accentColor }" />

    <div class="flex-1 min-w-0">
      <div class="text-[1em] truncate" :style="{ color: t.text }">{{ message }}</div>
      <div
        v-if="update.status === 'downloading'"
        class="mt-1 h-1 rounded-full overflow-hidden"
        :style="{ background: t.border }"
      >
        <div
          class="h-full rounded-full transition-all"
          :style="{ width: `${update.progressPercent}%`, background: t.accent }"
        />
      </div>
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      <button
        v-if="primaryAction"
        type="button"
        class="px-2.5 py-1 rounded text-[1em] font-medium transition flex items-center gap-1.5"
        :style="{ background: t.accent, color: t.onAccent }"
        @click="primaryAction.run"
      >
        <component :is="primaryAction.icon" :size="13" />
        {{ primaryAction.label }}
      </button>
      <button
        v-if="showDismiss"
        type="button"
        class="px-2.5 py-1 rounded text-[1em] transition"
        :style="{ color: t.textDim }"
        @click="update.dismiss()"
      >
        {{ dismissLabel }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Download, ExternalLink, RotateCw } from 'lucide-vue-next'
import type { Component } from 'vue'
import { useUpdateStore } from '~/stores/update'

type BannerAction = { label: string; icon: Component; run: () => void }

const { t } = useTheme()
const update = useUpdateStore()

const message = computed(() => {
  switch (update.status) {
    case 'available':
      return `AWOG ${update.newVersion} is available.`
    case 'downloading':
      return `Downloading update… ${update.progressPercent}%`
    case 'downloaded':
      return `AWOG ${update.newVersion} is ready — restart to install.`
    case 'error':
      return "Couldn't check for updates."
    default:
      return ''
  }
})

const primaryAction = computed<BannerAction | null>(() => {
  if (update.status === 'available') {
    return update.canAutoInstall
      ? { label: 'Download', icon: Download, run: () => update.download() }
      : { label: 'Open download page', icon: ExternalLink, run: () => update.openReleases() }
  }
  if (update.status === 'downloaded') {
    return { label: 'Restart now', icon: RotateCw, run: () => update.restart() }
  }
  if (update.status === 'error') {
    return { label: 'Retry', icon: RotateCw, run: () => update.checkNow() }
  }
  return null
})

const leadingIcon = computed<Component>(() => {
  if (update.status === 'error') return AlertTriangle
  if (update.status === 'downloaded') return CheckCircle2
  return Download
})

// No dismiss during an active download (no cancel — let it finish).
const showDismiss = computed(() => update.status !== 'downloading')
const dismissLabel = computed(() => (update.status === 'downloaded' ? 'Later' : 'Dismiss'))

const accentColor = computed(() => (update.status === 'error' ? t.value.danger : t.value.accent))
const barBg = computed(() => (update.status === 'error' ? t.value.dangerBg : t.value.infoBg))
const barBorder = computed(() =>
  update.status === 'error' ? t.value.dangerBorder : t.value.infoBorder,
)
</script>
