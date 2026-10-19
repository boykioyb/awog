<template>
  <div>
    <!-- Header: title + range/account filters -->
    <div class="mb-1.5 flex flex-wrap items-start justify-between gap-4">
      <div class="flex min-w-0 items-center gap-3">
        <Icon name="act" class="size-5.5 shrink-0 text-primary" />
        <div>
          <div class="text-xl font-semibold">{{ t('activity.title') }}</div>
          <div class="text-sm text-dim">{{ rangeSubtitle }}</div>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2.5">
        <SettingsSeg v-model="rangeValue" :options="rangeOptions" />
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
    <div
      v-if="error"
      class="my-2.5 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      <Icon name="alert" class="size-3.5" />
      {{ t('activity.error', { msg: error }) }}
    </div>

    <!-- Summary cards -->
    <div class="mt-3.5 grid grid-cols-3 gap-3">
      <Card class="gap-1 p-4 shadow-none">
        <div class="text-xs text-dim">{{ t('activity.cards.totalTokens') }}</div>
        <div class="mt-1 text-2xl font-semibold tabular-nums">
          {{ initialLoad ? '…' : formatTokens(totals.totalTokens) }}
        </div>
        <div class="mt-1 text-sm text-dim">
          {{
            t('activity.cards.tokenBreak', {
              input: formatTokens(totals.inputTokens),
              output: formatTokens(totals.outputTokens),
            })
          }}
        </div>
      </Card>
      <Card class="gap-1 p-4 shadow-none">
        <div class="text-xs text-dim">{{ t('activity.cards.totalCost') }}</div>
        <div class="mt-1 text-2xl font-semibold text-primary tabular-nums">
          {{ initialLoad ? '…' : formatCost(totals.costUsd) }}
        </div>
        <div class="mt-1 text-sm text-dim">
          {{
            t('activity.cards.cacheBreak', {
              read: formatTokens(totals.cacheReadTokens),
              write: formatTokens(totals.cacheWriteTokens),
            })
          }}
        </div>
      </Card>
      <Card class="gap-1 p-4 shadow-none">
        <div class="text-xs text-dim">{{ t('activity.cards.turns') }}</div>
        <div class="mt-1 text-2xl font-semibold tabular-nums">
          {{ initialLoad ? '…' : formatTokens(totals.turns) }}
        </div>
        <div class="mt-1 text-sm text-dim">{{ t('activity.cards.turnsSub') }}</div>
      </Card>
    </div>

    <!-- Cost timeseries chart -->
    <SettingsGroupLabel>{{ t('activity.chart.title') }}</SettingsGroupLabel>
    <Card class="gap-2 p-4 shadow-none">
      <div v-if="!chartBars.length" class="text-sm text-faint">{{ t('activity.chart.empty') }}</div>
      <template v-else>
        <!-- Cột biểu đồ CSS thuần: chiều cao inline là tỉ lệ dữ liệu. -->
        <div class="flex h-35 items-end gap-1">
          <div
            v-for="bar in chartBars"
            :key="bar.date"
            class="group flex h-full flex-1 cursor-default items-end"
            :title="
              t('activity.chart.barTip', {
                date: bar.date,
                cost: formatCost(bar.costUsd),
                tokens: formatTokens(bar.totalTokens),
              })
            "
          >
            <i
              class="block min-h-0.75 w-full rounded-t-sm bg-primary transition-opacity group-hover:opacity-85"
              :class="bar.hi ? 'opacity-85' : 'opacity-40'"
              :style="{ height: bar.height + '%' }"
            />
          </div>
        </div>
        <div class="flex justify-between text-xs text-faint tabular-nums">
          <span>{{ chartBars[0]?.date }}</span>
          <span>{{ chartBars[chartBars.length - 1]?.date }}</span>
        </div>
      </template>
    </Card>

    <!-- By model table -->
    <SettingsGroupLabel>{{ t('activity.byModel.title') }}</SettingsGroupLabel>
    <div
      v-if="hasMissingPrices"
      class="mb-2 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning"
    >
      <Icon name="alert" class="size-3.5" />
      {{ t('activity.byModel.missingHint') }}
    </div>
    <Card class="gap-0 overflow-hidden p-0 shadow-none">
      <div v-if="!byModel.length" class="px-4 py-4.5 text-sm text-faint">
        {{ t('activity.byModel.empty') }}
      </div>
      <Table v-else>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="px-3.5 text-xs text-dim">
              {{ t('activity.byModel.col.model') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byModel.col.input') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byModel.col.output') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byModel.col.cache') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byModel.col.total') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byModel.col.turns') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byModel.col.cost') }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="m in byModel"
            :key="m.model + m.provider"
            class="last:border-b-0 hover:bg-accent"
          >
            <TableCell class="px-3.5 py-2.5 text-muted-foreground">
              <div class="flex flex-wrap items-center gap-2">
                <!-- mono-ok: id model -->
                <span class="font-mono">{{ m.model }}</span>
                <Badge variant="outline" class="text-muted-foreground">{{ m.provider }}</Badge>
                <Badge
                  v-if="missingPriceSet.has(m.model)"
                  variant="outline"
                  class="border-warning/45 text-warning"
                >
                  {{ t('activity.byModel.noPrice') }}
                </Badge>
              </div>
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(m.inputTokens) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(m.outputTokens) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(m.cacheReadTokens + m.cacheWriteTokens) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(m.totalTokens) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(m.turns) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-primary tabular-nums">
              {{ formatCost(m.costUsd) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- By account table -->
    <SettingsGroupLabel>{{ t('activity.byAccount.title') }}</SettingsGroupLabel>
    <Card class="gap-0 overflow-hidden p-0 shadow-none">
      <div v-if="!byAccount.length" class="px-4 py-4.5 text-sm text-faint">
        {{ t('activity.byAccount.empty') }}
      </div>
      <Table v-else>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="px-3.5 text-xs text-dim">
              {{ t('activity.byAccount.col.account') }}
            </TableHead>
            <TableHead class="px-3.5 text-xs text-dim">
              {{ t('activity.byAccount.col.provider') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byAccount.col.total') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byAccount.col.turns') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.byAccount.col.cost') }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="a in byAccount"
            :key="a.accountId"
            class="last:border-b-0 hover:bg-accent"
          >
            <TableCell class="px-3.5 py-2.5 text-muted-foreground">{{ a.label }}</TableCell>
            <TableCell class="px-3.5 py-2.5 text-muted-foreground">
              <Badge variant="outline" class="text-muted-foreground">{{ a.provider }}</Badge>
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(a.totalTokens) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
              {{ formatTokens(a.turns) }}
            </TableCell>
            <TableCell class="px-3.5 py-2.5 text-right text-primary tabular-nums">
              {{ formatCost(a.costUsd) }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- By session table: tiêu đề + nút sắp xếp trên một hàng -->
    <div class="mt-5 mb-2 flex flex-wrap items-center justify-between gap-3">
      <div class="text-xs font-medium text-muted-foreground">
        {{ t('activity.bySession.title') }}
      </div>
      <SettingsSeg v-model="sessionSortValue" :options="sessionSortOptions" />
    </div>
    <Card class="gap-0 overflow-hidden p-0 shadow-none">
      <div v-if="!bySession.length" class="px-4 py-4.5 text-sm text-faint">
        {{ t('activity.bySession.empty') }}
      </div>
      <Table v-else>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="px-3.5 text-xs text-dim">
              {{ t('activity.bySession.col.session') }}
            </TableHead>
            <TableHead class="px-3.5 text-xs text-dim">
              {{ t('activity.bySession.col.model') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.bySession.col.total') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.bySession.col.turns') }}
            </TableHead>
            <TableHead class="px-3.5 text-right text-xs text-dim">
              {{ t('activity.bySession.col.cost') }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-for="s in bySession" :key="s.sessionId">
            <TableRow class="last:border-b-0 hover:bg-accent">
              <TableCell class="px-3.5 py-2.5 text-muted-foreground">
                <div class="flex min-w-0 items-center gap-1.5">
                  <!-- Chev của sprite trỏ xuống; đóng = xoay -90° (trỏ phải). -->
                  <Button
                    variant="ghost"
                    size="iconSm"
                    class="size-4.5 shrink-0 text-faint transition-transform hover:text-foreground disabled:opacity-25 [&_svg]:size-3"
                    :class="isSessionExpanded(s.sessionId) ? 'text-dim' : '-rotate-90'"
                    :disabled="!s.byDay.length"
                    :aria-expanded="isSessionExpanded(s.sessionId)"
                    :title="t('activity.bySession.days.toggle')"
                    :aria-label="t('activity.bySession.days.toggle')"
                    @click="toggleSessionDays(s.sessionId)"
                  >
                    <Icon name="chev" />
                  </Button>
                  <span
                    class="block max-w-115 cursor-pointer truncate transition-colors hover:text-primary hover:underline"
                    role="button"
                    tabindex="0"
                    :title="s.title"
                    @click="goToSession(s.sessionId)"
                    @keydown.enter="goToSession(s.sessionId)"
                  >
                    {{ s.title }}
                  </span>
                </div>
              </TableCell>
              <TableCell class="px-3.5 py-2.5 text-muted-foreground">
                <div class="flex flex-wrap items-center gap-2">
                  <!-- mono-ok: id model -->
                  <span class="font-mono">{{ s.model || '—' }}</span>
                  <Badge v-if="s.provider" variant="outline" class="text-muted-foreground">
                    {{ s.provider }}
                  </Badge>
                </div>
              </TableCell>
              <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
                {{ formatTokens(s.totalTokens) }}
              </TableCell>
              <TableCell class="px-3.5 py-2.5 text-right text-muted-foreground tabular-nums">
                {{ formatTokens(s.turns) }}
              </TableCell>
              <TableCell class="px-3.5 py-2.5 text-right text-primary tabular-nums">
                {{ formatCost(s.costUsd) }}
              </TableCell>
            </TableRow>
            <!-- Drill-down: this session's spend split by day, newest first. Same
                 pricing + filters as the row above, so the days sum to it. -->
            <TableRow v-if="isSessionExpanded(s.sessionId)" class="bg-accent hover:bg-accent">
              <TableCell colspan="5" class="pt-0 pr-3.5 pb-2.5 pl-9.5">
                <div class="flex flex-col gap-0.5">
                  <div
                    v-for="d in sessionDays(s)"
                    :key="d.date"
                    class="flex items-center gap-2.5 py-0.5"
                  >
                    <span class="shrink-0 text-sm text-dim tabular-nums">{{ d.date }}</span>
                    <span class="h-1.5 min-w-10 flex-auto overflow-hidden rounded-sm bg-muted">
                      <i
                        class="block h-full rounded-sm bg-primary"
                        :style="{ width: `${dayPct(s, d.costUsd)}%` }"
                      />
                    </span>
                    <span class="shrink-0 text-sm text-faint tabular-nums">
                      {{
                        t('activity.bySession.days.meta', {
                          tokens: formatTokens(d.totalTokens),
                          turns: d.turns,
                        })
                      }}
                    </span>
                    <span class="min-w-16 shrink-0 text-right text-sm text-primary tabular-nums">
                      {{ formatCost(d.costUsd) }}
                    </span>
                  </div>
                </div>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </Card>

    <!-- Provider rate-limit panel (one card per account) -->
    <SettingsGroupLabel>{{ t('activity.rateLimit.title') }}</SettingsGroupLabel>
    <Card v-if="!rateLimitAccounts.length" class="gap-0 overflow-hidden p-0 shadow-none">
      <div class="px-4 py-4.5 text-sm text-faint">{{ t('activity.rateLimit.empty') }}</div>
    </Card>
    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3.5">
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
import type { ActivityBySession, ActivityRange, SessionSort } from '~/composables/useActivity'
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

// Segmented (SettingsSeg) giữ model kiểu string — cầu nối sang union của useActivity.
const rangeOptions = computed(() =>
  ACTIVITY_RANGES.map((r) => ({ label: t(`activity.range.${r}`), value: r })),
)
const rangeValue = computed<string>({
  get: () => range.value,
  set: (value) => {
    range.value = value as ActivityRange
  },
})
const sessionSortOptions = computed(() =>
  SESSION_SORTS.map((s) => ({ label: t(`activity.bySession.sort.${s}`), value: s })),
)
const sessionSortValue = computed<string>({
  get: () => sessionSort.value,
  set: (value) => {
    sessionSort.value = value as SessionSort
  },
})
</script>
