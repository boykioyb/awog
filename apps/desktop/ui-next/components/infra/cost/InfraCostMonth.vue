<template>
  <!-- Tab con "Tháng này" của nhóm Chi phí (Mốc 7, việc 7.1).
       Tách khỏi `InfraCost.vue` ngày 2026-09-16: ba khối cũ nằm chung một màn cuộn
       dài, và hai trong ba khối TỐN TIỀN THẬT mỗi lần bấm (Cost Explorer tính theo
       request, dò lãng phí gọi hàng loạt `describe-*`). Gộp chúng vào một màn khiến
       người dùng cuộn qua một nút tính tiền để tới nút kia; tách ra thì mỗi màn chỉ
       còn đúng một câu hỏi và đúng một cái giá.

       Vỏ chung (tiêu đề · cổng kiểm tài khoản · chip câu hỏi) ở `InfraCost.vue`. -->
  <!-- ── 7.1 Chi phí ────────────────────────────────────────────────── -->
  <section class="icst-sec">
    <div class="icst-sec-hd">
      <span class="icst-sec-ttl">{{ t('infra.cost.month.title') }}</span>
      <span class="icst-hint">{{ t('infra.cost.month.priceWhy') }}</span>
      <span class="icst-gap" />
      <button
        class="btn sm pri"
        type="button"
        :disabled="summaryLoading"
        :aria-busy="summaryLoading"
        @click="loadSummary(false)"
      >
        <Icon name="play" class="icst-ic" />
        {{ t('infra.cost.month.load') }}
      </button>
      <button
        class="btn sm"
        type="button"
        :disabled="summaryLoading || !summary"
        :title="t('infra.cost.month.reloadWhy')"
        @click="loadSummary(true)"
      >
        <Icon name="refresh" class="icst-ic" :class="summaryLoading ? 'icst-spin' : ''" />
        {{ t('infra.cost.month.reload') }}
      </button>
    </div>

    <p v-if="summaryError" class="ierr">{{ summaryError }}</p>

    <template v-if="summary">
      <div class="icst-tiles">
        <div class="icst-tile">
          <span class="icst-tile-lbl">{{ t('infra.cost.tile.spent') }}</span>
          <span class="icst-tile-val">{{ usd(summary.totalUsd) }}</span>
          <span class="icst-tile-foot">{{ summary.periodStart }} → {{ summary.periodEnd }}</span>
        </div>
        <div class="icst-tile">
          <span class="icst-tile-lbl">{{ t('infra.cost.tile.forecast') }}</span>
          <!-- Dự báo do AWS tính. Không có thì nói VÌ SAO, không hiện ô trống. -->
          <span v-if="summary.forecastUsd !== null" class="icst-tile-val">
            {{ usd(summary.forecastUsd) }}
          </span>
          <span v-else class="icst-tile-val ic-muted">—</span>
          <span class="icst-tile-foot">
            {{ summary.forecastError ?? t('infra.cost.tile.forecastWhy') }}
          </span>
        </div>
        <div class="icst-tile">
          <span class="icst-tile-lbl">{{ t('infra.cost.tile.previous') }}</span>
          <span class="icst-tile-val">{{ usd(summary.previousTotalUsd) }}</span>
          <span class="icst-tile-foot" :class="deltaUsd > 0 ? 'icst-up' : 'icst-down'">
            {{ deltaUsd >= 0 ? '+' : '' }}{{ usd(deltaUsd) }}
          </span>
        </div>
        <div class="icst-tile">
          <span class="icst-tile-lbl">{{ t('infra.cost.tile.calls') }}</span>
          <span class="icst-tile-val">{{ usd(summary.estimatedUsd) }}</span>
          <span class="icst-tile-foot">
            {{
              summary.calls === 0
                ? t('infra.cost.tile.fromCache', { d: summary.asOf })
                : t('infra.cost.tile.callCount', { n: summary.calls })
            }}
          </span>
        </div>
      </div>

      <div class="icst-cols">
        <div class="icst-col">
          <span class="icst-col-ttl">{{ t('infra.cost.table.top') }}</span>
          <ul class="icst-rows">
            <li v-for="s in summary.services" :key="s.service" class="icst-row">
              <span class="icst-row-name">{{ s.service }}</span>
              <span class="icst-row-val tnum">{{ usd(s.amountUsd) }}</span>
            </li>
            <li v-if="summary.services.length === 0" class="icst-empty">
              {{ t('infra.cost.table.none') }}
            </li>
          </ul>
        </div>
        <div class="icst-col">
          <span class="icst-col-ttl">{{ t('infra.cost.table.increases') }}</span>
          <ul class="icst-rows">
            <li v-for="s in summary.topIncreases" :key="s.service" class="icst-row">
              <span class="icst-row-name">{{ s.service }}</span>
              <span class="icst-row-val tnum ic-up">+{{ usd(s.deltaUsd) }}</span>
            </li>
            <li v-if="summary.topIncreases.length === 0" class="icst-empty">
              {{ t('infra.cost.table.noIncrease') }}
            </li>
          </ul>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
// Lớp bind của tab con "Tháng này". State + RPC ở `useInfraCost()` (singleton cấp
// module), nên ba tab con cùng đọc một kho — đổi tab không mất số đã tải.
import { useInfraCost } from '~/composables/useInfraCost'

const { t } = useI18n()

const { summary, summaryLoading, summaryError, loadSummary, deltaUsd } = useInfraCost()

/** Hai chữ số, luôn có ký hiệu tiền — mọi con số trên màn này là USD. */
function usd(v: number): string {
  return `$${v.toFixed(2)}`
}
</script>

<style scoped>
/* Vỏ khối (`.icst-sec*`, `.icst-hint`, `.icst-ic`, `.icst-spin`) lặp ở cả ba tab con.
   Cố ý: ba bản sao của bảy luật ngắn rẻ hơn một stylesheet dùng chung hoặc một
   chuỗi `:deep()` từ component cha — và giữ mỗi tab con đọc được một mình. */
.icst-sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.icst-sec-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.icst-sec-ttl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

.icst-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.icst-gap {
  flex: 1;
}

.icst-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.icst-tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
}

.icst-tile-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.icst-tile-val {
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.icst-tile-foot {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.icst-up {
  color: var(--amber);
}

.icst-down {
  color: var(--textFaint);
}

.icst-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}

.icst-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.icst-col-ttl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}

.icst-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.icst-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.icst-row-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icst-row-val {
  color: var(--textDim);
}

.icst-empty {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.icst-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex-shrink: 0;
}

.icst-spin {
  animation: icst-rot 1s linear infinite;
}

@keyframes icst-rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
