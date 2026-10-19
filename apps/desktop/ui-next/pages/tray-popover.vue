<template>
  <!-- Ghim kín cửa sổ (fixed inset-0) để popover không bao giờ cuộn cả thân —
       chỉ vùng giữa cuộn. -->
  <div class="fixed inset-0 flex flex-col overflow-hidden bg-background text-base text-foreground">
    <header class="flex shrink-0 items-center gap-2.5 border-b px-3.5 py-3">
      <span class="grid size-7 shrink-0 place-items-center rounded-md bg-selected text-primary">
        <Icon name="home" />
      </span>
      <div class="min-w-0">
        <div class="font-semibold">AWOG</div>
        <div class="text-sm text-muted-foreground tabular-nums">
          {{ t('tray.todayUsage', { cost: costLabel, tokens: tokenLabel }) }}
        </div>
      </div>
    </header>

    <!-- min-h-0: cuộn vùng này thay vì để popover phình ra. -->
    <div class="flex min-h-0 flex-auto flex-col gap-3 overflow-y-auto px-3 py-2.5">
      <!-- Provider limits — compact: one line per limit, grouped per account -->
      <section class="flex flex-col gap-1.5">
        <div class="text-xs font-medium text-muted-foreground">{{ t('tray.section.limits') }}</div>
        <div v-if="rlGroups.length" :key="refreshNonce" class="flex flex-col gap-2.5">
          <div v-for="g in rlGroups" :key="g.id" class="flex flex-col gap-1">
            <div class="truncate text-sm font-semibold">{{ g.label }}</div>
            <div v-for="row in g.rows" :key="row.type" class="flex items-center gap-2">
              <span class="w-23 shrink-0 truncate text-sm text-muted-foreground">
                {{ row.typeLabel }}
              </span>
              <span class="h-1.5 flex-auto overflow-hidden rounded-full bg-muted">
                <i
                  class="block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
                  :class="row.bar"
                  :style="{ width: row.pct + '%' }"
                />
              </span>
              <span class="w-8.5 shrink-0 text-right text-sm tabular-nums" :class="row.text">
                {{ row.pct }}%
              </span>
              <span class="w-6.5 shrink-0 text-right text-xs text-faint tabular-nums">
                {{ row.reset }}
              </span>
            </div>
          </div>
        </div>
        <div v-else class="px-0.5 pt-0.5 pb-1 text-sm text-faint">
          {{ rlLoading ? t('tray.loading') : t('tray.empty.limits') }}
        </div>
      </section>

      <!-- Running — tasks (with %) + streaming sessions -->
      <section v-if="running.length" class="flex flex-col gap-1.5">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('tray.section.running') }} · {{ running.length }}
        </div>
        <Button
          v-for="r in running"
          :key="r.key"
          variant="ghost"
          class="h-auto w-full justify-start gap-2 px-2.5 py-1.5 text-left text-base font-normal"
          @click="go(r.cmd)"
        >
          <span
            class="size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
            :class="r.dot"
          />
          <span class="min-w-0 flex-1 truncate font-medium">{{ r.title }}</span>
          <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{ r.meta }}</span>
        </Button>
      </section>

      <!-- Needs action — awaiting sessions + tasks -->
      <section v-if="attention.length" class="flex flex-col gap-1.5">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('tray.section.attention') }} · {{ attention.length }}
        </div>
        <Button
          v-for="a in attention"
          :key="a.key"
          variant="ghost"
          class="h-auto w-full justify-start gap-2 px-2.5 py-1.5 text-left text-base font-normal"
          @click="go(a.cmd)"
        >
          <span class="size-2 shrink-0 rounded-full" :class="a.dot" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ a.title }}</span>
          <span class="shrink-0 text-sm text-warning">{{ a.meta }}</span>
        </Button>
      </section>

      <!-- Recent sessions (excludes the active ones surfaced above) -->
      <section class="flex flex-col gap-1.5">
        <div class="text-xs font-medium text-muted-foreground">{{ t('tray.section.recent') }}</div>
        <Button
          v-for="s in recent"
          :key="s.id"
          variant="ghost"
          class="h-auto w-full justify-start gap-2 px-2.5 py-1.5 text-left text-base font-normal"
          @click="go({ kind: 'session', engineId: s.engineId })"
        >
          <span class="size-2 shrink-0 rounded-full" :class="s.dot" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ s.title }}</span>
          <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{ s.when }}</span>
        </Button>
        <div v-if="!recent.length" class="px-0.5 pt-0.5 pb-1 text-sm text-faint">
          {{ t('tray.empty.recent') }}
        </div>
      </section>
    </div>

    <footer class="shrink-0 border-t px-3 py-2">
      <Button
        variant="outline"
        class="w-full border-selected-border bg-selected text-primary"
        @click="go({ kind: 'activity' })"
      >
        <Icon name="act" />
        {{ t('tray.openActivity') }}
      </Button>
    </footer>
  </div>
