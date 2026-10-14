<template>
  <div
    v-if="!hidden"
    ref="wrapEl"
    class="donut-wrap"
    :title="account.display"
    @click="toggleOpen"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
  >
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
    <span class="donut-pct tnum" :style="{ color: ringColor }">{{ ringPct }}%</span>

    <!-- Card usage: TELEPORT ra <body> — `.wbsbar`/`.statusbar` đều có
         `overflow: hidden` nên popover `position:absolute` mở lên trên bị
         cắt mất phần nằm ngoài thanh (đo: a11y thấy node nhưng không vẽ).
         Vị trí đo từ donut bằng usePopoverAnchor (prefer above). -->
    <Teleport to="body">
      <div v-if="isOpen" class="donut-backdrop" @click="closePop" />
      <div
        v-if="cardVisible"
        ref="popEl"
        class="donut-pop"
        :style="popStyle"
        :class="{ pin: isOpen }"
        @pointerenter="hovered = true"
        @pointerleave="hovered = false"
      >
        <div class="donut-pop-hd">{{ account.label }} · {{ account.provider }}</div>
        <div v-if="loading && !rows.length" class="donut-pop-hint">
          {{ t('statusbar.usage.loading') }}
        </div>
        <div v-else-if="!rows.length" class="donut-pop-hint">
          {{ t('statusbar.usage.none') }}
        </div>
        <div v-for="r in rows" :key="r.type" class="donut-row">
          <span class="donut-rlbl">{{ r.label }}</span>
          <span class="donut-rbar"><i :style="{ width: `${r.pct}%`, background: r.color }" /></span>
          <span class="donut-rpct tnum" :style="{ color: r.color }">{{ r.pct }}%</span>
          <span class="donut-rreset tnum">{{ r.reset }}</span>
        </div>
      </div>
    </Teleport>
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AccountOption } from '~/composables/useAccounts'
import { useAccountUsage } from '~/composables/useAccountUsage'
import { useEscToClose } from '~/composables/useEscToClose'
import { usagePopoverOpenId } from '~/composables/useUsagePopover'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'

const props = defineProps<{ account: AccountOption }>()
const { t } = useI18n()

const wrapEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const hovered = ref(false)

// Card hiện khi pinned bằng click (usagePopoverOpenId — singleton app-wide, chỉ
// một card mở) HOẶC đang hover donut/card. Card teleport ra body + đo vị trí
// từ donut (thanh status bar overflow:hidden clip mọi popover mở lên trên).
const isOpen = computed(() => usagePopoverOpenId.value === props.account.id)
const cardVisible = computed(() => isOpen.value || hovered.value)
const { style: popStyle } = usePopoverAnchor(wrapEl, popEl, cardVisible, {
  prefer: 'above',
  align: 'left',
  gap: 8,
  width: 240,
  minHeight: 0,
  maxHeight: 420,
})

// Click pins the card; mở thì refresh để số trong card luôn tươi.
function toggleOpen() {
  usagePopoverOpenId.value = isOpen.value ? null : props.account.id
  if (isOpen.value) void refresh()
}

function closePop() {
  usagePopoverOpenId.value = null
}

useEscToClose(() => isOpen.value, closePop)

const { entries, loading, error, refresh } = useAccountUsage(() => ({
  provider: props.account.provider.toLowerCase(),
  accountId: props.account.id,
}))

function rlColor(u: number): string {
  // Canonical shadcn status vars — the bridge aliases them to AWOG's
  // --danger/--amber/--accent, so the palette is unchanged.
  if (u >= 1) return 'var(--destructive)'
  if (u >= 0.9) return 'var(--warning)'
  return 'var(--primary)'
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
  border-radius: var(--r-xs);
  cursor: default;
}
.donut-wrap:hover {
  background: var(--accent-wash);
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
  line-height: 12px;
}

/* Card teleports to <body> and is positioned `fixed` by usePopoverAnchor's
   inline style — the bar's overflow:hidden would clip any absolute child.
   Visibility is the template's v-if (hover OR click-pin), not CSS. */
.donut-pop {
  position: fixed;
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 12px;
  background: var(--popover);
  /* --input (the stronger hairline) not --border: matches the .smenu popover
     border the rest of the app uses — AWOG keeps elevated surfaces on the
     stronger hairline, and the bridge canonical name for it is --input. */
  border: 1px solid var(--input);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  overflow-y: auto;
  /* app-region resolve ở tầng WINDOW: `.top` là vùng drag — card neo ở thanh
     đáy nên phần trên có thể lọt strip drag 52px nếu cửa sổ thấp; thiếu
     no-drag thì OS nuốt tương tác (trap app-shell.css:2418). */
  -webkit-app-region: no-drag;
}
.donut-backdrop {
  position: fixed;
  inset: 0;
  z-index: 94;
  -webkit-app-region: no-drag;
}
.donut-pop-hd {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.donut-pop-hint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.donut-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.donut-rlbl {
  flex: 0 0 84px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.donut-rbar {
  flex: 1 1 auto;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--muted);
  overflow: hidden;
}
.donut-rbar i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
}
.donut-rpct {
  flex: 0 0 30px;
  text-align: right;
  font-size: 12px;
  line-height: 18px;
}
.donut-rreset {
  flex: 0 0 22px;
  text-align: right;
  font-size: 11px;
  line-height: 18px;
  color: var(--textFaint);
}
@media (prefers-reduced-motion: reduce) {
  .donut-fg {
    transition: none;
  }
}
</style>
