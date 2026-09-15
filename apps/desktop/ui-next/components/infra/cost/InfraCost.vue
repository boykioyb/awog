<template>
  <!-- Tab "Chi phí" của `/infra` (Mốc 7, 7.1 · 7.2 · 7.3).
       Hai khối rời nhau vì chúng trả lời hai câu hỏi khác nhau và TỐN TIỀN KHÁC NHAU:
         · trên  — "tháng này hết bao nhiêu, cuối tháng sẽ là bao nhiêu" (3 request `ce`),
         · dưới  — "có gì đang đốt tiền mà không ai dùng" (nhiều `describe-*`, cộng metric
           nếu người dùng bật hai phép dò trả tiền).
       Không khối nào tự chạy; mỗi khối một nút. -->
  <div class="icst">
    <header class="icst-hd">
      <div class="icst-hd-txt">
        <h2 class="icst-ttl">{{ t('infra.cost.title') }}</h2>
        <p class="icst-sub">{{ t('infra.cost.subtitle') }}</p>
      </div>
    </header>

    <p v-if="!sidecarAvailable" class="icst-state">{{ t('infra.cost.noSidecar') }}</p>
    <p v-else-if="!hasAccount" class="icst-state">{{ t('infra.cost.noProfile') }}</p>

    <template v-else>
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
              <span class="icst-tile-foot">
                {{ summary.periodStart }} → {{ summary.periodEnd }}
              </span>
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

      <!-- ── 7.4 Ngân sách ──────────────────────────────────────────────── -->
      <section class="icst-sec">
        <div class="icst-sec-hd">
          <span class="icst-sec-ttl">{{ t('infra.cost.budget.title') }}</span>
          <span class="icst-hint">{{ t('infra.cost.budget.why') }}</span>
          <span class="icst-gap" />
          <button
            class="btn sm"
            type="button"
            :disabled="budgetsLoading || !accountId"
            :aria-busy="budgetsLoading"
            @click="loadBudgets"
          >
            <Icon name="refresh" class="icst-ic" :class="budgetsLoading ? 'icst-spin' : ''" />
            {{ t('infra.cost.budget.load') }}
          </button>
        </div>

        <!-- Budgets đòi `--account-id` tường minh. Chưa giải được id thì nói ra và tắt
             nút, thay vì để người dùng bấm vào một lệnh chắc chắn hỏng. -->
        <p v-if="!accountId" class="icst-empty">{{ t('infra.cost.budget.noAccountId') }}</p>
        <p v-else-if="budgetsError" class="ierr">{{ budgetsError }}</p>

        <template v-if="budgets">
          <ul v-if="budgets.length" class="icst-rows">
            <li v-for="b in budgets" :key="b.name" class="icst-row">
              <span class="icst-row-name">{{ b.name }}</span>
              <span class="icst-muted">{{ b.timeUnit }}</span>
              <span class="icst-row-val tnum">
                {{ b.actualUsd === null ? '—' : usd(b.actualUsd) }}
                /
                {{ b.limitUsd === null ? '—' : usd(b.limitUsd) }}
              </span>
            </li>
          </ul>
          <p v-else class="icst-empty">{{ t('infra.cost.budget.none') }}</p>
        </template>

        <!-- Đặt ngân sách là lượt GHI duy nhất của tab này: nó đi qua ma trận quyền và
             có thể dừng ở hộp duyệt. Ba ô, không hơn. -->
        <div class="icst-budget-form">
          <input
            v-model="budgetName"
            class="icst-inp"
            type="text"
            maxlength="100"
            :placeholder="t('infra.cost.budget.namePlaceholder')"
          />
          <input
            v-model.number="budgetLimit"
            class="icst-inp ic-inp-sm"
            type="number"
            min="1"
            step="1"
            :placeholder="t('infra.cost.budget.limitPlaceholder')"
          />
          <input
            v-model="budgetEmails"
            class="icst-inp"
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
            <Icon name="check" class="icst-ic" />
            {{ t('infra.cost.budget.save') }}
          </button>
        </div>
        <p class="icst-hint">{{ t('infra.cost.budget.thresholdWhy') }}</p>
      </section>

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
                  <input
                    type="checkbox"
                    :checked="picked.has(findingKey(f))"
                    @change="togglePick(f)"
                  />
                </td>
                <td>{{ t(`infra.cost.check.${f.check}.label`) }}</td>
                <td class="icst-res">{{ f.label }}</td>
                <td class="icst-muted">{{ detailText(f) }}</td>
                <td class="icst-right tnum">
                  <!-- `null` hiện "—", KHÔNG hiện 0: "không biết giá" khác "miễn phí". -->
                  <template v-if="f.monthlyUsd === null">—</template>
                  <template v-else>
                    {{ f.overEstimate ? '≤ ' : '' }}{{ usd(f.monthlyUsd) }}
                  </template>
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
      <!-- Luật 4 của infra-README: chip câu hỏi thay cho ô trống. Cùng khuôn với màn
           Giám sát — tắt khi chưa có số liệu nào, vì câu trả lời sẽ rỗng. -->
      <div class="icst-ask">
        <span class="icst-hint">{{ t('infra.cost.title') }}</span>
        <button
          v-for="s in askSuggestions"
          :key="s.key"
          type="button"
          class="icst-chip"
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
/* Tiền tố `icst-`, KHÔNG phải `ic-`: `prototype.css` có một class TOÀN CỤC `.ic` là
   inline code (mono · nền --bgActive · .92em). Đặt root màn là `.ic` thì cả màn bị
   render như một đoạn code — đúng chuyện đã xảy ra ở đây và ở màn Triển khai. */
.icst {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.icst-hd-txt {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.icst-ttl {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}

.icst-sub {
  margin: 0;
  max-width: 72ch;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}

.icst-state {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--textDim);
}

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

.icst-muted {
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

.icst-budget-form {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.icst-inp {
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

.icst-inp-sm {
  flex: 0 0 110px;
  min-width: 90px;
}

.icst-acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.icst-ask {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.icst-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}

.icst-chip:hover:not(:disabled) {
  border-color: var(--accentBorder);
  color: var(--accent);
}

.icst-chip:disabled {
  opacity: 0.45;
  cursor: default;
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
