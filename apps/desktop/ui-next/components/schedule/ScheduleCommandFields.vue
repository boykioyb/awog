<template>
  <div class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.program') }}</Label>
    <!-- mono-ok: đường dẫn chương trình — người dùng copy-paste vào terminal -->
    <Input v-model="program" :placeholder="t('schedules.form.programPh')" class="font-mono" />
  </div>
  <div class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.args') }}</Label>
    <!-- Mỗi dòng một tham số: không có shell nên không có quote/escape để đoán. -->
    <!-- mono-ok: tham số dòng lệnh — người dùng copy-paste vào terminal -->
    <Textarea v-model="argsText" class="min-h-24 resize-y font-mono" />
    <div class="text-xs text-dim">{{ t('schedules.form.args.hint') }}</div>
  </div>
  <div class="flex flex-col gap-1.5">
    <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.timeout') }}</Label>
    <Input v-model.number="timeoutMinutes" type="number" min="1" max="60" class="w-28" />
  </div>
  <div class="text-xs text-dim">{{ t('schedules.form.command.hint') }}</div>
</template>

<script setup lang="ts">
// Ô nhập của job `command` trong ScheduleEditor — tách riêng cho editor khỏi phình.
// Nhiều root (fragment): các field xếp thẳng vào cột flex `gap-3` của editor.
import Input from '~/components/ui/input/Input.vue'
import Label from '~/components/ui/label/Label.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'

const program = defineModel<string>('program', { required: true })
const argsText = defineModel<string>('argsText', { required: true })
const timeoutMinutes = defineModel<number>('timeoutMinutes', { required: true })

const { t } = useI18n()
</script>
