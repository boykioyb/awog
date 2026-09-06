<template>
  <div class="actview">
    <!-- Header: title + range/account filters -->
    <div class="acthd">
      <div class="acthdl">
        <Icon name="act" class="acthdic" />
        <div>
          <div class="acthdt">{{ t('activity.title') }}</div>
          <div class="fd">{{ rangeSubtitle }}</div>
        </div>
      </div>
      <div class="acthdr">
        <div class="seg">
          <span
            v-for="r in ACTIVITY_RANGES"
            :key="r"
            :class="{ on: r === range }"
            role="button"
            @click="range = r"
          >
            {{ t(`activity.range.${r}`) }}
          </span>
        </div>
        <AppSelect
          v-model="projectId"
          :options="projectSelectOptions"
          :placeholder="t('activity.project.all')"
          width="200px"
        />
        <AppSelect
          v-model="accountId"
          :options="accountSelectOptions"
          :placeholder="t('activity.account.all')"
          width="200px"
        />
      </div>
    </div>

    <!-- Error banner (sidecar failed — showing fallback data) -->
    <div v-if="error" class="acterr">
      <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('activity.error', { msg: error }) }}
    </div>

    <!-- Summary cards -->
    <div class="actcards">
      <div class="tile actcard">
        <div class="actclbl">{{ t('activity.cards.totalTokens') }}</div>
        <div class="actcbig tnum">{{ initialLoad ? '…' : formatTokens(totals.totalTokens) }}</div>
        <div class="actcsub">
          {{
            t('activity.cards.tokenBreak', {
              input: formatTokens(totals.inputTokens),
              output: formatTokens(totals.outputTokens),
            })
          }}
        </div>
      </div>
      <div class="tile actcard">
        <div class="actclbl">{{ t('activity.cards.totalCost') }}</div>
        <div class="actcbig tnum" style="color: var(--accent)">
          {{ initialLoad ? '…' : formatCost(totals.costUsd) }}
        </div>
        <div class="actcsub">
          {{
            t('activity.cards.cacheBreak', {
              read: formatTokens(totals.cacheReadTokens),
              write: formatTokens(totals.cacheWriteTokens),
            })
          }}
        </div>
      </div>
      <div class="tile actcard">
        <div class="actclbl">{{ t('activity.cards.turns') }}</div>
        <div class="actcbig tnum">{{ initialLoad ? '…' : formatTokens(totals.turns) }}</div>
        <div class="actcsub">{{ t('activity.cards.turnsSub') }}</div>
      </div>
    </div>

    <!-- Cost timeseries chart -->
    <div class="sech">{{ t('activity.chart.title') }}</div>
    <div class="tile actchartwrap">
      <div v-if="!chartBars.length" class="acthint">{{ t('activity.chart.empty') }}</div>
      <template v-else>
        <div class="actchart">
          <div
            v-for="bar in chartBars"
            :key="bar.date"
            class="actbar"
            :class="{ hi: bar.hi }"
            :title="
              t('activity.chart.barTip', {
                date: bar.date,
                cost: formatCost(bar.costUsd),
                tokens: formatTokens(bar.totalTokens),
              })
            "
          >
            <i :style="{ height: bar.height + '%' }" />
          </div>
        </div>
        <div class="actaxis">
          <span>{{ chartBars[0]?.date }}</span>
          <span>{{ chartBars[chartBars.length - 1]?.date }}</span>
        </div>
      </template>
    </div>

    <!-- By model table -->
    <div class="sech">{{ t('activity.byModel.title') }}</div>
    <div v-if="hasMissingPrices" class="actwarn">
      <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
      {{ t('activity.byModel.missingHint') }}
    </div>
    <div class="tile actpanel">
      <div v-if="!byModel.length" class="acthint">{{ t('activity.byModel.empty') }}</div>
      <table v-else class="acttable">
        <thead>
          <tr>
            <th class="tl">{{ t('activity.byModel.col.model') }}</th>
            <th class="tr">{{ t('activity.byModel.col.input') }}</th>
            <th class="tr">{{ t('activity.byModel.col.output') }}</th>
            <th class="tr">{{ t('activity.byModel.col.cache') }}</th>
            <th class="tr">{{ t('activity.byModel.col.total') }}</th>
            <th class="tr">{{ t('activity.byModel.col.turns') }}</th>
            <th class="tr">{{ t('activity.byModel.col.cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in byModel" :key="m.model + m.provider">
            <td class="tl">
              <div class="actmdl">
                <span class="mono">{{ m.model }}</span>
                <span class="tag">{{ m.provider }}</span>
                <span v-if="missingPriceSet.has(m.model)" class="tag warn">
                  {{ t('activity.byModel.noPrice') }}
                </span>
              </div>
            </td>
            <td class="tr tnum">{{ formatTokens(m.inputTokens) }}</td>
            <td class="tr tnum">{{ formatTokens(m.outputTokens) }}</td>
            <td class="tr tnum">
              {{ formatTokens(m.cacheReadTokens + m.cacheWriteTokens) }}
            </td>
            <td class="tr tnum">{{ formatTokens(m.totalTokens) }}</td>
            <td class="tr tnum">{{ formatTokens(m.turns) }}</td>
            <td class="tr tnum" style="color: var(--accent)">{{ formatCost(m.costUsd) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- By account table -->
    <div class="sech">{{ t('activity.byAccount.title') }}</div>
    <div class="tile actpanel">
      <div v-if="!byAccount.length" class="acthint">{{ t('activity.byAccount.empty') }}</div>
      <table v-else class="acttable">
        <thead>
          <tr>
            <th class="tl">{{ t('activity.byAccount.col.account') }}</th>
            <th class="tl">{{ t('activity.byAccount.col.provider') }}</th>
            <th class="tr">{{ t('activity.byAccount.col.total') }}</th>
            <th class="tr">{{ t('activity.byAccount.col.turns') }}</th>
            <th class="tr">{{ t('activity.byAccount.col.cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in byAccount" :key="a.accountId">
            <td class="tl">{{ a.label }}</td>
            <td class="tl">
              <span class="tag">{{ a.provider }}</span>
            </td>
            <td class="tr tnum">{{ formatTokens(a.totalTokens) }}</td>
            <td class="tr tnum">{{ formatTokens(a.turns) }}</td>
            <td class="tr tnum" style="color: var(--accent)">{{ formatCost(a.costUsd) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- By session table -->
    <div class="actsesh">
      <div class="sech">{{ t('activity.bySession.title') }}</div>
      <div class="seg">
        <span
          v-for="s in SESSION_SORTS"
          :key="s"
          :class="{ on: s === sessionSort }"
          role="button"
          @click="sessionSort = s"
        >
          {{ t(`activity.bySession.sort.${s}`) }}
        </span>
      </div>
    </div>
    <div class="tile actpanel">
      <div v-if="!bySession.length" class="acthint">{{ t('activity.bySession.empty') }}</div>
      <table v-else class="acttable">
        <thead>
          <tr>
            <th class="tl">{{ t('activity.bySession.col.session') }}</th>
            <th class="tl">{{ t('activity.bySession.col.model') }}</th>
            <th class="tr">{{ t('activity.bySession.col.total') }}</th>
            <th class="tr">{{ t('activity.bySession.col.turns') }}</th>
            <th class="tr">{{ t('activity.bySession.col.cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="s in bySession" :key="s.sessionId">
            <tr>
              <td class="tl">
                <div class="actsesnm">
                  <button
                    class="actsesx"
                    :class="{ open: isSessionExpanded(s.sessionId) }"
                    :disabled="!s.byDay.length"
                    :aria-expanded="isSessionExpanded(s.sessionId)"
                    :title="t('activity.bySession.days.toggle')"
                    @click="toggleSessionDays(s.sessionId)"
                  >
                    <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
                  </button>
                  <span
                    class="actseshttl actseshlink"
                    role="button"
                    tabindex="0"
                    :title="s.title"
                    @click="goToSession(s.sessionId)"
                    @keydown.enter="goToSession(s.sessionId)"
                  >
                    {{ s.title }}
                  </span>
                </div>
              </td>
              <td class="tl">
                <div class="actmdl">
                  <span class="mono">{{ s.model || '—' }}</span>
                  <span v-if="s.provider" class="tag">{{ s.provider }}</span>
                </div>
              </td>
              <td class="tr tnum">{{ formatTokens(s.totalTokens) }}</td>
              <td class="tr tnum">{{ formatTokens(s.turns) }}</td>
              <td class="tr tnum" style="color: var(--accent)">{{ formatCost(s.costUsd) }}</td>
            </tr>
            <!-- Drill-down: this session's spend split by day, newest first. Same
                 pricing + filters as the row above, so the days sum to it. -->
            <tr v-if="isSessionExpanded(s.sessionId)" class="actdaysrow">
              <td colspan="5">
                <div class="actdays">
                  <div v-for="d in sessionDays(s)" :key="d.date" class="actday">
                    <span class="actdaydate tnum">{{ d.date }}</span>
                    <span class="actdaybar">
                      <i :style="{ width: `${dayPct(s, d.costUsd)}%` }" />
                    </span>
                    <span class="actdaymeta tnum">
                      {{
                        t('activity.bySession.days.meta', {
                          tokens: formatTokens(d.totalTokens),
                          turns: d.turns,
                        })
                      }}
                    </span>
                    <span class="actdaycost tnum">{{ formatCost(d.costUsd) }}</span>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Provider rate-limit panel (one card per account) -->
    <div class="sech">{{ t('activity.rateLimit.title') }}</div>
    <div v-if="!rateLimitAccounts.length" class="tile actpanel">
      <div class="acthint">{{ t('activity.rateLimit.empty') }}</div>
    </div>
    <div v-else class="actrl">
      <ActivityRateLimit v-for="acc in rateLimitAccounts" :key="acc.id" :account="acc" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Activity content — usage + cost analytics. Thin template over useActivity
// (range + account filter → activity.summary). All chrome/strings go through
// i18n; the chart is pure CSS bars (no chart dep). Provider rate-limit rows reuse
// useAccountUsage via the ActivityRateLimit child. AppSelect is a Nuxt
// auto-import (components/common/AppSelect.vue). Rendered inside ActivityModal —
// the modal body owns scrolling; this view is just the content.
import { computed } from 'vue'
import type { ActivityBySession, SessionSort } from '~/composables/useActivity'
import { ACTIVITY_RANGES, useActivity } from '~/composables/useActivity'

// By-session sort options (most-used first / least-used first).
const SESSION_SORTS: readonly SessionSort[] = ['most', 'least'] as const

const { t } = useI18n()
const { openSession } = useSessionTaskLink()
const { closeActivity } = useActivityModal()

// Click a session title → open it on the Sessions page and dismiss the Activity
// modal. Only close on success (openSession returns false for a deleted session
// or a row with no real engineId to resolve).
async function goToSession(engineId: string): Promise<void> {
  const ok = await openSession(engineId)
  if (ok) closeActivity()
}

const {
  range,
  accountId,
  projectId,
  sessionSort,
  accountOptions,
  accounts,
  projects,
  initialLoad,
  error,
  totals,
  chartBars,
  byModel,
  byAccount,
  bySession,
  missingPriceSet,
  hasMissingPrices,
  isSessionExpanded,
  toggleSessionDays,
  formatTokens,
  formatCost,
} = useActivity()

// Drill-down rows newest first (byDay arrives oldest → newest), mirroring the
// session's own Cost tab.
const sessionDays = (s: ActivityBySession) => [...s.byDay].reverse()

// Day bar width as % of this session's own peak day (min 3% so a cheap-but-
// non-zero day is still visible). Scoped per session, not to the page total —
// the point is the shape of one session's spend over time.
function dayPct(s: ActivityBySession, costUsd: number): number {
  const peak = s.byDay.reduce((m, d) => Math.max(m, d.costUsd), 0)
  if (peak <= 0) return 0
  return Math.max(3, Math.round((costUsd / peak) * 100))
}

// AppSelect options: localized "All accounts" + each account's display label.
const accountSelectOptions = computed(() =>
  accountOptions.value.map((o) =>
    o.id === 'all'
      ? { value: 'all', label: t('activity.account.all') }
      : { value: o.id, label: o.display },
  ),
)

// AppSelect options: localized "All projects" + each project's name.
const projectSelectOptions = computed(() => [
  { value: 'all', label: t('activity.project.all') },
  ...projects.value.map((p) => ({ value: p.id, label: p.name })),
])

// Only Anthropic/OpenAI accounts have a usage surface (useAccountUsage no-ops
// otherwise) — list those for the rate-limit panel.
const rateLimitAccounts = computed(() =>
  accounts.value.filter((a) => a.provider === 'Anthropic' || a.provider === 'OpenAI'),
)

const rangeSubtitle = computed(() => t(`activity.range.long.${range.value}`))
</script>

<style scoped>
.acthd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.acthdl {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.acthdic {
  width: 22px;
  height: 22px;
  color: var(--accent);
  flex: 0 0 auto;
}
.acthdt {
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  font-weight: 600;
}
.acthdr {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.acterr {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.actcards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 14px;
}
.actcard {
  gap: 4px;
}
.actclbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.actcbig {
  font-size: var(--fs-2xl);
  font-weight: 600;
  line-height: 26px;
  margin-top: 4px;
}
.actcsub {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  margin-top: 4px;
}

.actchartwrap {
  gap: 8px;
}
.actchart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 140px;
}
.actbar {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  cursor: default;
}
.actbar i {
  width: 100%;
  background: var(--accent);
  opacity: 0.42;
  border-radius: var(--r-xs) var(--r-xs) 0 0;
  min-height: 3px;
  transition: opacity 0.12s;
}
.actbar.hi i,
.actbar:hover i {
  opacity: 0.85;
}
.actaxis {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
  color: var(--textFaint);
}

.actpanel {
  padding: 0;
  overflow: hidden;
}
.acthint {
  padding: 18px 15px;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.actwarn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 7px 11px;
  border-radius: var(--r-sm);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.acttable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.acttable th {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-weight: 500;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.acttable td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--textMuted);
}
.acttable tbody tr:last-child td {
  border-bottom: 0;
}
.acttable tbody tr:hover td {
  background: var(--bgHover);
}
.acttable .tl {
  text-align: left;
}
.acttable .tr {
  text-align: right;
}
.actmdl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.actrl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}

/* By-session header row: section title + sort toggle on one line. */
.actsesh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 20px 0 9px;
}
.actsesh .sech {
  margin: 0;
}
.actseshttl {
  display: block;
  max-width: 460px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actseshlink {
  cursor: pointer;
  transition: color 0.12s;
}
.actseshlink:hover {
  color: var(--accent);
  text-decoration: underline;
}
/* Session name cell: expander + title. */
.actsesnm {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.actsesx {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textFaint);
  cursor: pointer;
  /* Collapsed = pointing right; the sprite's chev points down. */
  transform: rotate(-90deg);
  transition:
    transform 0.15s ease,
    color 0.12s ease;
}
.actsesx.open {
  transform: rotate(0deg);
  color: var(--textDim);
}
.actsesx:hover:not(:disabled) {
  color: var(--text);
  background: var(--bgHover);
}
.actsesx:disabled {
  opacity: 0.25;
  cursor: default;
}
/* Per-day drill-down under a session row. */
.actdaysrow > td {
  padding: 0 14px 10px 38px;
  background: var(--bgHover);
}
.actdays {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.actday {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
}
.actdaydate {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.actdaybar {
  flex: 1 1 auto;
  min-width: 40px;
  height: 6px;
  border-radius: var(--r-xs);
  background: var(--bgActive);
  overflow: hidden;
}
.actdaybar > i {
  display: block;
  height: 100%;
  border-radius: var(--r-xs);
  background: var(--accent);
}
.actdaymeta {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.actdaycost {
  flex: 0 0 auto;
  min-width: 64px;
  text-align: right;
  font-size: 12px;
  line-height: 18px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
</style>
