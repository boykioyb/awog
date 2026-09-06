<template>
  <div class="tp">
    <header class="tp-hd">
      <span class="tp-logo"><Icon name="home" /></span>
      <div class="tp-hdtext">
        <div class="tp-title">AWOG</div>
        <div class="tp-sub">
          {{ t('tray.todayUsage', { cost: costLabel, tokens: tokenLabel }) }}
        </div>
      </div>
    </header>

    <div class="tp-scroll">
      <!-- Provider limits — compact: one line per limit, grouped per account -->
      <section class="tp-sec">
        <div class="tp-sech">{{ t('tray.section.limits') }}</div>
        <div v-if="rlGroups.length" :key="refreshNonce" class="tp-rl">
          <div v-for="g in rlGroups" :key="g.id" class="rl-acct">
            <div class="rl-acctname">{{ g.label }}</div>
            <div v-for="row in g.rows" :key="row.type" class="rl-row">
              <span class="rl-type">{{ row.typeLabel }}</span>
              <span class="rl-bar">
                <i :style="{ width: row.pct + '%', background: row.color }" />
              </span>
              <span class="rl-pct tnum" :style="{ color: row.color }">{{ row.pct }}%</span>
              <span class="rl-reset tnum">{{ row.reset }}</span>
            </div>
          </div>
        </div>
        <div v-else class="tp-empty">
          {{ rlLoading ? t('tray.loading') : t('tray.empty.limits') }}
        </div>
      </section>

      <!-- Running — tasks (with %) + streaming sessions -->
      <section v-if="running.length" class="tp-sec">
        <div class="tp-sech">{{ t('tray.section.running') }} · {{ running.length }}</div>
        <button v-for="r in running" :key="r.key" class="tp-row" @click="go(r.cmd)">
          <span class="tp-dot pulse" :style="{ background: r.color }" />
          <span class="tp-rtitle">{{ r.title }}</span>
          <span class="tp-rmeta tnum">{{ r.meta }}</span>
        </button>
      </section>

      <!-- Needs action — awaiting sessions + tasks -->
      <section v-if="attention.length" class="tp-sec">
        <div class="tp-sech">{{ t('tray.section.attention') }} · {{ attention.length }}</div>
        <button v-for="a in attention" :key="a.key" class="tp-row" @click="go(a.cmd)">
          <span class="tp-dot" :style="{ background: 'var(--amber)' }" />
          <span class="tp-rtitle">{{ a.title }}</span>
          <span class="tp-rmeta" :style="{ color: 'var(--amber)' }">{{ a.meta }}</span>
        </button>
      </section>

      <!-- Recent sessions (excludes the active ones surfaced above) -->
      <section class="tp-sec">
        <div class="tp-sech">{{ t('tray.section.recent') }}</div>
        <button
          v-for="s in recent"
          :key="s.id"
          class="tp-row"
          @click="go({ kind: 'session', engineId: s.engineId })"
        >
          <span class="tp-dot" :style="{ background: s.color }" />
          <span class="tp-rtitle">{{ s.title }}</span>
          <span class="tp-rmeta tnum">{{ s.when }}</span>
        </button>
        <div v-if="!recent.length" class="tp-empty">{{ t('tray.empty.recent') }}</div>
      </section>
    </div>

    <footer class="tp-foot">
      <button class="tp-fbtn" @click="go({ kind: 'activity' })">
        <Icon name="act" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('tray.openActivity') }}
      </button>
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
import { useSessionsData } from '~/composables/useSessionsData'
import { formatCost, formatTokens } from '~/composables/useActivity'
import type { UsageEntry } from '~/composables/useAccountUsage'
import type { AwogTrayCommand } from '~/types/awog-bridge'

definePageMeta({ layout: false })

