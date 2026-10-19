<template>
  <!-- Tab con "Ngân sách" của nhóm Chi phí (Mốc 7, việc 7.4).
       Xem `InfraCostMonth.vue` cho lý do tách. Đây là màn DUY NHẤT trong nhóm ghi
       ra AWS (`create-budget`/`update-budget` đi qua cổng quyền) — đứng riêng thì
       ranh giới đọc/ghi của cả nhóm nhìn thấy được từ thanh tab. -->
  <!-- ── 7.4 Ngân sách ──────────────────────────────────────────────── -->
  <Card class="gap-2.5 px-3.5 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-base text-foreground">{{ t('infra.cost.budget.title') }}</span>
      <span class="text-xs text-faint">{{ t('infra.cost.budget.why') }}</span>
      <span class="flex-1" />
      <Button
        type="button"
        :disabled="budgetsLoading || !accountId"
        :aria-busy="budgetsLoading"
        variant="outline"
        size="sm"
        @click="loadBudgets"
      >
        <Icon name="refresh" class="size-3" :class="budgetsLoading ? 'animate-spin' : ''" />
        {{ t('infra.cost.budget.load') }}
      </Button>
    </div>

    <!-- Budgets đòi `--account-id` tường minh. Chưa giải được id thì nói ra và tắt
         nút, thay vì để người dùng bấm vào một lệnh chắc chắn hỏng. -->
    <p v-if="!accountId" class="m-0 text-xs text-faint">
      {{ t('infra.cost.budget.noAccountId') }}
    </p>
    <p v-else-if="budgetsError" class="m-0 text-xs text-destructive">{{ budgetsError }}</p>

    <template v-if="budgets">
      <ul v-if="budgets.length" class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="b in budgets" :key="b.name" class="flex items-baseline gap-2 py-0.5 text-sm">
          <span class="min-w-0 flex-1 truncate text-foreground">{{ b.name }}</span>
          <span class="text-faint">{{ b.timeUnit }}</span>
          <span class="text-dim tabular-nums">
            {{ b.actualUsd === null ? '—' : usd(b.actualUsd) }}
            /
            {{ b.limitUsd === null ? '—' : usd(b.limitUsd) }}
          </span>
        </li>
      </ul>
      <p v-else class="m-0 text-xs text-faint">{{ t('infra.cost.budget.none') }}</p>
    </template>

    <!-- Đặt ngân sách là lượt GHI duy nhất của tab này: nó đi qua ma trận quyền và
         có thể dừng ở hộp duyệt. Ba ô, không hơn. -->
    <div class="flex flex-wrap items-center gap-2">
      <Input
        v-model="budgetName"
        type="text"
        maxlength="100"
        class="h-ctrl-sm w-auto min-w-36 flex-1 basis-50"
        :placeholder="t('infra.cost.budget.namePlaceholder')"
      />
      <Input
        v-model.number="budgetLimit"
        type="number"
        min="1"
        step="1"
        class="h-ctrl-sm w-32"
        :placeholder="t('infra.cost.budget.limitPlaceholder')"
      />
      <Input
        v-model="budgetEmails"
        type="text"
        autocomplete="off"
        class="h-ctrl-sm w-auto min-w-36 flex-1 basis-50"
        :placeholder="t('infra.cost.budget.emailsPlaceholder')"
        :title="t('infra.cost.budget.emailsWhy')"
      />
      <Button
        type="button"
        :disabled="!canSaveBudget"
        :aria-busy="budgetSaving"
        variant="default"
        size="sm"
        @click="onSaveBudget"
      >
        <Icon name="check" class="size-3" />
        {{ t('infra.cost.budget.save') }}
      </Button>
    </div>
    <p class="m-0 text-xs text-faint">{{ t('infra.cost.budget.thresholdWhy') }}</p>
  </Card>
</template>

<script setup lang="ts">
// Lớp bind của tab con "Ngân sách". State + RPC ở `useInfraCost()` (xem InfraCostMonth).
import { computed, ref } from 'vue'
import { useInfraCost } from '~/composables/useInfraCost'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
