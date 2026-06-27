<template>
  <section class="page on" data-page="home">
    <div class="scroll">
      <div class="bento">
        <!-- Needs attention (sessions awaiting reply/permission + tasks awaiting approval) -->
        <div class="tile c8">
          <div class="th">
            <Icon name="clock" />
            <span class="tt">{{ t('home.attention.title') }}</span>
            <span class="ct">{{ t('home.attention.count', { n: attentionItems.length }) }}</span>
          </div>
          <div v-if="!attentionReady" class="hmHint" :style="hintStyle">{{ loadingLabel }}</div>
          <div v-else-if="!attentionItems.length" class="hmHint" :style="hintStyle">
            {{ t('home.attention.empty') }}
          </div>
          <div v-else class="await">
            <div v-for="item in attentionItems" :key="item.id" class="acard hot">
              <span class="aic"><Icon :name="attentionIcon(item.kind)" /></span>
              <div class="bd">
                <div class="t1">{{ item.title }}</div>
                <div class="t2">{{ item.sub }}</div>
              </div>
              <span class="act" @click="navigateTo(item.to)">{{ actionLabel(item.action) }}</span>
            </div>
          </div>
        </div>

        <!-- Running stat -->
        <div class="tile c4 stat">
          <div class="lbl">{{ t('home.running.label') }}</div>
          <div class="big" style="color: var(--accent)">{{ runningCount.total }}</div>
          <div class="sub">
            {{
              t('home.running.summary', {
                tasks: runningCount.tasks,
                sessions: runningCount.sessions,
                rate: formatTokens(usage.ratePerMin),
              })
            }}
          </div>
        </div>

        <!-- Running tasks -->
        <div class="tile c7">
          <div class="th">
            <Icon name="play" />
            <span class="tt">{{ t('home.running.title') }}</span>
            <span class="ct">
              <a @click="navigateTo('/tasks')">{{ t('home.openTasks') }}</a>
            </span>
          </div>
          <div v-if="!tasks.loaded" class="hmHint" :style="hintStyle">{{ loadingLabel }}</div>
          <div v-else-if="!runningTaskRows.length" class="hmHint" :style="hintStyle">
            {{ t('home.running.empty') }}
          </div>
          <div v-else class="run">
            <div v-for="row in runningTaskRows" :key="row.task.id" class="ritem">
              <div class="rh">
                <span class="pulse" />
                <span class="nm">{{ row.task.title }}</span>
                <span class="who">{{ row.progress.currentAgentId ?? '' }}</span>
              </div>
              <div class="ph">
                {{ t('home.running.node') }}
                <b>{{ row.progress.doneNodes }}/{{ row.progress.totalNodes }}</b>
                <template v-if="row.progress.currentSkill">
                  · "{{ row.progress.currentSkill }}"
                </template>
              </div>
              <div class="bar"><i :style="{ width: row.progress.pct + '%' }" /></div>
              <div class="mt">
                <span>{{ t('home.running.elapsed', { time: elapsed(row.task.createdAt) }) }}</span>
                <span>{{ row.progress.pct }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity sparkline -->
        <div class="tile c5">
          <div class="th">
            <Icon name="act" />
            <span class="tt">{{ t('home.activity.title') }}</span>
            <span class="ct">
              <a @click="openActivity()">{{ t('home.open') }}</a>
            </span>
          </div>
          <div v-if="!sparkline.length" class="hmHint" :style="hintStyle">
            {{ t('home.activity.empty') }}
          </div>
          <template v-else>
            <div class="spark">
              <i
                v-for="(bar, i) in sparkline"
                :key="i"
                :class="{ hi: bar.hi }"
                :style="{ height: bar.height + '%' }"
              />
            </div>
            <div class="usage">
              <span class="u1">
                {{ formatTokens(usage.today) }}
                <span style="font-size: 0.8462rem; color: var(--textDim); font-weight: 400">
                  {{ t('home.activity.today') }}
                </span>
              </span>
              <span class="u2">{{ deltaLabel }}</span>
            </div>
          </template>
        </div>

        <!-- Provider rate limits (real % quota from account.usage; empty accounts hide themselves) -->
        <div class="tile c12">
          <div class="th">
            <Icon name="act" />
            <span class="tt">{{ t('home.rateLimit.title') }}</span>
            <span class="ct">
              <a @click="openActivity()">{{ t('home.open') }}</a>
            </span>
          </div>
          <div v-if="!rateLimitAccounts.length" class="hmHint" :style="hintStyle">
            {{ t('home.rateLimit.empty') }}
          </div>
          <div v-else class="rlcards">
            <ActivityRateLimit v-for="acc in rateLimitAccounts" :key="acc.id" :account="acc" />
          </div>
        </div>

        <!-- Recent sessions -->
        <div class="tile c12">
          <div class="th">
            <Icon name="sessions" />
            <span class="tt">{{ t('home.recent.title') }}</span>
            <span class="ct">
              <a @click="navigateTo('/sessions')">{{ t('home.all') }}</a>
            </span>
          </div>
          <div v-if="!recentSessions.length" class="hmHint" :style="hintStyle">
            {{ t('home.recent.empty') }}
          </div>
          <div v-for="s in recentSessions" v-else :key="s.id" class="rs" @click="openSession(s.id)">
            <span class="si" :style="{ background: sessionDot(s.status) }" />
            <span class="st1">{{ s.title }}</span>
            <span class="tag">{{ s.project }}</span>
            <span class="tag">{{ s.model }}</span>
            <span class="sw">{{ sessionStatusLabel(s.status, s.when) }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Home — bento dashboard wired to the live stores (Phase B–E). All chrome +
// dynamic strings go through i18n (t); entity content comes from the sessions /
// tasks / connections / agents / git stores via useHomeDashboard. Browser-dev
// (no Electron bridge) renders the per-store mock seeds, so the bento never
// empties out during dev. navigateTo + useI18n are Nuxt auto-imports.
import { computed } from 'vue'
import { useHomeDashboard } from '~/composables/useHomeDashboard'
import { useAccounts } from '~/composables/useAccounts'
import type { SessionStatus } from '~/composables/useSessionsMock'

const { t } = useI18n()
const { openActivity } = useActivityModal()

// Provider rate-limit accounts — only providers with a usage surface (Anthropic
// subscription / OpenAI Codex). Each ActivityRateLimit self-hides if its account
// reports no rate-limit data, so the tile shows only accounts that have a quota.
const { accounts } = useAccounts()
const rateLimitAccounts = computed(() =>
  accounts.value.filter((a) => a.provider === 'Anthropic' || a.provider === 'OpenAI'),
)
const {
  attentionItems,
  runningCount,
  runningTaskRows,
  usage,
  deltaPct,
  sparkline,
  sessions,
  tasks,
} = useHomeDashboard()

const loadingLabel = computed(() => t('home.time.now'))

// Muted inline hint (loading / empty) — theme-driven, no new CSS class.
const hintStyle = {
  color: 'var(--textFaint)',
  fontSize: '0.9231rem',
  padding: '6px 0',
} as const

// Attention queue is "ready" once both source stores have a first load. Sessions
// seed synchronously (mock) / hydrate async (IPC); tasks gate on `loaded`.
const attentionReady = computed(() => tasks.loaded)

const attentionIcon = (kind: 'reply' | 'permission' | 'approval'): string =>
  kind === 'permission' ? 'shield' : kind === 'approval' ? 'check' : 'alert'

const actionLabel = (action: 'reply' | 'review' | 'approve'): string =>
  action === 'review'
    ? t('home.review')
    : action === 'approve'
      ? t('home.approve')
      : t('home.reply')

// Recent sessions: newest first (sessions list is already recency-ordered), cap 6.
const recentSessions = computed(() => sessions.sessions.slice(0, 6))

// Open a session from the recent list — set it active in the shared sessions
// store (singleton), then route to /sessions which renders `store.active`.
// Mirrors the sessions page's own `store.setActive` select.
function openSession(id: number) {
  sessions.setActive(id)
  navigateTo('/sessions')
}

const deltaLabel = computed(() => {
  const pct = Math.round(Math.abs(deltaPct.value) * 100)
  if (pct === 0) return t('home.activity.deltaFlat')
  return deltaPct.value > 0
    ? t('home.activity.deltaUp', { pct })
    : t('home.activity.deltaDown', { pct })
})

// Compact token formatting: 2_400_000 → "2.4M", 14_000 → "14k".
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// Elapsed time from an ISO createdAt → short "Xm Ys" label.
function elapsed(iso: string): string {
  const start = Date.parse(iso)
  if (Number.isNaN(start)) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const sessionDot = (status: SessionStatus): string =>
  status === 'streaming'
    ? 'var(--accent)'
    : status === 'awaiting'
      ? 'var(--amber)'
      : status === 'error'
        ? 'var(--amber)'
        : 'var(--textFaint)'

const sessionStatusLabel = (status: SessionStatus, when: string): string =>
  t(`home.recent.status.${status}`, { when })
</script>

<style scoped>
/* Provider rate-limit tile: one full card per account, same as the Activity page
   (.actrl grid) — auto-fill so wide tiles lay cards side by side. */
.rlcards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
</style>
