<template>
  <section class="page on" data-page="activity">
    <div class="scroll">
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
            v-model="accountId"
            :options="accountSelectOptions"
            :placeholder="t('activity.account.all')"
            width="200px"
          />
        </div>
      </div>

      <!-- Error banner (sidecar failed — showing fallback data) -->
      <div v-if="error" class="acterr">
        <Icon name="alert" style="width: 14px; height: 14px" />
        {{ t('activity.error', { msg: error }) }}
      </div>

      <!-- Summary cards -->
      <div class="actcards">
        <div class="tile actcard">
          <div class="actclbl">{{ t('activity.cards.totalTokens') }}</div>
          <div class="actcbig mono">{{ loading ? '…' : formatTokens(totals.totalTokens) }}</div>
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
          <div class="actcbig mono" style="color: var(--accent)">
            {{ loading ? '…' : formatCost(totals.costUsd) }}
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
          <div class="actcbig mono">{{ loading ? '…' : formatTokens(totals.turns) }}</div>
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
        <Icon name="alert" style="width: 14px; height: 14px" />
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
              <td class="tr mono">{{ formatTokens(m.inputTokens) }}</td>
              <td class="tr mono">{{ formatTokens(m.outputTokens) }}</td>
              <td class="tr mono">
                {{ formatTokens(m.cacheReadTokens + m.cacheWriteTokens) }}
              </td>
              <td class="tr mono">{{ formatTokens(m.totalTokens) }}</td>
              <td class="tr mono">{{ formatTokens(m.turns) }}</td>
              <td class="tr mono" style="color: var(--accent)">{{ formatCost(m.costUsd) }}</td>
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
              <td class="tr mono">{{ formatTokens(a.totalTokens) }}</td>
              <td class="tr mono">{{ formatTokens(a.turns) }}</td>
              <td class="tr mono" style="color: var(--accent)">{{ formatCost(a.costUsd) }}</td>
            </tr>
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
  </section>
</template>

<script setup lang="ts">
// Activity — usage + cost analytics page. Thin template over useActivity (range +
// account filter → activity.summary). All chrome/strings go through i18n; the
// chart is pure CSS bars (no chart dep). Provider rate-limit rows reuse
// useAccountUsage via the ActivityRateLimit child. AppSelect is a Nuxt
// auto-import (components/common/AppSelect.vue).
import { computed } from 'vue'
import { ACTIVITY_RANGES, useActivity } from '~/composables/useActivity'

const { t } = useI18n()
const {
  range,
  accountId,
  accountOptions,
  accounts,
  loading,
  error,
  totals,
  chartBars,
  byModel,
  byAccount,
  missingPriceSet,
  hasMissingPrices,
  formatTokens,
  formatCost,
} = useActivity()

// AppSelect options: localized "All accounts" + each account's display label.
const accountSelectOptions = computed(() =>
  accountOptions.value.map((o) =>
    o.id === 'all'
      ? { value: 'all', label: t('activity.account.all') }
      : { value: o.id, label: o.display },
  ),
)

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
  font-size: 1.231rem;
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
  border-radius: 9px;
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: 0.9615rem;
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
  font-size: 0.8462rem;
  font-family: var(--code);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--textDim);
}
.actcbig {
  font-size: 1.85rem;
  font-weight: 600;
  line-height: 1.15;
  margin-top: 4px;
}
.actcsub {
  font-size: 0.8846rem;
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
  border-radius: 3px 3px 0 0;
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
  font-size: 0.8462rem;
  font-family: var(--code);
  color: var(--textFaint);
}

.actpanel {
  padding: 0;
  overflow: hidden;
}
.acthint {
  padding: 18px 15px;
  color: var(--textFaint);
  font-size: 0.9231rem;
}
.actwarn {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: 0.9231rem;
}

.acttable {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9615rem;
}
.acttable th {
  font-size: 0.8462rem;
  font-family: var(--code);
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
</style>
