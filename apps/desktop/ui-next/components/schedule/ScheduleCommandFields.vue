<template>
  <div class="sef-field">
    <label class="sef-label">{{ t('schedules.form.program') }}</label>
    <Input v-model="program" :placeholder="t('schedules.form.programPh')" class="scf-code" />
  </div>
  <div class="sef-field">
    <label class="sef-label">{{ t('schedules.form.args') }}</label>
    <!-- Mỗi dòng một tham số: không có shell nên không có quote/escape để đoán. -->
    <textarea v-model="argsText" class="sef-input sef-area scf-code" />
    <div class="sef-hint">{{ t('schedules.form.args.hint') }}</div>
  </div>
  <div class="sef-field">
    <label class="sef-label">{{ t('schedules.form.timeout') }}</label>
    <Input v-model.number="timeoutMinutes" type="number" min="1" max="60" class="sef-num" />
  </div>
  <div class="sef-hint">{{ t('schedules.form.command.hint') }}</div>
</template>

<script setup lang="ts">
// Ô nhập của job `command` trong ScheduleEditor — tách riêng cho editor khỏi phình.
// Class `sef-*` là của ScheduleEditor (scoped style không xuyên vào đây nên khai lại
// đúng phần dùng ở dưới).
import Input from '~/components/ui/input/Input.vue'

const program = defineModel<string>('program', { required: true })
const argsText = defineModel<string>('argsText', { required: true })
const timeoutMinutes = defineModel<number>('timeoutMinutes', { required: true })

const { t } = useI18n()
</script>

<style scoped>
/* Khai lại phần style của ScheduleEditor mà form này dùng: style scoped của cha không
   xuyên vào con. */
.sef-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sef-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sef-input {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.sef-input:focus {
  outline: none;
  border-color: var(--accentBorder);
}
.sef-area {
  resize: vertical;
  min-height: 6rem;
}
.sef-num {
  width: 110px;
}
.sef-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.scf-code {
  /* mono-ok: đường dẫn chương trình và tham số dòng lệnh — người dùng copy-paste vào terminal */
  font-family: var(--code);
}
</style>
