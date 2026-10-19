<template>
  <!-- Card usage = HoverCard (portal ra <body>, tự định vị — thanh status bar
       `overflow: hidden` không cắt được nữa). Hiện khi hover donut/card HOẶC khi
       đã ghim bằng click (usagePopoverOpenId — singleton app-wide, một card mở). -->
  <HoverCard
    v-if="!hidden"
    :open="cardVisible"
    :open-delay="0"
    :close-delay="HOVER_CLOSE_DELAY"
    @update:open="(v: boolean) => (hovered = v)"
  >
    <HoverCardTrigger as-child>
      <StatusChip
        ref="trigger"
        class="px-1"
        :active="isOpen"
        :title="account.display"
        @click="toggleOpen"
      >
        <svg class="size-4.5 shrink-0" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="fill-none stroke-muted" stroke-width="4" cx="18" cy="18" r="15.9155" />
          <circle
            class="fill-none transition-[stroke-dasharray] duration-300 motion-reduce:transition-none"
            :class="ringStroke"
            stroke-width="4"
            stroke-linecap="round"
            cx="18"
            cy="18"
            r="15.9155"
            :style="{ strokeDasharray: `${ringPct} 100` }"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span class="tabular-nums" :class="ringText">{{ ringPct }}%</span>
      </StatusChip>
    </HoverCardTrigger>
    <!-- `no-drag`: card neo ở thanh đáy nhưng cửa sổ thấp thì phần trên có thể lọt
         vào vùng kéo của header; app-region resolve ở tầng WINDOW nên thiếu no-drag
         là OS nuốt tương tác. -->
    <HoverCardContent
      side="top"
      align="start"
      :side-offset="8"
      class="flex max-h-105 w-60 flex-col gap-2 overflow-y-auto p-3 [-webkit-app-region:no-drag]"
      @pointer-down-outside="onPointerDownOutside"
    >
      <div class="truncate text-sm font-semibold text-foreground">
        {{ account.label }} · {{ account.provider }}
      </div>
      <div v-if="loading && !rows.length" class="text-sm text-faint">
        {{ t('statusbar.usage.loading') }}
      </div>
      <div v-else-if="!rows.length" class="text-sm text-faint">
        {{ t('statusbar.usage.none') }}
      </div>
      <div v-for="r in rows" :key="r.type" class="flex items-center gap-2">
        <span class="w-21 shrink-0 truncate text-sm text-muted-foreground">{{ r.label }}</span>
        <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <i class="block h-full rounded-full" :class="r.bar" :style="{ width: `${r.pct}%` }" />
        </span>
        <span class="tabular-nums w-7.5 shrink-0 text-right text-sm" :class="r.text">
          {{ r.pct }}%
        </span>
        <span class="tabular-nums w-5.5 shrink-0 text-right text-xs text-faint">{{ r.reset }}</span>
      </div>
    </HoverCardContent>
  </HoverCard>
</template>

<script setup lang="ts">
// One provider account's plan usage as a compact donut, sized for the status bar.
// The ring shows the 5-hour limit utilization (the limit users watch most); the
// hover tooltip expands to every reported limit (weekly / opus / sonnet…). Mirrors
// ActivityRateLimit's data path (useAccountUsage → account.usage) and its severity
// palette. Self-hides once settled with no usage surface (API-key accounts).
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import type { PointerDownOutsideEvent } from 'reka-ui'
import type { AccountOption } from '~/composables/useAccounts'
import { useAccountUsage } from '~/composables/useAccountUsage'
import { useEscToClose } from '~/composables/useEscToClose'
import { usagePopoverOpenId } from '~/composables/useUsagePopover'

const props = defineProps<{ account: AccountOption }>()
const { t } = useI18n()

// Trễ đóng khi rời donut — đủ để rê chuột qua khe 8px sang card mà card không tắt.
const HOVER_CLOSE_DELAY = 150

const trigger = useTemplateRef<{ $el: HTMLElement }>('trigger')
const hovered = ref(false)

// Card hiện khi pinned bằng click (usagePopoverOpenId — singleton app-wide, chỉ
// một card mở) HOẶC đang hover donut/card.
const isOpen = computed(() => usagePopoverOpenId.value === props.account.id)
const cardVisible = computed(() => isOpen.value || hovered.value)

// Click pins the card; mở thì refresh để số trong card luôn tươi.
function toggleOpen() {
  usagePopoverOpenId.value = isOpen.value ? null : props.account.id
  if (isOpen.value) void refresh()
}

function closePop() {
  usagePopoverOpenId.value = null
}

// Bấm ra ngoài card thì bỏ ghim (thay cho lớp nền bắt click cũ). Bấm vào chính
// donut thì để toggleOpen lo — bỏ ghim ở đây rồi click lại ghim là card nháy.
function onPointerDownOutside(e: PointerDownOutsideEvent) {
  const target = e.detail.originalEvent.target
  if (target instanceof Node && trigger.value?.$el.contains(target)) return
  closePop()
}

useEscToClose(() => isOpen.value, closePop)

const { entries, loading, error, refresh } = useAccountUsage(() => ({
  provider: props.account.provider.toLowerCase(),
  accountId: props.account.id,
}))

// Bậc nghiêm trọng → class màu ngữ nghĩa (đỏ khi chạm trần, vàng từ 90%).
type Severity = 'over' | 'near' | 'ok'
function severity(u: number): Severity {
  if (u >= 1) return 'over'
  if (u >= 0.9) return 'near'
  return 'ok'
}
const SEV_TEXT: Record<Severity, string> = {
  over: 'text-destructive',
  near: 'text-warning',
  ok: 'text-primary',
}
const SEV_STROKE: Record<Severity, string> = {
  over: 'stroke-destructive',
  near: 'stroke-warning',
  ok: 'stroke-primary',
}
const SEV_BG: Record<Severity, string> = {
  over: 'bg-destructive',
  near: 'bg-warning',
  ok: 'bg-primary',
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
const ringSeverity = computed(() => severity(fiveHour.value?.utilization ?? 0))
const ringStroke = computed(() => SEV_STROKE[ringSeverity.value])
const ringText = computed(() => SEV_TEXT[ringSeverity.value])

const rows = computed(() =>
  entries.value.map((e) => {
    const u = Math.min(1, Math.max(0, e.utilization))
    return {
      type: e.rateLimitType,
      label: t(`activity.rateLimit.type.${e.rateLimitType}`),
      pct: Math.round(u * 100),
      text: SEV_TEXT[severity(e.utilization)],
      bar: SEV_BG[severity(e.utilization)],
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