</template>

<script setup lang="ts">
// Styled tray popover (docs/features/system-tray-status.md). Frameless window
// anchored under the tray icon (electron/src/popover.ts) — native menus can't do
// bars/colours, so the rich view is this Nuxt route. Compact, glanceable:
// today usage (header) + provider limits (slim inline bars) + running + needs
// action + recent sessions.
//
// Separate renderer from the main window → no live engine events; it loads
// snapshots on mount and refreshes on window focus (each open). Item clicks go to
// main via window.awog.sendTrayCommand → main shows the app + routes there.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import { useSidecar } from '~/composables/useSidecar'
import { useAccounts } from '~/composables/useAccounts'
import type { SessionStatus } from '~/composables/useSessionsData'
import { formatCost, formatTokens } from '~/composables/useActivity'
import type { UsageEntry } from '~/composables/useAccountUsage'
import type { AwogTrayCommand } from '~/types/awog-bridge'

definePageMeta({ layout: false })

const { t } = useI18n()
const sessions = useSessionsStore()
const tasks = useTasksStore()
const sc = useSidecar()
const { accounts } = useAccounts()
// Chấm trạng thái phiên — class màu ngữ nghĩa (cùng ý nghĩa với STATUS_COLOR ở
// useSessionsData, nhưng ở dạng utility thay cho var màu inline).
const STATUS_DOT: Record<SessionStatus, string> = {
  idle: 'bg-faint',
  streaming: 'bg-primary',
  awaiting: 'bg-warning',
  done: 'bg-success',
  error: 'bg-destructive',
}
// Thanh hạn mức: đầy → đỏ, ≥90% → vàng, còn lại → màu brand.
const LIMIT_TONE = {
  full: { bar: 'bg-destructive', text: 'text-destructive' },
  near: { bar: 'bg-warning', text: 'text-warning' },
  ok: { bar: 'bg-primary', text: 'text-primary' },
} as const

const today = ref<{ tokens: number; cost: number }>({ tokens: 0, cost: 0 })
const rateLimitsRaw = ref<{ id: string; label: string; entries: UsageEntry[] }[]>([])
const rlLoading = ref(false)
const refreshNonce = ref(0)
// Sessions with a turn in flight RIGHT NOW, from the sidecar (sessions.activeTurns).
// The `streaming` status is live-only in the main window and never persisted, so a
// hydrated snapshot can't tell us what's running — this RPC (backed by the in-flight
// aborter registry) is the source of truth and is independent of our stale list.
const runningSessions = ref<{ engineId: string; title: string }[]>([])

const tokenLabel = computed(() => formatTokens(today.value.tokens))
const costLabel = computed(() => formatCost(today.value.cost))

// ── Provider limits (compact) ──
const rlGroups = computed(() =>
  rateLimitsRaw.value.map((acc) => ({
    id: acc.id,
    label: acc.label,
    rows: acc.entries.map((e) => {
      const u = Math.min(1, Math.max(0, e.utilization))
      const tone = LIMIT_TONE[u >= 1 ? 'full' : u >= 0.9 ? 'near' : 'ok']
      return {
        type: e.rateLimitType,
        typeLabel: t(`activity.rateLimit.type.${e.rateLimitType}`),
        pct: Math.round(u * 100),
        bar: tone.bar,
        text: tone.text,
        reset: formatResetsIn(e.resetsAt),
      }
    }),
  })),
)

type Row = { key: string; title: string; meta: string; dot: string; cmd: AwogTrayCommand }

const running = computed<Row[]>(() => {
  const out: Row[] = []
  for (const task of tasks.runningTasks)
    out.push({
      key: `t-${task.id}`,
      title: task.title,
      meta: `${tasks.progressOf(task).pct}%`,
      dot: STATUS_DOT.streaming,
      cmd: { kind: 'task', id: task.id },
    })
  for (const s of runningSessions.value)
    out.push({
      key: `s-${s.engineId}`,
      title: s.title || t('tray.untitledSession'),
      meta: t('tray.streaming'),
      dot: STATUS_DOT.streaming,
      cmd: { kind: 'session', engineId: s.engineId },
    })
  return out
})

