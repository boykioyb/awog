<template>
  <!-- Tab con "Lãng phí" của nhóm Chi phí (Mốc 7, việc 7.2 · 7.3).
       Xem `InfraCostMonth.vue` cho lý do tách. Hai phép dò có tính tiền
       (`ec2-idle`, `nat-idle`) mặc định TẮT và nói ra giá ngay tại ô bật. -->
  <!-- ── 7.2 Dò lãng phí ────────────────────────────────────────────── -->
  <section class="icst-sec">
    <div class="icst-sec-hd">
      <span class="icst-sec-ttl">{{ t('infra.cost.waste.title') }}</span>
      <span class="icst-hint">{{ t('infra.cost.waste.regionWhy', { r: region || '—' }) }}</span>
      <span class="icst-gap" />
      <button
        class="btn sm pri"
        type="button"
        :disabled="wasteLoading || enabled.size === 0"
        :aria-busy="wasteLoading"
        @click="scanWaste"
      >
        <Icon name="search" class="icst-ic" :class="wasteLoading ? 'icst-spin' : ''" />
        {{ t('infra.cost.waste.scan') }}
      </button>
    </div>

    <!-- Bảy công tắc. Hai phép trả tiền mang nhãn riêng và mặc định TẮT — bật chúng
         là thêm một lô `get-metric-data` vào lượt dò, và người dùng phải biết trước. -->
    <div class="icst-checks">
      <label
        v-for="c in checks"
        :key="c"
        class="icst-check"
        :class="{ paid: paidChecks.includes(c) }"
        :title="t(`infra.cost.check.${c}.why`)"
      >
        <input type="checkbox" :checked="enabled.has(c)" @change="toggleCheck(c)" />
        {{ t(`infra.cost.check.${c}.label`) }}
        <span v-if="paidChecks.includes(c)" class="icst-paid">
          {{ t('infra.cost.waste.paid') }}
        </span>
      </label>
    </div>
    <p v-if="paidEnabled > 0" class="iwarn">
      {{ t('infra.cost.waste.paidWarn', { n: paidEnabled }) }}
    </p>

    <p v-if="wasteError" class="ierr">{{ wasteError }}</p>

    <template v-if="report">
      <!-- Phép dò HỎNG phải hiện ra. Nuốt nó đi thì bảng trông như đã sạch. -->
      <ul v-if="report.failed.length" class="icst-failed">
        <li v-for="f in report.failed" :key="f.check">
          {{ t('infra.cost.waste.failed', { c: t(`infra.cost.check.${f.check}.label`) }) }}
          — {{ f.error }}
        </li>
      </ul>

      <div class="icst-sum">
        <span>
          {{ t('infra.cost.waste.found', { n: report.findings.length }) }}
          · {{ t('infra.cost.waste.total', { v: usd(report.totalMonthlyUsd) }) }}
        </span>
        <span v-if="report.unpricedCount > 0" class="icst-muted">
          {{ t('infra.cost.waste.unpriced', { n: report.unpricedCount }) }}
        </span>
        <span v-if="pricing" class="icst-muted">
          {{ t('infra.cost.waste.pricingWhy', { d: pricing.asOf, r: pricing.region }) }}
        </span>
      </div>

      <table v-if="report.findings.length" class="icst-tbl">
        <thead>
          <tr>
            <th class="icst-pick">
              <input
                type="checkbox"
                :checked="picked.size === report.findings.length && picked.size > 0"
                :title="t('infra.cost.waste.pickAll')"
                @change="pickAll"
              />
            </th>
            <th>{{ t('infra.cost.waste.col.check') }}</th>
            <th>{{ t('infra.cost.waste.col.resource') }}</th>
            <th>{{ t('infra.cost.waste.col.detail') }}</th>
            <th class="icst-right">{{ t('infra.cost.waste.col.monthly') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in report.findings" :key="findingKey(f)">
            <td class="icst-pick">
              <input type="checkbox" :checked="picked.has(findingKey(f))" @change="togglePick(f)" />
            </td>
            <td>{{ t(`infra.cost.check.${f.check}.label`) }}</td>
            <td class="icst-res">{{ f.label }}</td>
            <td class="icst-muted">{{ detailText(f) }}</td>
            <td class="icst-right tnum">
              <!-- `null` hiện "—", KHÔNG hiện 0: "không biết giá" khác "miễn phí". -->
              <template v-if="f.monthlyUsd === null">—</template>
              <template v-else>{{ f.overEstimate ? '≤ ' : '' }}{{ usd(f.monthlyUsd) }}</template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="icst-empty">{{ t('infra.cost.waste.clean') }}</p>

      <!-- ── 7.3 ──────────────────────────────────────────────────── -->
      <div v-if="report.findings.length" class="icst-acts">
        <button
          class="btn sm pri"
          type="button"
          :disabled="pickedFindings.length === 0 || building"
          @click="onCleanup"
        >
          <Icon name="book" class="icst-ic" />
          {{ t('infra.cost.cleanup.build', { n: pickedFindings.length }) }}
        </button>
        <span v-if="pickedFindings.length" class="icst-hint">
          {{ t('infra.cost.cleanup.picked', { v: usd(pickedMonthlyUsd) }) }}
        </span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
// Lớp bind của tab con "Lãng phí". State + RPC ở `useInfraCost()` (xem InfraCostMonth);
// hình dạng lệnh AWS của playbook dọn dẹp ở SIDECAR (`infra/cost/cleanup.ts`) —
// renderer không dựng argv.
import { ref } from 'vue'
import { findingKey, useInfraCost } from '~/composables/useInfraCost'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'
import { usePlaybookEditor } from '~/composables/usePlaybookEditor'
import type { WasteFinding } from '~/composables/useInfraCost'

const { t } = useI18n()
const { openGenerated } = usePlaybookEditor()
const { request: requestTab } = useInfraTabOpen()

const {
  region,
  report,
  wasteLoading,
  wasteError,
  pricing,
  paidChecks,
  enabled,
  toggleCheck,
  paidEnabled,
  scanWaste,
  checks,
  picked,
  togglePick,
  pickAll,
  pickedFindings,
  pickedMonthlyUsd,
  buildCleanupDraft,
} = useInfraCost()

const building = ref(false)

/** Hai chữ số, luôn có ký hiệu tiền — mọi con số trên màn này là USD. */
function usd(v: number): string {
  return `$${v.toFixed(2)}`
}

function detailText(f: WasteFinding): string {
  return Object.entries(f.detail)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
}

/**
 * Sinh kế hoạch dọn dẹp rồi MỞ TRÌNH SOẠN — không lưu, không chạy.
 *
 * Màn Kế hoạch là một TAB của chính `/infra`, nên đây chỉ còn là một cú đổi tab chứ
 * không phải điều hướng. `usePlaybookEditor` giữ bản nháp ở mức module nên nó sống
 * qua cú đổi tab; hộp thoại chỉ được mount trong tab kia.
 */
async function onCleanup(): Promise<void> {
  building.value = true
  try {
    const draft = await buildCleanupDraft()
    if (!draft) return
    openGenerated(draft)
    requestTab('playbooks')
  } finally {
    building.value = false
  }
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

.icst-muted {
  color: var(--textFaint);
}

.icst-empty {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.icst-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.icst-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  white-space: nowrap;
}

.icst-paid {
  padding: 0 6px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}

.icst-failed {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding-left: 18px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--danger);
}

.icst-sum {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}

.icst-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.icst-tbl th {
  text-align: left;
  padding: 5px 8px;
  color: var(--textDim);
  font-weight: 500;
  box-shadow: inset 0 -1px 0 var(--border);
}

.icst-tbl td {
  padding: 5px 8px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.icst-right {
  text-align: right;
}

.icst-pick {
  width: 28px;
}

.icst-res {
  font-family: var(--code); /* mono-ok: id tài nguyên, người dùng copy vào lệnh aws */
  word-break: break-all;
}

.icst-acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
