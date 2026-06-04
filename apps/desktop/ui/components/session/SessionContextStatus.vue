<template>
  <div class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[1em] transition"
      :style="{
        color: t.textDim,
        background: open ? t.bgSubtle : 'transparent',
      }"
      :title="`${modelLabel} · context ${formatTokenCount(used)} / ${formatTokenCount(limit)} (${percent}%)`"
      @click="open = !open"
    >
      <span
        class="inline-block rounded-full flex-shrink-0"
        :style="{
          width: '9px',
          height: '9px',
          background: `conic-gradient(${usageColor} ${percent * 3.6}deg, ${t.border} 0)`,
        }"
      />
      <span :style="{ color: usageColor }" class="font-mono">{{ percent }}%</span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 bottom-full mb-1.5 w-[400px] rounded-md shadow-xl text-[1em] z-30"
      :style="{
        background: t.bgPanel,
        border: `1px solid ${t.border}`,
      }"
    >
      <div class="px-3 py-2.5" :style="{ borderBottom: `1px solid ${t.border}` }">
        <div class="flex items-center justify-between mb-1.5">
          <button
            type="button"
            class="inline-flex items-center gap-1"
            :style="{ color: t.text }"
            @click="expanded = !expanded"
          >
            <span class="font-medium">Context window</span>
            <ChevronDown
              :size="11"
              :style="{
                color: t.textDim,
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 120ms ease',
              }"
            />
          </button>
          <span class="font-mono" :style="{ color: t.textDim }">
            {{ formatTokenCount(used) }} / {{ formatTokenCount(limit) }}
            <span :style="{ color: t.textFaint }">({{ percent }}%)</span>
          </span>
        </div>

        <div
          class="relative h-1.5 rounded-full overflow-hidden"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <div
            v-for="seg in segments"
            :key="seg.label"
            class="absolute top-0 h-full"
            :style="{
              left: `${seg.startPct}%`,
              width: `${seg.widthPct}%`,
              background: seg.color,
            }"
            :title="`${seg.label}: ${formatTokenCount(seg.tokens)} (${seg.widthPct.toFixed(1)}%)`"
          />
        </div>

        <div v-if="expanded" class="mt-2.5 space-y-1">
          <div v-for="row in allRows" :key="row.label" class="flex items-center justify-between">
            <span class="inline-flex items-center gap-1.5">
              <span
                class="inline-block w-1.5 h-1.5 rounded-sm"
                :style="{ background: row.color }"
              />
              <span :style="{ color: t.text }">{{ row.label }}</span>
            </span>
            <span class="font-mono" :style="{ color: t.textDim }">
              {{ formatTokenCount(row.tokens) }}
              <span :style="{ color: t.textFaint }">· {{ row.pct.toFixed(1) }}%</span>
            </span>
          </div>
        </div>
      </div>

      <div class="px-3 py-2.5">
        <div class="flex items-center justify-between mb-2">
          <div class="inline-flex items-center gap-1.5">
            <span class="font-medium" :style="{ color: t.text }">Plan usage</span>
            <span
              v-if="profile?.subscriptionType"
              class="text-[12px] leading-none px-1.5 py-0.5 rounded-sm uppercase tracking-wider"
              :style="{
                background: t.bgSubtle,
                color: t.textDim,
                border: `1px solid ${t.border}`,
              }"
              :title="`Claude ${profile.subscriptionType} subscription`"
            >
              {{ profile.subscriptionType }}
            </span>
          </div>
          <button
            type="button"
            class="inline-flex items-center justify-center w-5 h-5 rounded transition"
            :style="{ color: t.textDim }"
            title="Refresh usage"
            :disabled="usageLoading"
            @click="refreshUsage(true)"
          >
            <RefreshCw :size="11" :class="{ 'animate-spin': usageLoading }" />
          </button>
        </div>

        <div v-if="usageError" class="text-[1em] mb-1.5" :style="{ color: t.danger ?? '#ef4444' }">
          {{ usageError }}
        </div>

        <div
          v-if="usage.length === 0 && !usageLoading && !usageError"
          class="text-[1em]"
          :style="{ color: t.textDim }"
        >
          Loading…
        </div>

        <div v-else class="space-y-2.5">
          <div
            v-for="entry in usage"
            :key="entry.rateLimitType"
            class="flex items-center gap-3 text-[1em]"
          >
            <span class="w-[130px] flex-shrink-0 truncate" :style="{ color: t.text }">
              {{ rateLimitLabel(entry.rateLimitType) }}
            </span>
            <div
              class="flex-1 relative h-1.5 rounded-full overflow-hidden"
              :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
            >
              <div
                class="absolute top-0 left-0 h-full rounded-full"
                :style="{
                  width: `${Math.min(100, Math.round(entry.utilization * 100))}%`,
                  background: utilizationColor(entry.utilization),
                }"
              />
            </div>
            <div
              class="flex items-baseline justify-end gap-1 font-mono text-[12px] flex-shrink-0 whitespace-nowrap w-[78px]"
            >
              <span :style="{ color: t.textDim }">{{ Math.round(entry.utilization * 100) }}%</span>
              <span v-if="entry.resetsAt" :style="{ color: t.textFaint }">
                / {{ formatResetsIn(entry.resetsAt) }}
              </span>
            </div>
          </div>
        </div>

        <div class="mt-2.5 text-[1em]" :style="{ color: t.textFaint }">
          Last turn:
          <span class="font-mono">
            {{ formatTokenCount(lastInput) }} in / {{ formatTokenCount(lastOutput) }} out
          </span>
        </div>
      </div>
    </div>

    <div v-if="open" class="fixed inset-0 z-20" @click="open = false" />
  </div>
