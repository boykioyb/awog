<template>
  <aside class="iap icard">
    <div class="iap-head">
      <span class="iap-title">
        {{ draft.editing ? t('infra.monitoring.alarm.edit') : t('infra.monitoring.alarm.create') }}
      </span>
      <button
        type="button"
        class="iap-x"
        :title="t('infra.monitoring.alarm.cancel')"
        :aria-label="t('infra.monitoring.alarm.cancel')"
        @click="emit('close')"
      >
        <Icon name="x" class="iap-ic" />
      </button>
    </div>

    <div class="iap-metric">
      <span class="iap-metric-l">{{ t('infra.monitoring.alarm.metric') }}</span>
      <code class="iap-code">{{ draft.namespace }} / {{ draft.metricName }}</code>
      <span class="ihint">
        {{ draft.stat }} · {{ draft.periodSeconds }}s ·
        {{ t(`infra.monitoring.unit.${draft.unit.toLowerCase()}`) }}
      </span>
    </div>

    <div class="ifield">
      <label class="ilbl" for="iap-threshold">
        {{
          t('infra.monitoring.alarm.thresholdValue', {
            v: formatMetricValue(draft.threshold, draft.unit),
          })
        }}
      </label>
      <input
        id="iap-threshold"
        class="iin"
        type="number"
        step="any"
        :value="draft.threshold"
        @input="setNumber('threshold', $event)"
      />
      <!-- Kéo trên biểu đồ và gõ ở đây sửa CÙNG một trường; nói ra để không ai đi tìm
           một ô ngưỡng thứ hai ở nơi khác. -->
      <p class="ihint">{{ t('infra.monitoring.alarm.dragHint') }}</p>
    </div>

    <div class="ifield">
      <span class="ilbl iap-lbl">{{ t('infra.monitoring.alarm.comparison') }}</span>
      <AppSelect
        :model-value="draft.comparisonOperator"
        :options="operatorOptions"
        width="100%"
        @update:model-value="(v: string) => set('comparisonOperator', v as ComparisonOperator)"
      />
    </div>

    <div class="ifield">
      <label class="ilbl" for="iap-eval">{{ t('infra.monitoring.alarm.evaluationPeriods') }}</label>
      <input
        id="iap-eval"
        class="iin"
        type="number"
        min="1"
        step="1"
        :value="draft.evaluationPeriods"
        @input="setNumber('evaluationPeriods', $event)"
      />
    </div>

    <div class="ifield">
      <span class="ilbl iap-lbl">{{ t('infra.monitoring.alarm.treatMissingData') }}</span>
      <AppSelect
        :model-value="draft.treatMissingData"
        :options="treatOptions"
        width="100%"
        @update:model-value="(v: string) => set('treatMissingData', v as TreatMissingData)"
      />
    </div>

    <div class="ifield">
      <label class="ilbl" for="iap-name">{{ t('infra.monitoring.alarm.name') }}</label>
      <input
        id="iap-name"
        class="iin"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :value="draft.name"
        @input="setText('name', $event)"
      />
    </div>

    <div class="ifield">
      <label class="ilbl" for="iap-desc">{{ t('infra.monitoring.alarm.description') }}</label>
      <textarea
        id="iap-desc"
        class="iin iap-ta"
        rows="2"
        :value="draft.alarmDescription"
        @input="setText('alarmDescription', $event)"
      />
    </div>

    <div class="ifield">
      <label class="ilbl" for="iap-actions">{{ t('infra.monitoring.alarm.actions') }}</label>
      <input
        id="iap-actions"
        class="iin"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :value="draft.alarmActions"
        @input="setText('alarmActions', $event)"
      />
      <p class="ihint">{{ t('infra.monitoring.alarm.actionsHint') }}</p>
    </div>

    <div class="iap-foot">
      <button
        type="button"
        class="btn pri"
        :disabled="saving"
        :aria-busy="saving"
        @click="emit('save')"
      >
        <Icon v-if="!saving" name="save" class="iap-ic" />
        <Icon v-else name="refresh" class="iap-ic iap-spin" />
        {{ t('infra.monitoring.alarm.save') }}
      </button>
      <button type="button" class="btn" :disabled="saving" @click="emit('close')">
        {{ t('infra.monitoring.alarm.cancel') }}
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Panel đặt cảnh báo từ biểu đồ (Mốc 6, 6.4).
//
// KHÔNG GIỮ BẢN SAO CỦA BẢN NHÁP. Mọi ô đọc thẳng từ prop `draft` và ghi lại bằng
// event `patch` — bản nháp nằm ở `useInfraMetrics`, cùng chỗ với tay nắm kéo trên
// biểu đồ. Hai bản sao là hai chỗ để ngưỡng vừa kéo lệch với ngưỡng sắp gửi lên AWS.
//
// LƯU LÀ LỆNH GHI. Nút này KHÔNG tự khẳng định gì về quyền: nó phát `save`, và việc
// hỏi cổng quyền (kèm hộp duyệt hạ tầng) nằm ở composable — nơi duy nhất biết vé.
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type {
  AlarmDraft,
  ComparisonOperator,
  TreatMissingData,
} from '~/composables/useInfraMetrics'
import { formatMetricValue } from '~/composables/useInfraMetrics'