const { t } = useI18n()
const sessions = useSessionsStore()
const tasks = useTasksStore()
const sc = useSidecar()
const { accounts } = useAccounts()
const { STATUS_COLOR } = useSessionsData()

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
      return {
        type: e.rateLimitType,
        typeLabel: t(`activity.rateLimit.type.${e.rateLimitType}`),
        pct: Math.round(u * 100),
        color: u >= 1 ? 'var(--danger)' : u >= 0.9 ? 'var(--amber)' : 'var(--accent)',
        reset: formatResetsIn(e.resetsAt),
      }
    }),
  })),
)

type Row = { key: string; title: string; meta: string; color: string; cmd: AwogTrayCommand }

const running = computed<Row[]>(() => {
  const out: Row[] = []
  for (const task of tasks.runningTasks)
    out.push({
      key: `t-${task.id}`,
      title: task.title,
      meta: `${tasks.progressOf(task).pct}%`,
      color: 'var(--accent)',
      cmd: { kind: 'task', id: task.id },
    })
  for (const s of runningSessions.value)
    out.push({
      key: `s-${s.engineId}`,
      title: s.title || t('tray.untitledSession'),
      meta: t('tray.streaming'),
      color: STATUS_COLOR.streaming,
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
        color: 'var(--amber)',
        cmd: { kind: 'session', engineId: s.engineId },
      })
  for (const task of tasks.awaitingTasks)
    out.push({
      key: `t-${task.id}`,
      title: task.title,
      meta: t('tray.awaitingApproval'),
      color: 'var(--amber)',
      cmd: { kind: 'task', id: task.id },
    })
  return out
})

// Recent: newest first (the list is already recency-ordered), excluding the
// streaming/awaiting sessions already surfaced in Running / Needs action.
const recent = computed(() => {
  const runningIds = new Set(runningSessions.value.map((r) => r.engineId))
  const out: { id: number; engineId: string; title: string; when: string; color: string }[] = []
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
      color: STATUS_COLOR[s.status],
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

<style scoped>
/* Pin to the whole window via fixed/inset so the popover never produces a body
   (overall) scroll — only the middle .tp-scroll scrolls. */
.tp {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
  line-height: 20px;
  overflow: hidden;
}
.tp-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.tp-logo {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-sm);
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}
.tp-logo :deep(svg) {
  width: var(--icon-md);
  height: var(--icon-md);
}
.tp-hdtext {
  min-width: 0;
}
.tp-title {
  font-weight: 650;
  line-height: 1.15;
}
.tp-sub {
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
.tp-scroll {
  flex: 1 1 auto;
  min-height: 0; /* critical: scroll this region instead of growing the popover */
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.tp-sec {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tp-sech {
  font-size: 11px;
  line-height: 17px;
  color: var(--textFaint);
}
.tp-empty {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
  padding: 2px 2px 4px;
}

/* ── Provider limits: slim one-line rows grouped per account ── */
.tp-rl {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rl-acct {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.rl-acctname {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rl-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rl-type {
  flex: 0 0 92px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textMuted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rl-bar {
  flex: 1 1 auto;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--bgInput);
  overflow: hidden;
}
.rl-bar i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  transition: width 0.2s;
}
.rl-pct {
  flex: 0 0 34px;
  text-align: right;
  font-size: 12px;
  line-height: 18px;
}
.rl-reset {
  flex: 0 0 26px;
  text-align: right;
  font-size: 11px;
  line-height: 17px;
  color: var(--textFaint);
}

/* ── Running / attention / recent rows ── */
.tp-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.tp-row:hover {
  background: var(--bgHover);
  border-color: var(--border);
}
.tp-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.tp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.tp-dot.pulse {
  animation: tppulse 1.4s ease-in-out infinite;
}
.tp-rtitle {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tp-rmeta {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}

/* ── Footer ── */
.tp-foot {
  flex: 0 0 auto;
  padding: 9px 12px;
  border-top: 1px solid var(--border);
}
.tp-fbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  padding: 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
  font-weight: 550;
  cursor: pointer;
  transition: background 0.12s;
}
.tp-fbtn:hover {
  background: var(--bgHover);
}
.tp-fbtn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@keyframes tppulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tp-dot.pulse {
    animation: none;
  }
  .rl-bar i {
    transition: none;
  }
}
</style>
