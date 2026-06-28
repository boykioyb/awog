<template>
  <div v-if="!hidden" class="donut-wrap" :title="account.display">
    <svg class="donut" viewBox="0 0 36 36" aria-hidden="true">
      <circle class="donut-bg" cx="18" cy="18" r="15.9155" />
      <circle
        class="donut-fg"
        cx="18"
        cy="18"
        r="15.9155"
        :style="{ stroke: ringColor, strokeDasharray: `${ringPct} 100` }"
        transform="rotate(-90 18 18)"
      />
    </svg>
    <span class="donut-pct mono" :style="{ color: ringColor }">{{ ringPct }}%</span>

    <!-- Hover tooltip: account label + every reported limit row -->
    <div class="donut-pop">
      <div class="donut-pop-hd">{{ account.label }} · {{ account.provider }}</div>
      <div v-if="loading && !rows.length" class="donut-pop-hint">
        {{ t('statusbar.usage.loading') }}
      </div>
      <div v-else-if="!rows.length" class="donut-pop-hint">{{ t('statusbar.usage.none') }}</div>
      <div v-for="r in rows" :key="r.type" class="donut-row">
        <span class="donut-rlbl">{{ r.label }}</span>
        <span class="donut-rbar"><i :style="{ width: `${r.pct}%`, background: r.color }" /></span>
        <span class="donut-rpct mono" :style="{ color: r.color }">{{ r.pct }}%</span>
        <span class="donut-rreset mono">{{ r.reset }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One provider account's plan usage as a compact donut, sized for the status bar.
// The ring shows the 5-hour limit utilization (the limit users watch most); the
// hover tooltip expands to every reported limit (weekly / opus / sonnet…). Mirrors
// ActivityRateLimit's data path (useAccountUsage → account.usage) and its severity
// palette. Self-hides once settled with no usage surface (API-key accounts).
//
// NOTE: classes are prefixed `donut-`, not `ring-` — a bare `.ring` class collides
// with Tailwind's `ring` utility (a blue box-shadow), which framed each donut.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { AccountOption } from '~/composables/useAccounts'
import { useAccountUsage } from '~/composables/useAccountUsage'

const props = defineProps<{ account: AccountOption }>()
const { t } = useI18n()

const { entries, loading, error, refresh } = useAccountUsage(() => ({
  provider: props.account.provider.toLowerCase(),
  accountId: props.account.id,
}))

function rlColor(u: number): string {
  if (u >= 1) return 'var(--danger)'
  if (u >= 0.9) return 'var(--amber)'
  return 'var(--accent)'
}
function formatResetsIn(ms?: number): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return t('activity.rateLimit.now')
  const mins = Math.floor(diff / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${mins % 60}m`
}

// The ring tracks the 5-hour limit; fall back to the worst-utilized entry if the
// account reports no five_hour bucket so the ring still means something.
const fiveHour = computed(
  () =>
    entries.value.find((e) => e.rateLimitType === 'five_hour') ??
    [...entries.value].sort((a, b) => b.utilization - a.utilization)[0],
)
const ringPct = computed(() =>
  Math.round(Math.min(1, Math.max(0, fiveHour.value?.utilization ?? 0)) * 100),
)
const ringColor = computed(() => rlColor(fiveHour.value?.utilization ?? 0))

const rows = computed(() =>
  entries.value.map((e) => {
    const u = Math.min(1, Math.max(0, e.utilization))
    return {
      type: e.rateLimitType,
      label: t(`activity.rateLimit.type.${e.rateLimitType}`),
      pct: Math.round(u * 100),
      color: rlColor(e.utilization),
      reset: formatResetsIn(e.resetsAt),
    }
  }),
)

// Hide once settled with no data (API-key accounts / providers without a usage
// surface) — only accounts that actually report a limit show a ring.
const hidden = computed(() => !loading.value && !error.value && entries.value.length === 0)

// Refresh on mount + whenever the window regains focus (sidecar caches 60s, so a
// focus refresh is cheap and keeps the glanceable ring fresh).
onMounted(() => {
  void refresh()
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
function onFocus() {
  void refresh()
}
</script>

<style scoped>
.donut-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 4px;
  border-radius: 6px;
  cursor: default;
}
.donut-wrap:hover {
  background: var(--bgHover);
}
.donut {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.donut-bg {
  fill: none;
  stroke: var(--bgActive);
  stroke-width: 4;
}
.donut-fg {
  fill: none;
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dasharray 0.3s ease;
}
.donut-pct {
  font-size: 12px;
  line-height: 1;
}

/* Tooltip — hidden until hover; opens upward, anchored to the donut. Left-anchored
   since the donuts sit at the left edge of the bar (opens rightward, no off-screen). */
.donut-pop {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 95;
  display: none;
  width: 240px;
  flex-direction: column;
  gap: 7px;
  padding: 11px 12px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 11px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5);
}
.donut-wrap:hover .donut-pop {
  display: flex;
}
.donut-pop-hd {
  font-size: 0.9231rem;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.donut-pop-hint {
  font-size: 0.9231rem;
  color: var(--textFaint);
}
.donut-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.donut-rlbl {
  flex: 0 0 84px;
  font-size: 0.8846rem;
  color: var(--textMuted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.donut-rbar {
  flex: 1 1 auto;
  height: 5px;
  border-radius: 99px;
  background: var(--bgInput);
  overflow: hidden;
}
.donut-rbar i {
  display: block;
  height: 100%;
  border-radius: 99px;
}
.donut-rpct {
  flex: 0 0 30px;
  text-align: right;
  font-size: 12px;
}
.donut-rreset {
  flex: 0 0 22px;
  text-align: right;
  font-size: 11px;
  color: var(--textFaint);
}
@media (prefers-reduced-motion: reduce) {
  .donut-fg {
    transition: none;
  }
}
</style>
