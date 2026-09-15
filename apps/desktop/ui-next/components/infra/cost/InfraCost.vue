<template>
  <!-- Tab "Chi phí" của `/infra` (Mốc 7, 7.1 · 7.2 · 7.3).
       Hai khối rời nhau vì chúng trả lời hai câu hỏi khác nhau và TỐN TIỀN KHÁC NHAU:
         · trên  — "tháng này hết bao nhiêu, cuối tháng sẽ là bao nhiêu" (3 request `ce`),
         · dưới  — "có gì đang đốt tiền mà không ai dùng" (nhiều `describe-*`, cộng metric
           nếu người dùng bật hai phép dò trả tiền).
       Không khối nào tự chạy; mỗi khối một nút. -->
  <div class="ic">
    <header class="ic-hd">
      <div class="ic-hd-txt">
        <h2 class="ic-ttl">{{ t('infra.cost.title') }}</h2>
        <p class="ic-sub">{{ t('infra.cost.subtitle') }}</p>
      </div>
    </header>

    <p v-if="!sidecarAvailable" class="ic-state">{{ t('infra.cost.noSidecar') }}</p>
    <p v-else-if="!hasAccount" class="ic-state">{{ t('infra.cost.noProfile') }}</p>

    <template v-else>
      <!-- ── 7.1 Chi phí ────────────────────────────────────────────────── -->
      <section class="ic-sec">
        <div class="ic-sec-hd">
          <span class="ic-sec-ttl">{{ t('infra.cost.month.title') }}</span>
          <span class="ic-hint">{{ t('infra.cost.month.priceWhy') }}</span>
          <span class="ic-gap" />
          <button
            class="btn sm pri"
            type="button"
            :disabled="summaryLoading"
            :aria-busy="summaryLoading"
            @click="loadSummary(false)"
          >
            <Icon name="play" class="ic-ic" />
            {{ t('infra.cost.month.load') }}
          </button>
          <button
            class="btn sm"
            type="button"
            :disabled="summaryLoading || !summary"
            :title="t('infra.cost.month.reloadWhy')"
            @click="loadSummary(true)"
          >
            <Icon name="refresh" class="ic-ic" :class="summaryLoading ? 'ic-spin' : ''" />
            {{ t('infra.cost.month.reload') }}
          </button>
        </div>

        <p v-if="summaryError" class="ierr">{{ summaryError }}</p>

        <template v-if="summary">
          <div class="ic-tiles">
            <div class="ic-tile">
              <span class="ic-tile-lbl">{{ t('infra.cost.tile.spent') }}</span>
              <span class="ic-tile-val">{{ usd(summary.totalUsd) }}</span>
              <span class="ic-tile-foot">{{ summary.periodStart }} → {{ summary.periodEnd }}</span>
            </div>
            <div class="ic-tile">
              <span class="ic-tile-lbl">{{ t('infra.cost.tile.forecast') }}</span>
              <!-- Dự báo do AWS tính. Không có thì nói VÌ SAO, không hiện ô trống. -->
              <span v-if="summary.forecastUsd !== null" class="ic-tile-val">
                {{ usd(summary.forecastUsd) }}
              </span>
              <span v-else class="ic-tile-val ic-muted">—</span>
              <span class="ic-tile-foot">
                {{ summary.forecastError ?? t('infra.cost.tile.forecastWhy') }}
              </span>
            </div>
            <div class="ic-tile">
              <span class="ic-tile-lbl">{{ t('infra.cost.tile.previous') }}</span>
              <span class="ic-tile-val">{{ usd(summary.previousTotalUsd) }}</span>
              <span class="ic-tile-foot" :class="deltaUsd > 0 ? 'ic-up' : 'ic-down'">
                {{ deltaUsd >= 0 ? '+' : '' }}{{ usd(deltaUsd) }}
              </span>
            </div>
            <div class="ic-tile">
              <span class="ic-tile-lbl">{{ t('infra.cost.tile.calls') }}</span>
              <span class="ic-tile-val">{{ usd(summary.estimatedUsd) }}</span>
              <span class="ic-tile-foot">
                {{
                  summary.calls === 0
                    ? t('infra.cost.tile.fromCache', { d: summary.asOf })
                    : t('infra.cost.tile.callCount', { n: summary.calls })
                }}
              </span>
            </div>
          </div>

          <div class="ic-cols">
            <div class="ic-col">
              <span class="ic-col-ttl">{{ t('infra.cost.table.top') }}</span>
              <ul class="ic-rows">
                <li v-for="s in summary.services" :key="s.service" class="ic-row">
                  <span class="ic-row-name">{{ s.service }}</span>
                  <span class="ic-row-val tnum">{{ usd(s.amountUsd) }}</span>
                </li>
                <li v-if="summary.services.length === 0" class="ic-empty">
                  {{ t('infra.cost.table.none') }}
                </li>
              </ul>
            </div>
            <div class="ic-col">
              <span class="ic-col-ttl">{{ t('infra.cost.table.increases') }}</span>
              <ul class="ic-rows">
                <li v-for="s in summary.topIncreases" :key="s.service" class="ic-row">
                  <span class="ic-row-name">{{ s.service }}</span>
                  <span class="ic-row-val tnum ic-up">+{{ usd(s.deltaUsd) }}</span>
                </li>
                <li v-if="summary.topIncreases.length === 0" class="ic-empty">
                  {{ t('infra.cost.table.noIncrease') }}
                </li>
              </ul>
            </div>
          </div>
        </template>
      </section>

      <!-- ── 7.4 Ngân sách ──────────────────────────────────────────────── -->
      <section class="ic-sec">
        <div class="ic-sec-hd">
          <span class="ic-sec-ttl">{{ t('infra.cost.budget.title') }}</span>
          <span class="ic-hint">{{ t('infra.cost.budget.why') }}</span>
          <span class="ic-gap" />
          <button
            class="btn sm"
            type="button"
            :disabled="budgetsLoading || !accountId"
            :aria-busy="budgetsLoading"
            @click="loadBudgets"
          >
            <Icon name="refresh" class="ic-ic" :class="budgetsLoading ? 'ic-spin' : ''" />
            {{ t('infra.cost.budget.load') }}
          </button>
        </div>

        <!-- Budgets đòi `--account-id` tường minh. Chưa giải được id thì nói ra và tắt
             nút, thay vì để người dùng bấm vào một lệnh chắc chắn hỏng. -->
        <p v-if="!accountId" class="ic-empty">{{ t('infra.cost.budget.noAccountId') }}</p>
        <p v-else-if="budgetsError" class="ierr">{{ budgetsError }}</p>

        <template v-if="budgets">
          <ul v-if="budgets.length" class="ic-rows">
            <li v-for="b in budgets" :key="b.name" class="ic-row">
              <span class="ic-row-name">{{ b.name }}</span>
              <span class="ic-muted">{{ b.timeUnit }}</span>
              <span class="ic-row-val tnum">
                {{ b.actualUsd === null ? '—' : usd(b.actualUsd) }}
                /
                {{ b.limitUsd === null ? '—' : usd(b.limitUsd) }}
              </span>
            </li>
          </ul>
          <p v-else class="ic-empty">{{ t('infra.cost.budget.none') }}</p>
        </template>

        <!-- Đặt ngân sách là lượt GHI duy nhất của tab này: nó đi qua ma trận quyền và
             có thể dừng ở hộp duyệt. Ba ô, không hơn. -->
        <div class="ic-budget-form">
          <input
            v-model="budgetName"
            class="ic-inp"
            type="text"
            maxlength="100"
            :placeholder="t('infra.cost.budget.namePlaceholder')"
          />
          <input
            v-model.number="budgetLimit"
            class="ic-inp ic-inp-sm"
            type="number"
            min="1"
            step="1"
            :placeholder="t('infra.cost.budget.limitPlaceholder')"
          />
          <input
            v-model="budgetEmails"
            class="ic-inp"
            type="text"
            autocomplete="off"
            :placeholder="t('infra.cost.budget.emailsPlaceholder')"
            :title="t('infra.cost.budget.emailsWhy')"
          />
          <button
            class="btn sm pri"
            type="button"
            :disabled="!canSaveBudget"
            :aria-busy="budgetSaving"
            @click="onSaveBudget"
          >
            <Icon name="check" class="ic-ic" />
            {{ t('infra.cost.budget.save') }}
          </button>
        </div>
        <p class="ic-hint">{{ t('infra.cost.budget.thresholdWhy') }}</p>
      </section>

      <!-- ── 7.2 Dò lãng phí ────────────────────────────────────────────── -->
      <section class="ic-sec">
        <div class="ic-sec-hd">
          <span class="ic-sec-ttl">{{ t('infra.cost.waste.title') }}</span>
          <span class="ic-hint">{{ t('infra.cost.waste.regionWhy', { r: region || '—' }) }}</span>
          <span class="ic-gap" />
          <button
            class="btn sm pri"
            type="button"
            :disabled="wasteLoading || enabled.size === 0"
            :aria-busy="wasteLoading"
            @click="scanWaste"
          >
            <Icon name="search" class="ic-ic" :class="wasteLoading ? 'ic-spin' : ''" />
            {{ t('infra.cost.waste.scan') }}
          </button>
        </div>

        <!-- Bảy công tắc. Hai phép trả tiền mang nhãn riêng và mặc định TẮT — bật chúng
             là thêm một lô `get-metric-data` vào lượt dò, và người dùng phải biết trước. -->
        <div class="ic-checks">
          <label
            v-for="c in checks"
            :key="c"
            class="ic-check"
            :class="{ paid: paidChecks.includes(c) }"
            :title="t(`infra.cost.check.${c}.why`)"
          >
            <input type="checkbox" :checked="enabled.has(c)" @change="toggleCheck(c)" />
            {{ t(`infra.cost.check.${c}.label`) }}
            <span v-if="paidChecks.includes(c)" class="ic-paid">
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
          <ul v-if="report.failed.length" class="ic-failed">
            <li v-for="f in report.failed" :key="f.check">
              {{ t('infra.cost.waste.failed', { c: t(`infra.cost.check.${f.check}.label`) }) }}
              — {{ f.error }}
            </li>
          </ul>

          <div class="ic-sum">
            <span>
              {{ t('infra.cost.waste.found', { n: report.findings.length }) }}
              · {{ t('infra.cost.waste.total', { v: usd(report.totalMonthlyUsd) }) }}
            </span>
            <span v-if="report.unpricedCount > 0" class="ic-muted">
              {{ t('infra.cost.waste.unpriced', { n: report.unpricedCount }) }}
            </span>
            <span v-if="pricing" class="ic-muted">
              {{ t('infra.cost.waste.pricingWhy', { d: pricing.asOf, r: pricing.region }) }}
            </span>
          </div>

          <table v-if="report.findings.length" class="ic-tbl">
            <thead>
              <tr>
                <th class="ic-pick">
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
                <th class="ic-right">{{ t('infra.cost.waste.col.monthly') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="f in report.findings" :key="findingKey(f)">
                <td class="ic-pick">
                  <input
                    type="checkbox"
                    :checked="picked.has(findingKey(f))"
                    @change="togglePick(f)"
                  />
                </td>
                <td>{{ t(`infra.cost.check.${f.check}.label`) }}</td>
                <td class="ic-res">{{ f.label }}</td>
                <td class="ic-muted">{{ detailText(f) }}</td>
                <td class="ic-right tnum">
                  <!-- `null` hiện "—", KHÔNG hiện 0: "không biết giá" khác "miễn phí". -->
                  <template v-if="f.monthlyUsd === null">—</template>
                  <template v-else>
                    {{ f.overEstimate ? '≤ ' : '' }}{{ usd(f.monthlyUsd) }}
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="ic-empty">{{ t('infra.cost.waste.clean') }}</p>

          <!-- ── 7.3 ──────────────────────────────────────────────────── -->
          <div v-if="report.findings.length" class="ic-acts">
            <button
              class="btn sm pri"
              type="button"
              :disabled="pickedFindings.length === 0 || building"
              @click="onCleanup"
            >
              <Icon name="book" class="ic-ic" />
              {{ t('infra.cost.cleanup.build', { n: pickedFindings.length }) }}
            </button>
            <span v-if="pickedFindings.length" class="ic-hint">
              {{ t('infra.cost.cleanup.picked', { v: usd(pickedMonthlyUsd) }) }}
            </span>
          </div>
        </template>
      </section>
      <!-- Luật 4 của infra-README: chip câu hỏi thay cho ô trống. Cùng khuôn với màn
           Giám sát — tắt khi chưa có số liệu nào, vì câu trả lời sẽ rỗng. -->
      <div class="ic-ask">
        <span class="ic-hint">{{ t('infra.cost.title') }}</span>
        <button
          v-for="s in askSuggestions"
          :key="s.key"
          type="button"
          class="ic-chip"
          :disabled="!hasSnapshot"
          @click="ask(s.text)"
        >
          {{ s.text }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Lớp bind của tab Chi phí. Mọi state + RPC ở `useInfraCost()`; hình dạng lệnh AWS của
// playbook dọn dẹp ở SIDECAR (`infra/cost/cleanup.ts`) — renderer không dựng argv.
import { computed, ref } from 'vue'
import { findingKey, useInfraCost } from '~/composables/useInfraCost'
import { usePlaybookEditor } from '~/composables/usePlaybookEditor'
import type { WasteFinding } from '~/composables/useInfraCost'

const { t } = useI18n()
const { openGenerated } = usePlaybookEditor()

const {
  accountId,
  budgets,
  budgetsLoading,
  budgetsError,
  budgetSaving,
  loadBudgets,
  saveBudget,
  hasAccount,
  sidecarAvailable,
  region,
  summary,
  summaryLoading,
  summaryError,
  loadSummary,
  deltaUsd,
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
  askSuggestions,
  hasSnapshot,
  ask,
} = useInfraCost()

const building = ref(false)

// ── 7.4 — ô nhập ngân sách ──────────────────────────────────────────────────
const budgetName = ref('')
const budgetLimit = ref<number | null>(null)
/** Nhiều email ngăn bằng dấu phẩy; rỗng = ngân sách KHÔNG có thông báo (vẫn hữu ích). */
const budgetEmails = ref('')

const emailList = computed(() =>
  budgetEmails.value
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== ''),
)

const canSaveBudget = computed(
  () =>
    !budgetSaving.value &&
    Boolean(accountId.value) &&
    budgetName.value.trim() !== '' &&
    (budgetLimit.value ?? 0) > 0,
)

/**
 * Ngân sách trùng tên ⇒ `update-budget` thay vì `create-budget`. Đoán sai chiều là một
 * lỗi `DuplicateRecordException` mà người dùng không hiểu, hoặc một lượt tạo đè lên
 * ngân sách đang có.
 */
async function onSaveBudget(): Promise<void> {
  const name = budgetName.value.trim()
  const limitUsd = budgetLimit.value ?? 0
  const update = (budgets.value ?? []).some((b) => b.name === name)
  const ok = await saveBudget({ name, limitUsd, emails: emailList.value, update })
  if (ok) {
    budgetName.value = ''
    budgetLimit.value = null
    budgetEmails.value = ''
  }
}

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
 * Trình soạn sống ở trang `/playbooks`, nên phải điều hướng sang đó: `usePlaybookEditor`
 * giữ state ở mức module nên bản nháp sống qua cú chuyển trang, nhưng component hộp
 * thoại chỉ được mount ở trang kia.
 */
async function onCleanup(): Promise<void> {
  building.value = true
  try {
    const draft = await buildCleanupDraft()
    if (!draft) return
    openGenerated(draft)
    await navigateTo('/playbooks')
  } finally {
    building.value = false
  }
}
</script>

<style scoped>
.ic {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.ic-hd-txt {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ic-ttl {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}

.ic-sub {
  margin: 0;
  max-width: 72ch;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}

.ic-state {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--textDim);
}

.ic-sec {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.ic-sec-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ic-sec-ttl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

.ic-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.ic-gap {
  flex: 1;
}

.ic-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.ic-tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
}

.ic-tile-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.ic-tile-val {
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.ic-tile-foot {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.ic-up {
  color: var(--amber);
}

.ic-down {
  color: var(--textFaint);
}

.ic-muted {
  color: var(--textFaint);
}

.ic-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}

.ic-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ic-col-ttl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}

.ic-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ic-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ic-row-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-row-val {
  color: var(--textDim);
}

.ic-empty {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.ic-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.ic-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  white-space: nowrap;
}

.ic-paid {
  padding: 0 6px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}

.ic-failed {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding-left: 18px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--danger);
}

.ic-sum {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}

.ic-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ic-tbl th {
  text-align: left;
  padding: 5px 8px;
  color: var(--textDim);
  font-weight: 500;
  box-shadow: inset 0 -1px 0 var(--border);
}

.ic-tbl td {
  padding: 5px 8px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.ic-right {
  text-align: right;
}

.ic-pick {
  width: 28px;
}

.ic-res {
  font-family: var(--code); /* mono-ok: id tài nguyên, người dùng copy vào lệnh aws */
  word-break: break-all;
}

.ic-budget-form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ic-inp {
  flex: 1 1 200px;
  min-width: 140px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ic-inp-sm {
  flex: 0 0 110px;
  min-width: 90px;
}

.ic-acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ic-ask {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.ic-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}

.ic-chip:hover:not(:disabled) {
  border-color: var(--accentBorder);
  color: var(--accent);
}

.ic-chip:disabled {
  opacity: 0.45;
  cursor: default;
}

.ic-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex-shrink: 0;
}

.ic-spin {
  animation: ic-rot 1s linear infinite;
}

@keyframes ic-rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