</template>

<script setup lang="ts">
import { ChevronDown, RefreshCw } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { Session } from '~/types'
import { modelById } from '~/utils/models'
import { contextLimitFor, formatTokenCount } from '~/utils/context-window'

type RateLimitType = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage'

interface UsageEntry {
  rateLimitType: RateLimitType
  utilization: number
  resetsAt?: number
  status: 'allowed' | 'allowed_warning' | 'rejected'
}

interface ProfileShape {
  email?: string
  organizationName?: string
  subscriptionType?: string
  rateLimitTier?: string
}

const props = defineProps<{
  session: Session
}>()

const { t } = useTheme()
const open = ref(false)
const expanded = ref(false)

// Approx 4 chars ≈ 1 token. Coarse but fine for a UI hint.
const estimateTokens = (s: string | undefined): number => (s ? Math.ceil(s.length / 4) : 0)

const lastAgentWithUsage = computed(() => {
  const msgs = props.session.messages
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]
    if (m?.role === 'agent' && m.usage) return m
  }
  return null
})

const lastModel = computed(
  () => lastAgentWithUsage.value?.modelUsed ?? props.session.settings.modelId,
)

const modelLabel = computed(() => {
  const def = modelById(props.session.settings.modelId)
  return def?.label ?? props.session.settings.modelId
})

const lastInput = computed(() => lastAgentWithUsage.value?.usage?.inputTokens ?? 0)
const lastOutput = computed(() => lastAgentWithUsage.value?.usage?.outputTokens ?? 0)

const limit = computed(() => contextLimitFor(lastModel.value))

const settingsStore = useSettingsStore()

const systemPromptTokens = computed(() => estimateTokens(settingsStore.defaults?.systemPrompt))

const messagesTokens = computed(() =>
  props.session.messages
    .filter((m) => m.role !== 'system')
    .reduce((acc, m) => acc + estimateTokens(m.text), 0),
)

// Real total = last input_tokens (already includes history) + last output_tokens.
// When no agent turn yet, fall back to estimate of pending text only.
const used = computed(() => {
  const last = lastAgentWithUsage.value
  if (last?.usage) return last.usage.inputTokens + last.usage.outputTokens
  return systemPromptTokens.value + messagesTokens.value
})

const percent = computed(() => {
  if (limit.value <= 0) return 0
  return Math.min(100, Math.round((used.value / limit.value) * 100))
})

const usageColor = computed(() => {
  const p = percent.value
  if (p >= 90) return t.value.danger ?? '#ef4444'
  if (p >= 70) return t.value.warning ?? '#f59e0b'
  return t.value.success ?? '#22c55e'
})

// Breakdown is an estimate. Anthropic API doesn't return granular counts;
// we approximate to give the user a sense of what fills the window.
interface Segment {
  label: string
  tokens: number
  color: string
  startPct: number
  widthPct: number
  pct: number
}

