<template>
  <!-- Tab con "Ngân sách" của nhóm Chi phí (Mốc 7, việc 7.4).
       Xem `InfraCostMonth.vue` cho lý do tách. Đây là màn DUY NHẤT trong nhóm ghi
       ra AWS (`create-budget`/`update-budget` đi qua cổng quyền) — đứng riêng thì
       ranh giới đọc/ghi của cả nhóm nhìn thấy được từ thanh tab. -->
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
</template>

<script setup lang="ts">
// Lớp bind của tab con "Ngân sách". State + RPC ở `useInfraCost()` (xem InfraCostMonth).
import { computed, ref } from 'vue'
import { useInfraCost } from '~/composables/useInfraCost'

const { t } = useI18n()

const { accountId, budgets, budgetsLoading, budgetsError, budgetSaving, loadBudgets, saveBudget } =
  useInfraCost()

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