const attention = computed<Row[]>(() => {
  const out: Row[] = []
  for (const s of sessions.sessions)
    if (s.status === 'awaiting' && s.engineId)
      out.push({
        key: `s-${s.id}`,
        title: s.title,
        meta: t('tray.awaitingReply'),
        dot: STATUS_DOT.awaiting,
        cmd: { kind: 'session', engineId: s.engineId },
      })
  for (const task of tasks.awaitingTasks)
    out.push({
      key: `t-${task.id}`,
      title: task.title,
      meta: t('tray.awaitingApproval'),
      dot: STATUS_DOT.awaiting,
      cmd: { kind: 'task', id: task.id },
    })
  return out
})

// Recent: newest first (the list is already recency-ordered), excluding the
// streaming/awaiting sessions already surfaced in Running / Needs action.
const recent = computed(() => {
  const runningIds = new Set(runningSessions.value.map((r) => r.engineId))
  const out: { id: number; engineId: string; title: string; when: string; dot: string }[] = []
  for (const s of sessions.sessions) {
    if (s.status === 'streaming' || s.status === 'awaiting') continue
    // Need the stable engine id to route the click to the main window's store.
    if (!s.engineId) continue
    // Skip sessions already surfaced in Running (their in-flight state comes from the
    // sidecar, not the — possibly stale — resting status on this row).
    if (runningIds.has(s.engineId)) continue
    out.push({
      id: s.id,
      engineId: s.engineId,
      title: s.title,
      when: s.when,
      dot: STATUS_DOT[s.status],
    })
    if (out.length >= 5) break
  }
  return out
})

async function fetchActiveTurns(): Promise<void> {
  if (!sc.available) return
  try {
    const res = await sc.request<{ sessions: { engineId: string; title: string }[] }>(
      'sessions.activeTurns',
    )
    runningSessions.value = Array.isArray(res.sessions) ? res.sessions : []
  } catch {
    // keep last value
  }
}

async function fetchUsage(): Promise<void> {
  if (!sc.available) return
  try {
    const res = await sc.request<{ totals?: { totalTokens?: number; costUsd?: number } }>(
      'activity.summary',
      { range: '1d' },
    )
    today.value = { tokens: res.totals?.totalTokens ?? 0, cost: res.totals?.costUsd ?? 0 }
  } catch {
    // keep last value
  }
}

async function fetchRateLimits(): Promise<void> {
  if (!sc.available) return
  const rl = accounts.value.filter((a) => a.provider === 'Anthropic' || a.provider === 'OpenAI')
  if (!rl.length) return
  rlLoading.value = true
  try {
    const results = await Promise.all(
      rl.map(async (a) => {
        try {
          const res = await sc.request<{ usage?: UsageEntry[] }>('account.usage', {
            provider: a.provider.toLowerCase(),
            accountId: a.id,
          })
          return { id: a.id, label: a.label, entries: Array.isArray(res.usage) ? res.usage : [] }
        } catch {
          return { id: a.id, label: a.label, entries: [] as UsageEntry[] }
        }
      }),
    )
    rateLimitsRaw.value = results.filter((r) => r.entries.length > 0)
  } finally {
    rlLoading.value = false
  }
}

function refreshAll(): void {
  refreshNonce.value++
  void fetchUsage()
  void fetchRateLimits()
  void fetchActiveTurns()
  void sessions.hydrate?.()
  void tasks.loadTasks()
}

function go(cmd: AwogTrayCommand): void {
  window.awog?.sendTrayCommand?.(cmd)
}

// Accounts load asynchronously (accounts.list round-trip). Until the real list
// resolves it is EMPTY, so the first fetch on mount returns nothing ("No provider
// limits to show"). Re-fetch once the real account list arrives — this is the
// reactive trigger the main window's home tile gets for free via its keyed v-for
// of <ActivityRateLimit>.
watch(accounts, () => void fetchRateLimits())

onMounted(() => {
  refreshAll()
  // Each time the popover is shown it regains focus → refresh for a live glance.
  window.addEventListener('focus', refreshAll)
})
onBeforeUnmount(() => window.removeEventListener('focus', refreshAll))

// Compact "resets in" label (mirror of ActivityRateLimit's helper).
function formatResetsIn(ms: number | undefined): string {
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
</script>
