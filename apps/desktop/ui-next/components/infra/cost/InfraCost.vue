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
  <div class="icst">
    <header class="icst-hd">
      <div class="icst-hd-txt">
        <h2 class="icst-ttl">{{ t(`infra.cost.view.${view}.title`) }}</h2>
        <p class="icst-sub">{{ t(`infra.cost.view.${view}.subtitle`) }}</p>
      </div>
    </header>

    <p v-if="!sidecarAvailable" class="icst-state">{{ t('infra.cost.noSidecar') }}</p>
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

<style scoped>
/* Tiền tố `icst-`, KHÔNG phải `ic-`: `prototype.css` có một class TOÀN CỤC `.ic` là
   inline code (mono, nền xám, .92em), nên một root tên `.ic` biến cả màn thành chữ
   monospace 11.96px trên nền xám (lỗi thật 2026-09-15). */
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
</style>
