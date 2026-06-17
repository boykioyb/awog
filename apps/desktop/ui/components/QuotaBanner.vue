<template>
  <div
    v-if="quota.bannerVisible"
    class="flex items-center gap-3 px-4 py-2 border-b"
    :style="{ background: barBg, borderColor: barBorder }"
  >
    <AlertTriangle :size="15" class="shrink-0" :style="{ color: accentColor }" />

    <div class="flex-1 min-w-0">
      <div class="text-[1em] truncate" :style="{ color: t.text }">{{ message }}</div>
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      <AppButton variant="ghost" size="sm" @click="goSettings">
        {{ tr('quota.banner.manage') }}
      </AppButton>
      <AppButton variant="ghost" size="sm" @click="quota.dismiss()">
        {{ tr('quota.banner.dismiss') }}
      </AppButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import { useQuotaStore } from '~/stores/quota'

const { t } = useTheme()
const { t: tr } = useI18n()
const quota = useQuotaStore()
const { openSettings } = useSettingsModal()

const pct = computed(() => (quota.worst ? Math.round(quota.worst.utilization * 100) : 0))

const limitLabel = computed(() => {
  const type = quota.worst?.rateLimitType
  if (!type) return ''
  return tr(`quota.limit.${type}`)
})

const formatResetsIn = (resetsAt: number): string => {
  const diff = resetsAt - Date.now()
  if (diff <= 0) return tr('quota.reset.now')
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

const message = computed(() => {
  // Kill-switch fired this episode → report the stop; otherwise a plain warning.
  if (quota.lastAbortedCount > 0) {
    return tr('quota.banner.aborted', { count: quota.lastAbortedCount, pct: pct.value })
  }
  const base = tr('quota.banner.warn', { pct: pct.value, label: limitLabel.value })
  const resetsAt = quota.worst?.resetsAt
  if (resetsAt) {
    return `${base} · ${tr('quota.banner.reset', { time: formatResetsIn(resetsAt) })}`
  }
  return base
})

// Over the cap → danger; warning band → amber.
const isOver = computed(() => (quota.worst?.utilization ?? 0) >= 1)
const accentColor = computed(() => (isOver.value ? t.value.danger : t.value.warning))
const barBg = computed(() => (isOver.value ? t.value.dangerBg : t.value.warningBg))
const barBorder = computed(() => (isOver.value ? t.value.dangerBorder : t.value.warningBorder))

const goSettings = () => {
  openSettings('sessions')
}
</script>
