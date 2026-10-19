<template>
  <!-- `compact` = biến thể dock dưới: ngang + gọn, không kéo dọc. -->
  <div
    class="flex h-full min-h-0 flex-col overflow-y-auto"
    :class="compact ? 'gap-2 py-1 text-sm' : 'gap-3.5'"
  >
    <!-- RPC failed (e.g. the engine predates this method — restart the app) → say so,
         don't misreport it as "no priced turns". -->
    <div
      v-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-dim"
    >
      <div class="text-lg text-muted-foreground">{{ t('sessions.workspace.cost.error') }}</div>
      <Button variant="outline" size="xs" class="mt-2.5" @click="refresh">
        {{ t('sessions.workspace.cost.refresh') }}
      </Button>
    </div>
    <div
      v-else-if="!hasData && !loading"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-dim"
    >
      <div class="text-lg text-muted-foreground">{{ t('sessions.workspace.cost.empty') }}</div>
    </div>

    <template v-else>
      <!-- Range selector: quick presets + a custom date range. A session may span
           many days, so the readout below reflects only the selected window. -->
      <div class="flex min-w-0 items-center gap-2">
        <div
          class="flex min-w-0 flex-[0_1_auto] gap-0.5 overflow-x-auto rounded-md border border-border p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Button
            v-for="r in RANGES"
            :key="r"
            variant="ghost"
            size="xs"
            :class="[
              'shrink-0 border tabular-nums',
              range === r
                ? 'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary'
                : 'border-transparent text-dim hover:text-foreground',
            ]"
            @click="range = r"
          >
            {{ t(`sessions.workspace.cost.range.${r}`) }}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          class="ml-auto shrink-0 text-dim"
          :title="t('sessions.workspace.cost.refresh')"
          :aria-label="t('sessions.workspace.cost.refresh')"
          :disabled="loading"
          @click="refresh"
        >
          <RotateCw class="size-3.5" />
        </Button>
      </div>

      <!-- Custom range date inputs (only when the "Range" preset is active). -->
      <div v-if="range === 'custom'" class="flex flex-wrap gap-2.5">
        <Label class="flex min-w-0 flex-[1_1_8rem] items-center gap-1.5 font-normal text-dim">
          <span>{{ t('sessions.workspace.cost.from') }}</span>
          <Input
            v-model="customFrom"
            type="date"
            :min="firstDay"
            :max="lastDay"
            class="h-ctrl-xs min-w-0 flex-1 tabular-nums"
          />
        </Label>
        <Label class="flex min-w-0 flex-[1_1_8rem] items-center gap-1.5 font-normal text-dim">
          <span>{{ t('sessions.workspace.cost.to') }}</span>
          <Input
            v-model="customTo"
            type="date"
            :min="firstDay"
            :max="lastDay"
            class="h-ctrl-xs min-w-0 flex-1 tabular-nums"
          />
        </Label>
      </div>

      <!-- Headline: cost over the selected range + token/turn subline. -->
      <div class="flex" :class="compact ? 'flex-row items-baseline gap-2.5' : 'flex-col gap-0.5'">
        <div class="text-xs text-dim">
          {{ t('sessions.workspace.cost.rangeCost') }}
        </div>
        <div
          class="font-semibold tabular-nums text-foreground"
          :class="compact ? 'text-xl' : HERO_NUM_CLASS"
        >
          {{ fmtUsd(rangeTotal.costUsd) }}
        </div>
        <div class="tabular-nums text-dim">
          {{
            t('sessions.workspace.cost.tokens', {
              tokens: formatTokenCount(rangeTotal.totalTokens),
              turns: rangeTotal.turns,
            })
          }}
        </div>
      </div>

      <!-- Span + lifetime: makes multi-day sessions legible at a glance. -->
      <div
        class="flex flex-col border-y border-border"
        :class="compact ? 'gap-1 py-1' : 'gap-1.5 py-2.5'"
      >
        <div v-if="firstDay" class="flex items-center gap-2 text-dim">
          <Clock class="size-3 shrink-0" />
          <span>{{ spanLabel }}</span>
        </div>
        <div class="flex items-center gap-2 text-dim">
          <span>{{ t('sessions.workspace.cost.lifetime') }}</span>
          <span class="ml-auto tabular-nums text-foreground">{{ fmtUsd(lifetime.costUsd) }}</span>
        </div>
      </div>

      <!-- Per-day breakdown: one bar per active day in range, normalized to the
           peak day so a heavy day is obvious. -->
      <div>
        <div class="mb-1 text-xs text-dim">
          {{ t('sessions.workspace.cost.byDay') }}
        </div>
        <p v-if="!rangeDays.length" class="py-1 text-faint">
          {{
            lastDay
              ? t('sessions.workspace.cost.noDaysInRangeSince', { day: lastDay })
              : t('sessions.workspace.cost.noDaysInRange')
          }}
        </p>
        <div
          v-for="d in daysDesc"
          :key="d.date"
          class="flex items-center gap-2.5"
          :class="compact ? 'py-0.5' : 'py-1'"
          :title="dayTitle(d)"
        >
          <span class="shrink-0 text-xs tabular-nums text-dim">{{ d.date }}</span>
          <Progress :model-value="barPct(d.costUsd)" class="h-2 min-w-0 flex-1 rounded-sm" />
          <span class="min-w-14 shrink-0 text-right text-xs tabular-nums text-foreground">
            {{ fmtUsd(d.costUsd) }}
          </span>
        </div>
      </div>

      <Alert
        v-if="hasUnpriced"
        class="flex items-center gap-1.5 border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning [&>svg]:size-3 [&>svg]:translate-y-0"
      >
        <AlertTriangle class="size-3 shrink-0" />
        {{ t('sessions.workspace.cost.unpriced') }}
      </Alert>
    </template>
  </div>
</template>

<script setup lang="ts">
// Cost tab — a single session's spend, split into 1d/7d/30d/custom ranges plus a
// per-day breakdown (a session can run across many days). Data + range math live in
// useSessionCostBreakdown; this owns only presentation.
import { AlertTriangle, Clock, RotateCw } from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import type { CostDay, CostRange } from '~/composables/useSessionCostBreakdown'
import { formatTokenCount } from '~/utils/context-window'

const props = withDefaults(defineProps<{ session: Session; compact?: boolean }>(), {
  compact: false,
})
const compact = props.compact

const { t } = useI18n()

const RANGES: CostRange[] = ['1d', '7d', '30d', 'all', 'custom']

// Số tiền hero lớn hơn bậc text-2xl của thang — cố ý cố định, không theo Appearance.
const HERO_NUM_CLASS = 'text-[34px] leading-[38px]' // px-ok: số hero ngoài thang chữ

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
  `${d.date} · ${fmtUsd(d.costUsd)} · ${formatTokenCount(d.totalTokens)} tokens · ${d.turns} turns`
</script>
