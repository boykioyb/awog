<template>
  <div class="wscost">
    <!-- RPC failed (e.g. the engine predates this method — restart the app) → say so,
         don't misreport it as "no priced turns". -->
    <div v-if="error" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.cost.error') }}</div>
      <button class="wscost-retry" @click="refresh">
        {{ t('sessions.workspace.cost.refresh') }}
      </button>
    </div>
    <div v-else-if="!hasData && !loading" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.cost.empty') }}</div>
    </div>

    <template v-else>
      <!-- Range selector: quick presets + a custom date range. A session may span
           many days, so the readout below reflects only the selected window. -->
      <div class="wscost-bar">
        <div class="wscost-seg">
          <button
            v-for="r in RANGES"
            :key="r"
            class="wscost-segbtn"
            :class="{ on: range === r }"
            @click="range = r"
          >
            {{ t(`sessions.workspace.cost.range.${r}`) }}
          </button>
        </div>
        <button
          class="wscost-refresh"
          :title="t('sessions.workspace.cost.refresh')"
          :disabled="loading"
          @click="refresh"
        >
          <Icon name="refresh" style="width: 13px; height: 13px" />
        </button>
      </div>

      <!-- Custom range date inputs (only when the "Range" preset is active). -->
      <div v-if="range === 'custom'" class="wscost-custom">
        <label class="wscost-datef">
          <span>{{ t('sessions.workspace.cost.from') }}</span>
          <input v-model="customFrom" type="date" :min="firstDay" :max="lastDay" />
        </label>
        <label class="wscost-datef">
          <span>{{ t('sessions.workspace.cost.to') }}</span>
          <input v-model="customTo" type="date" :min="firstDay" :max="lastDay" />
        </label>
      </div>

      <!-- Headline: cost over the selected range + token/turn subline. -->
      <div class="wscost-head">
        <div class="wscost-lbl">{{ t('sessions.workspace.cost.rangeCost') }}</div>
        <div class="wscost-big">{{ fmtUsd(rangeTotal.costUsd) }}</div>
        <div class="wscost-sub">
          {{
            t('sessions.workspace.cost.tokens', {
              tokens: kfmt(rangeTotal.totalTokens),
              turns: rangeTotal.turns,
            })
          }}
        </div>
      </div>

      <!-- Span + lifetime: makes multi-day sessions legible at a glance. -->
      <div class="wscost-meta">
        <div v-if="firstDay" class="wscost-metarow">
          <Icon name="clock" style="width: 12px; height: 12px; flex: 0 0 auto" />
          <span>{{ spanLabel }}</span>
        </div>
        <div class="wscost-metarow">
          <span class="wscost-metak">{{ t('sessions.workspace.cost.lifetime') }}</span>
          <span class="wscost-metav mono">{{ fmtUsd(lifetime.costUsd) }}</span>
        </div>
      </div>

      <!-- Per-day breakdown: one bar per active day in range, normalized to the
           peak day so a heavy day is obvious. -->
      <div class="wscost-days">
        <div class="wscost-dayh">{{ t('sessions.workspace.cost.byDay') }}</div>
        <p v-if="!rangeDays.length" class="wscost-daysempty">
          {{
            lastDay
              ? t('sessions.workspace.cost.noDaysInRangeSince', { day: lastDay })
              : t('sessions.workspace.cost.noDaysInRange')
          }}
        </p>
        <div v-for="d in daysDesc" :key="d.date" class="wscost-dayrow" :title="dayTitle(d)">
          <span class="wscost-daydate mono">{{ d.date }}</span>
          <span class="wscost-daybar">
            <i :style="{ width: `${barPct(d.costUsd)}%` }" />
          </span>
          <span class="wscost-daycost mono">{{ fmtUsd(d.costUsd) }}</span>
        </div>
      </div>

      <div v-if="hasUnpriced" class="wscost-warn">
        <Icon name="alert" style="width: 12px; height: 12px; flex: 0 0 auto" />
        {{ t('sessions.workspace.cost.unpriced') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Cost tab — a single session's spend, split into 1d/7d/30d/custom ranges plus a
// per-day breakdown (a session can run across many days). Data + range math live in
// useSessionCostBreakdown; this owns only presentation.
import type { Session } from '~/composables/useSessionsData'
import type { CostDay, CostRange } from '~/composables/useSessionCostBreakdown'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()

const RANGES: CostRange[] = ['1d', '7d', '30d', 'all', 'custom']

const {
  loading,
  error,
  range,
  customFrom,
  customTo,
  rangeDays,
  rangeTotal,
  lifetime,
  hasData,
  hasUnpriced,
  firstDay,
  lastDay,
  maxDayCost,
  kfmt,
  fmtUsd,
  refresh,
} = useSessionCostBreakdown(() => props.session)

// Newest day first in the list (byDay is oldest → newest).
const daysDesc = computed(() => [...rangeDays.value].reverse())

// Bar width as % of the peak day cost (min 3% so a non-zero day still shows).
function barPct(cost: number): number {
  if (maxDayCost.value <= 0) return 0
  return Math.max(3, Math.round((cost / maxDayCost.value) * 100))
}

const spanLabel = computed(() => {
  if (!firstDay.value) return ''
  if (!lastDay.value || lastDay.value === firstDay.value) {
    return t('sessions.workspace.cost.spanOne', { from: firstDay.value })
  }
  return t('sessions.workspace.cost.span', { from: firstDay.value, to: lastDay.value })
})

const dayTitle = (d: CostDay): string =>
  `${d.date} · ${fmtUsd(d.costUsd)} · ${kfmt(d.totalTokens)} tokens · ${d.turns} turns`
</script>

<style scoped>
.wscost {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* Range selector row. */
.wscost-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Segmented control — transparent track, active pill = accent tint (not a gray
   fill), per the AWOG surface-fill guidance. */
.wscost-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.wscost-segbtn {
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition:
    color 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease;
}
.wscost-segbtn:hover {
  color: var(--text);
  background: var(--bgHover);
}
.wscost-segbtn.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.wscost-refresh {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.wscost-refresh:hover:not(:disabled) {
  color: var(--text);
  background: var(--bgHover);
}
.wscost-refresh:disabled {
  opacity: 0.4;
  cursor: default;
}
/* Custom-range date pickers. */
.wscost-custom {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.wscost-datef {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--textDim);
}
.wscost-datef input {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 6px;
  color: var(--text);
  font-family: var(--code);
}
/* Headline cost. */
.wscost-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wscost-lbl {
  color: var(--textDim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 12px;
}
.wscost-big {
  font-size: 34px;
  font-weight: 650;
  line-height: 1.1;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.wscost-sub {
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
/* Span + lifetime meta. */
.wscost-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.wscost-metarow {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--textDim);
}
.wscost-metak {
  color: var(--textDim);
}
.wscost-metav {
  margin-left: auto;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
/* Per-day breakdown. */
.wscost-dayh {
  color: var(--textDim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 12px;
  margin-bottom: 4px;
}
.wscost-daysempty {
  color: var(--textFaint);
  padding: 4px 0;
}
.wscost-dayrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.wscost-daydate {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--textDim);
}
.wscost-daybar {
  flex: 1;
  min-width: 0;
  height: 8px;
  border-radius: 4px;
  background: var(--bgActive);
  overflow: hidden;
}
.wscost-daybar > i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--accent);
}
.wscost-daycost {
  flex: 0 0 auto;
  min-width: 56px;
  text-align: right;
  font-size: 12px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.wscost-retry {
  margin-top: 10px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.wscost-retry:hover {
  color: var(--text);
  background: var(--bgHover);
}
.wscost-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--amber);
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
}
</style>
