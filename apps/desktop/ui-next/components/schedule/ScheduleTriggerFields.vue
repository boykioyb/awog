<template>
  <div class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.trigger') }}</Label>
    <ToggleGroup
      type="single"
      :spacing="1"
      class="w-full rounded-lg bg-muted p-0.5"
      :model-value="triggerKind"
      @update:model-value="(v) => v && (triggerKind = v as ScheduleTrigger['kind'])"
    >
      <ToggleGroupItem v-for="k in TRIGGER_KINDS" :key="k" :value="k" :class="SEG_ITEM">
        {{ t('schedules.kind.' + k) }}
      </ToggleGroupItem>
    </ToggleGroup>
  </div>

  <div v-if="triggerKind === 'interval'" class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.every') }}</Label>
    <div class="flex items-center gap-2">
      <Input v-model.number="intervalN" type="number" min="1" class="w-28" />
      <AppSelect v-model="intervalUnit" :options="unitOptions" width="130px" />
    </div>
  </div>

  <div v-else class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.time') }}</Label>
    <Input v-model="time" placeholder="09:00" class="w-28 tabular-nums" />
  </div>

  <div v-if="triggerKind === 'weekly'" class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.weekdays') }}</Label>
    <!-- Chọn nhiều ngày; mảng luôn sắp tăng dần theo mã Date.getDay() như trước khi đổi
         sang ToggleGroup (thứ tự bấm không lọt vào file lịch). -->
    <ToggleGroup
      type="multiple"
      variant="outline"
      size="sm"
      :spacing="1.5"
      class="flex-wrap"
      :model-value="weekdays"
      @update:model-value="(v) => (weekdays = [...(v as number[])].sort((a, b) => a - b))"
    >
      <ToggleGroupItem
        v-for="d in WEEKDAYS"
        :key="d"
        :value="d"
        class="text-muted-foreground data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:text-primary"
      >
        {{ t('schedules.day.' + d) }}
      </ToggleGroupItem>
    </ToggleGroup>
  </div>
</template>

<script setup lang="ts">
// Ô nhập biểu thức lịch (interval / daily / weekly) của ScheduleEditor — tách riêng cho
// editor khỏi phình. State nằm ở editor (dựng ScheduleTrigger lúc lưu); đây chỉ là form.
import { computed } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import Input from '~/components/ui/input/Input.vue'
import Label from '~/components/ui/label/Label.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'
import type { ScheduleTrigger } from '~/stores/schedules'

const triggerKind = defineModel<ScheduleTrigger['kind']>('triggerKind', { required: true })
const intervalN = defineModel<number>('intervalN', { required: true })
const intervalUnit = defineModel<'minutes' | 'hours'>('intervalUnit', { required: true })
const time = defineModel<string>('time', { required: true })
const weekdays = defineModel<number[]>('weekdays', { required: true })

const { t } = useI18n()

const TRIGGER_KINDS = ['interval', 'daily', 'weekly'] as const satisfies ScheduleTrigger['kind'][]
// Hiển thị bắt đầu từ thứ Hai; mã số theo Date.getDay() (0 = Chủ nhật).
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const

// Segmented control cùng kiểu CommandEditor, nhưng chia đều cả bề ngang như form cũ.
const SEG_ITEM =
  'h-6 flex-1 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'

const unitOptions = computed(() => [
  { label: t('schedules.form.unit.minutes'), value: 'minutes' },
  { label: t('schedules.form.unit.hours'), value: 'hours' },
])
</script>
