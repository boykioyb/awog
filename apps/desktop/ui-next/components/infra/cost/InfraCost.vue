<template>
  <!-- Vỏ chung của nhóm "Chi phí" trong `/infra`.
       Từ 2026-09-16 nhóm này có BA tab con, mỗi tab một component riêng:
         · Tháng này — "tháng này hết bao nhiêu, cuối tháng sẽ là bao nhiêu"
         · Ngân sách — "đặt trần và cho ai biết khi chạm trần"
         · Lãng phí  — "có gì đang đốt tiền mà không ai dùng"

       VÌ SAO TÁCH. Ba khối vốn xếp dọc trong một màn cuộn, và HAI trong ba tốn tiền
       thật mỗi lần bấm (Cost Explorer tính theo request; dò lãng phí gọi hàng loạt
       `describe-*`, cộng metric nếu bật hai phép dò trả tiền). Một màn duy nhất bắt
       người dùng cuộn ngang qua một nút tính tiền để tới nút kia. Tách ra thì mỗi
       màn còn đúng một câu hỏi và đúng một cái giá.

       Cổng kiểm (`sidecar`/`profile`) và chip câu hỏi ở LẠI đây: chúng đúng cho cả
       ba tab, và nhân ba một cổng kiểm là ba chỗ để quên sửa. -->
  <div class="flex h-full min-h-0 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
    <header class="flex flex-col gap-1">
      <h2 class="m-0 text-lg font-semibold text-foreground">
        {{ t(`infra.cost.view.${view}.title`) }}
      </h2>
      <p class="m-0 max-w-[72ch] text-sm leading-relaxed text-dim">
        {{ t(`infra.cost.view.${view}.subtitle`) }}
      </p>
    </header>

    <p v-if="!sidecarAvailable" class="m-0 text-sm text-dim">{{ t('infra.cost.noSidecar') }}</p>
    <InfraEmpty
      v-else-if="!hasAccount"
      :title="t('infra.empty.noProfile.title')"
      :hint="t('infra.empty.noProfile.hint.cost')"
      action="accounts"
      :action-label="t('infra.empty.noProfile.action')"
    />

    <template v-else>
      <InfraCostMonth v-if="view === 'cost'" />
      <InfraCostBudgets v-else-if="view === 'budgets'" />
      <InfraCostWaste v-else />

      <!-- Luật 4 của infra-README: chip câu hỏi thay cho ô trống. Cùng khuôn với màn
           Giám sát — tắt khi chưa có số liệu nào, vì câu trả lời sẽ rỗng. Không có vạch
           kẻ phía trên: các khối bên trên là card, đã có ranh giới nhìn thấy được. -->
      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        <span class="text-xs text-faint">{{ t('infra.cost.title') }}</span>
        <Button
          v-for="s in askSuggestions"
          :key="s.key"
          type="button"
          variant="outline"
          size="xs"
          class="rounded-full font-normal text-dim hover:border-selected-border hover:text-primary"
          :disabled="!hasSnapshot"
          @click="ask(s.text)"
        >
          {{ s.text }}
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Vỏ của nhóm Chi phí: cổng kiểm + chọn tab con + chip câu hỏi. Không giữ state
// riêng — `useInfraCost()` là singleton cấp module nên ba tab con dùng chung một
// kho, và đổi tab không làm mất số đã tải hay lựa chọn đang tick.
import InfraEmpty from '~/components/infra/InfraEmpty.vue'
import InfraCostBudgets from '~/components/infra/cost/InfraCostBudgets.vue'
import InfraCostMonth from '~/components/infra/cost/InfraCostMonth.vue'
import InfraCostWaste from '~/components/infra/cost/InfraCostWaste.vue'
import { useInfraCost } from '~/composables/useInfraCost'

/** Tab con đang mở. Trang `/infra` truyền thẳng `tab` xuống — xem `COST_TABS` ở đó. */
const props = withDefaults(defineProps<{ view?: 'cost' | 'budgets' | 'waste' }>(), {
  view: 'cost',
})

const { t } = useI18n()
const { hasAccount, sidecarAvailable, askSuggestions, hasSnapshot, ask } = useInfraCost()

// `props.view` đọc trong template qua `view` — giữ tham chiếu để lint không kêu
// props không dùng ở script.
const view = computed(() => props.view)
</script>
