<template>
  <Teleport to="body">
    <div v-if="open" class="gpm-ovl" @click.self="emit('close')">
      <div class="gpm-card" role="dialog" aria-modal="true">
        <div class="gpm-title">{{ title }}</div>
        <input
          ref="input"
          class="gpm-input"
          :value="modelValue"
          :placeholder="placeholder"
          @input="onInput"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="emit('close')"
        />
        <div class="gpm-foot">
          <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn pri" :disabled="!modelValue.trim()" @click="submit">
            {{ submitLabel ?? t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Small reusable prompt modal for single-line git input (new branch name, rename
// branch, tag name…). Caller owns the value via v-model + supplies the labels;
// this component only renders the overlay + wires keyboard/focus behaviour.
import { nextTick, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  modelValue: string
  placeholder?: string
  submitLabel?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'submit', v: string): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const input = useTemplateRef<HTMLInputElement>('input')

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function submit() {
  const v = props.modelValue.trim()
  if (!v) return
  emit('submit', v)
}

// Autofocus + select the field whenever the modal opens.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    nextTick(() => {
      const el = input.value
      if (!el) return
      el.focus()
      el.select()
    })
  },
)
</script>

<style scoped>
.gpm-ovl {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.gpm-card {
  width: 360px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.gpm-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.gpm-input {
  width: 100%;
  padding: 9px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.gpm-input:focus {
  border-color: var(--accent);
}
.gpm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.gpm-foot .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
