<template>
  <!-- Da card dùng chung của khu hạ tầng — Card shadcn, không tự khai viền/nền/bóng. -->
  <Card class="min-h-0 gap-0.5 overflow-y-auto px-3 py-2.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-base font-semibold">
        {{ draft.editing ? t('infra.monitoring.alarm.edit') : t('infra.monitoring.alarm.create') }}
      </span>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-dim"
        :title="t('infra.monitoring.alarm.cancel')"
        :aria-label="t('infra.monitoring.alarm.cancel')"
        @click="emit('close')"
      >
        <Icon name="x" />
      </Button>
    </div>

    <div class="mt-1.5 flex flex-col gap-0.5 rounded-md border bg-muted px-2 py-1.5">
      <span class="text-xs text-faint">{{ t('infra.monitoring.alarm.metric') }}</span>
      <!-- mono-ok: namespace/metric của CloudWatch là định danh người dùng copy sang AWS CLI -->
      <code class="font-mono text-sm break-all text-foreground">
        {{ draft.namespace }} / {{ draft.metricName }}
      </code>
      <span class="mt-1.5 text-xs text-faint">
        {{ draft.stat }} · {{ draft.periodSeconds }}s ·
        {{ t(`infra.monitoring.unit.${draft.unit.toLowerCase()}`) }}
      </span>
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <Label for="iap-threshold" class="text-sm font-normal text-dim">
        {{
          t('infra.monitoring.alarm.thresholdValue', {
            v: formatMetricValue(draft.threshold, draft.unit),
          })
        }}
      </Label>
      <Input
        id="iap-threshold"
        type="number"
        step="any"
        :model-value="draft.threshold"
        class="flex-1"
        @update:model-value="setNumber('threshold', $event)"
      />
      <!-- Kéo trên biểu đồ và gõ ở đây sửa CÙNG một trường; nói ra để không ai đi tìm
           một ô ngưỡng thứ hai ở nơi khác. -->
      <p class="text-xs text-faint">{{ t('infra.monitoring.alarm.dragHint') }}</p>
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <span class="text-sm text-dim">{{ t('infra.monitoring.alarm.comparison') }}</span>
      <AppSelect
        :model-value="draft.comparisonOperator"
        :options="operatorOptions"
        width="100%"
        @update:model-value="(v: string) => set('comparisonOperator', v as ComparisonOperator)"
      />
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <Label for="iap-eval" class="text-sm font-normal text-dim">
        {{ t('infra.monitoring.alarm.evaluationPeriods') }}
      </Label>
      <Input
        id="iap-eval"
        type="number"
        min="1"
        step="1"
        :model-value="draft.evaluationPeriods"
        class="flex-1"
        @update:model-value="setNumber('evaluationPeriods', $event)"
      />
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <span class="text-sm text-dim">{{ t('infra.monitoring.alarm.treatMissingData') }}</span>
      <AppSelect
        :model-value="draft.treatMissingData"
        :options="treatOptions"
        width="100%"
        @update:model-value="(v: string) => set('treatMissingData', v as TreatMissingData)"
      />
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <Label for="iap-name" class="text-sm font-normal text-dim">
        {{ t('infra.monitoring.alarm.name') }}
      </Label>
      <Input
        id="iap-name"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :model-value="draft.name"
        class="flex-1"
        @update:model-value="setText('name', $event)"
      />
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <Label for="iap-desc" class="text-sm font-normal text-dim">
        {{ t('infra.monitoring.alarm.description') }}
      </Label>
      <Textarea
        id="iap-desc"
        class="min-h-12 resize-y"
        rows="2"
        :model-value="draft.alarmDescription"
        @update:model-value="(v: string | number) => setText('alarmDescription', String(v))"
      />
    </div>

    <div class="mt-3 flex flex-col gap-1.5">
      <Label for="iap-actions" class="text-sm font-normal text-dim">
        {{ t('infra.monitoring.alarm.actions') }}
      </Label>
      <Input
        id="iap-actions"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :model-value="draft.alarmActions"
        class="flex-1"
        @update:model-value="setText('alarmActions', $event)"
      />
      <p class="text-xs text-faint">{{ t('infra.monitoring.alarm.actionsHint') }}</p>
    </div>

    <div class="mt-3 flex gap-1.5">
      <Button
        type="button"
        :disabled="saving"
        :aria-busy="saving"
        variant="default"
        @click="emit('save')"
      >
        <Icon v-if="!saving" name="save" />
        <Icon v-else name="refresh" class="animate-spin" />
        {{ t('infra.monitoring.alarm.save') }}
      </Button>
      <Button type="button" :disabled="saving" variant="outline" @click="emit('close')">
        {{ t('infra.monitoring.alarm.cancel') }}
      </Button>
    </div>
  </Card>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

function setText(key: 'name' | 'alarmDescription' | 'alarmActions', e: Event | string): void {
  set(key, typeof e === 'string' ? e : (e.target as HTMLInputElement | HTMLTextAreaElement).value)
}

/** Ô số rỗng ⇒ `Number('')` = 0, và một ngưỡng 0 tự hiện ra là "người dùng vừa đặt
 *  0" — nên chỉ ghi khi thật sự đọc được một số. */
function setNumber(key: 'threshold' | 'evaluationPeriods', v: string): void {
  const n = Number(v)
  if (Number.isFinite(n)) set(key, n)
}
</script>