// Không gán vào biến: template đọc thẳng `draft` / `saving`. Gán `const props =` mà
// không dùng là một biến thừa (và eslint bắt đúng).
defineProps<{ draft: AlarmDraft; saving: boolean }>()

const emit = defineEmits<{
  patch: [patch: Partial<AlarmDraft>]
  save: []
  close: []
}>()

const { t } = useI18n()

const OPERATORS: ComparisonOperator[] = [
  'GreaterThanThreshold',
  'GreaterThanOrEqualToThreshold',
  'LessThanThreshold',
  'LessThanOrEqualToThreshold',
]
const TREAT: TreatMissingData[] = ['missing', 'notBreaching', 'breaching', 'ignore']

const operatorOptions = computed<AppSelectOption[]>(() =>
  OPERATORS.map((value) => ({ value, label: t(`infra.monitoring.operator.${value}`) })),
)
const treatOptions = computed<AppSelectOption[]>(() =>
  TREAT.map((value) => ({ value, label: t(`infra.monitoring.treat.${value}`) })),
)

function set<K extends keyof AlarmDraft>(key: K, value: AlarmDraft[K]): void {
  emit('patch', { [key]: value } as Partial<AlarmDraft>)
}

function setText(key: 'name' | 'alarmDescription' | 'alarmActions', e: Event): void {
  set(key, (e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

/** Ô số rỗng ⇒ `Number('')` = 0, và một ngưỡng 0 tự hiện ra là "người dùng vừa đặt
 *  0" — nên chỉ ghi khi thật sự đọc được một số. */
function setNumber(key: 'threshold' | 'evaluationPeriods', e: Event): void {
  const n = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(n)) set(key, n)
}
</script>

<style scoped>
.iap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  /* Da (viền, bo góc, nền, đổ bóng) do `.icard` cấp — xem app-shell.css. Bốn khối
     của màn này TỪNG tự khai lại cùng một bộ, với ba nền khác nhau (`--bgSubtle`,
     `--bgEl`), nên chúng đọc ra thành ba loại bề mặt trong cùng một màn. */
}

.iap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.iap-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 650;
}

.iap-x {
  display: grid;
  place-items: center;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.iap-x:hover {
  background: var(--bgHover);
  color: var(--text);
}

.iap-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.iap-spin {
  animation: iap-rot 1s linear infinite;
}

@keyframes iap-rot {
  to {
    transform: rotate(360deg);
  }
}

.iap-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
}

/* `.ilbl` của app-shell là một khối (mọi chỗ dùng nó là `<div>`); ở đây nó gắn trên
   `<label>` để ô nhập có tên thật, mà `<label>` mặc định là inline nên `margin-bottom`
   của token không có tác dụng. */
.iap label,
.iap-lbl {
  display: block;
}

.iap-metric-l {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.iap-code {
  /* mono-ok: namespace/metric của CloudWatch là định danh người dùng copy sang AWS CLI */
  font-family: var(--code);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  word-break: break-all;
}

.iap-ta {
  resize: vertical;
  min-height: 48px;
}

.iap-foot {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}
</style>