const breakdown = computed(() => {
  const cap = Math.max(used.value, 1)
  const sys = Math.min(systemPromptTokens.value, cap)
  const msgs = Math.max(0, Math.min(messagesTokens.value, cap - sys))
  const accounted = sys + msgs
  const other = Math.max(0, used.value - accounted)
  return { sys, msgs, other }
})

const segments = computed<Segment[]>(() => {
  const b = breakdown.value
  const total = limit.value || 1
  const parts: { label: string; tokens: number; color: string }[] = [
    { label: 'System prompt', tokens: b.sys, color: '#60a5fa' },
    { label: 'Messages', tokens: b.msgs, color: '#a78bfa' },
    { label: 'Other (overhead)', tokens: b.other, color: '#f472b6' },
  ]
  let cursor = 0
  return parts.map((p) => {
    const widthPct = (p.tokens / total) * 100
    const seg: Segment = {
      label: p.label,
      tokens: p.tokens,
      color: p.color,
      startPct: cursor,
      widthPct,
      pct: widthPct,
    }
    cursor += widthPct
    return seg
  })
})

const allRows = computed(() => {
  const free = Math.max(0, limit.value - used.value)
  const total = limit.value || 1
  return [
    ...segments.value,
    {
      label: 'Free space',
      tokens: free,
      color: t.value.border ?? '#374151',
      pct: (free / total) * 100,
    },
  ]
})

// ── Plan usage (Anthropic /api/oauth/profile + /api/oauth/usage) ──────────
const sidecar = useSidecar()
const usage = ref<UsageEntry[]>([])
const profile = ref<ProfileShape | null>(null)
const usageLoading = ref(false)
const usageError = ref<string | null>(null)
const usageFetchedAt = ref(0)

// Usage must follow the account picked for THIS session (the account chip),
// not the global active one. Effective = explicit per-session override, else
// the provider's global active account.
const effectiveAccountId = computed<string | null>(
  () =>
    props.session.settings.accountId ??
    settingsStore.providers[props.session.settings.provider]?.activeAccountId ??
    null,
)
// Which account the loaded usage belongs to, so switching account forces a
// refetch even inside the 60s client window (else we'd show the old account's
// numbers). The sidecar cache is keyed per-account, so the refetch is cheap.
const usageAccountId = ref<string | null>(null)

interface UsageResponse {
  profile: ProfileShape | null
  usage: UsageEntry[]
  cachedAt: number
}

const refreshUsage = async (force = false) => {
  if (!sidecar.available) {
    usageError.value = 'Sidecar unavailable'
    return
  }
  if (usageLoading.value) return
  const accountId = effectiveAccountId.value ?? undefined
  const accountChanged = usageAccountId.value !== (accountId ?? null)
  // 60s client-side cache to mirror sidecar TTL; force or an account switch
  // bypasses it (the sidecar cache is per-account, so a switch is still cheap).
  const withinTtl = usageFetchedAt.value > 0 && Date.now() - usageFetchedAt.value < 60_000
  if (!force && !accountChanged && withinTtl) return

  usageLoading.value = true
  usageError.value = null
  try {
    const res = await sidecar.request<UsageResponse>('account.usage', { accountId, force })
    usage.value = res.usage ?? []
    profile.value = res.profile
    usageFetchedAt.value = res.cachedAt ?? Date.now()
    usageAccountId.value = accountId ?? null
  } catch (err) {
    usageError.value = err instanceof Error ? err.message : 'Failed to load usage'
  } finally {
    usageLoading.value = false
  }
}

// Fetch when the popover opens, and re-fetch if the selected account changes
// while it's open. Subsequent opens reuse cached data unless the account
// changed or the user clicks refresh.
watch([open, effectiveAccountId], ([isOpen]) => {
  if (isOpen) refreshUsage(false)
})

const RATE_LIMIT_LABELS: Record<RateLimitType, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly · all',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  overage: 'Overage',
}
const rateLimitLabel = (type: RateLimitType): string => RATE_LIMIT_LABELS[type] ?? type

const utilizationColor = (u: number): string => {
  if (u >= 1) return t.value.danger ?? '#ef4444'
  if (u >= 0.9) return t.value.warning ?? '#f59e0b'
  return t.value.accent ?? '#60a5fa'
}

const formatResetsIn = (resetsAt: number): string => {
  const diff = resetsAt - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
</script>
