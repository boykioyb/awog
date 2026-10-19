<template>
  <!-- Tab con "Tháng này" của nhóm Chi phí (Mốc 7, việc 7.1).
       Tách khỏi `InfraCost.vue` ngày 2026-09-16: ba khối cũ nằm chung một màn cuộn
       dài, và hai trong ba khối TỐN TIỀN THẬT mỗi lần bấm (Cost Explorer tính theo
       request, dò lãng phí gọi hàng loạt `describe-*`). Gộp chúng vào một màn khiến
       người dùng cuộn qua một nút tính tiền để tới nút kia; tách ra thì mỗi màn chỉ
       còn đúng một câu hỏi và đúng một cái giá.

       Vỏ chung (tiêu đề · cổng kiểm tài khoản · chip câu hỏi) ở `InfraCost.vue`. -->
  <!-- ── 7.1 Chi phí ────────────────────────────────────────────────── -->
  <Card class="gap-2.5 px-3.5 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-base text-foreground">{{ t('infra.cost.month.title') }}</span>
      <span class="text-xs text-faint">{{ t('infra.cost.month.priceWhy') }}</span>
      <span class="flex-1" />
      <Button
        type="button"
        :disabled="summaryLoading"
        :aria-busy="summaryLoading"
        variant="default"
        size="sm"
        @click="loadSummary(false)"
      >
        <Icon name="play" class="size-3" />
        {{ t('infra.cost.month.load') }}
      </Button>
      <Button
        type="button"
        :disabled="summaryLoading || !summary"
        :title="t('infra.cost.month.reloadWhy')"
        variant="outline"
        size="sm"
        @click="loadSummary(true)"
      >
        <Icon name="refresh" class="size-3" :class="summaryLoading ? 'animate-spin' : ''" />
        {{ t('infra.cost.month.reload') }}
      </Button>
    </div>

    <p v-if="summaryError" class="m-0 text-xs text-destructive">{{ summaryError }}</p>

    <template v-if="summary">
      <div class="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        <Card class="gap-1 px-3 py-2.5">
          <span class="text-xs text-dim">{{ t('infra.cost.tile.spent') }}</span>
          <span class="text-xl text-foreground tabular-nums">{{ usd(summary.totalUsd) }}</span>
          <span class="text-xs text-faint">
            {{ summary.periodStart }} → {{ summary.periodEnd }}
          </span>
        </Card>
        <Card class="gap-1 px-3 py-2.5">
          <span class="text-xs text-dim">{{ t('infra.cost.tile.forecast') }}</span>
          <!-- Dự báo do AWS tính. Không có thì nói VÌ SAO, không hiện ô trống. -->
          <span v-if="summary.forecastUsd !== null" class="text-xl text-foreground tabular-nums">
            {{ usd(summary.forecastUsd) }}
          </span>
          <span v-else class="text-xl text-faint tabular-nums">—</span>
          <span class="text-xs text-faint">
            {{ summary.forecastError ?? t('infra.cost.tile.forecastWhy') }}
          </span>
        </Card>
        <Card class="gap-1 px-3 py-2.5">
          <span class="text-xs text-dim">{{ t('infra.cost.tile.previous') }}</span>
          <span class="text-xl text-foreground tabular-nums">
            {{ usd(summary.previousTotalUsd) }}
          </span>
          <span class="text-xs" :class="deltaUsd > 0 ? 'text-warning' : 'text-faint'">
            {{ deltaUsd >= 0 ? '+' : '' }}{{ usd(deltaUsd) }}
          </span>
        </Card>
        <Card class="gap-1 px-3 py-2.5">
          <span class="text-xs text-dim">{{ t('infra.cost.tile.calls') }}</span>
          <span class="text-xl text-foreground tabular-nums">{{ usd(summary.estimatedUsd) }}</span>
          <span class="text-xs text-faint">
            {{
              summary.calls === 0
                ? t('infra.cost.tile.fromCache', { d: summary.asOf })
                : t('infra.cost.tile.callCount', { n: summary.calls })
            }}
          </span>
        </Card>
      </div>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2.5">
        <div class="flex flex-col gap-1.5">
          <span class="text-sm text-dim">{{ t('infra.cost.table.top') }}</span>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <li
              v-for="s in summary.services"
              :key="s.service"
              class="flex items-baseline gap-2 py-0.5 text-sm"
            >
              <span class="min-w-0 flex-1 truncate text-foreground">{{ s.service }}</span>
              <span class="text-dim tabular-nums">{{ usd(s.amountUsd) }}</span>
            </li>
            <li v-if="summary.services.length === 0" class="m-0 text-xs text-faint">
              {{ t('infra.cost.table.none') }}
            </li>
          </ul>
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-sm text-dim">{{ t('infra.cost.table.increases') }}</span>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            <li
              v-for="s in summary.topIncreases"
              :key="s.service"
              class="flex items-baseline gap-2 py-0.5 text-sm"
            >
              <span class="min-w-0 flex-1 truncate text-foreground">{{ s.service }}</span>
              <span class="text-dim tabular-nums">+{{ usd(s.deltaUsd) }}</span>
            </li>
            <li v-if="summary.topIncreases.length === 0" class="m-0 text-xs text-faint">
              {{ t('infra.cost.table.noIncrease') }}
            </li>
          </ul>
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
// Lớp bind của tab con "Tháng này". State + RPC ở `useInfraCost()` (singleton cấp
// module), nên ba tab con cùng đọc một kho — đổi tab không mất số đã tải.
import { useInfraCost } from '~/composables/useInfraCost'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()

const { summary, summaryLoading, summaryError, loadSummary, deltaUsd } = useInfraCost()

/** Hai chữ số, luôn có ký hiệu tiền — mọi con số trên màn này là USD. */
function usd(v: number): string {
  return `$${v.toFixed(2)}`
}
</script>
