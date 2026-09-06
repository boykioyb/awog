<template>
  <Teleport to="body">
    <div v-if="state.open" class="tph-ovl" @click.self="settle(null)">
      <div class="tph-card" role="dialog" aria-modal="true">
        <div class="tph-title">{{ state.title }}</div>
        <input
          ref="input"
          v-model="draft"
          class="tph-input"
          :placeholder="state.placeholder"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="settle(null)"
        />
        <div class="tph-foot">
          <button class="btn" @click="settle(null)">{{ t('common.cancel') }}</button>
          <button class="btn pri" :disabled="!draft.trim()" @click="submit">
            {{ state.submitLabel || t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// One app-lifetime host (mounted in the layout) bound to the useTextPrompt()
// singleton — the imperative single-line text prompt for New File / New Folder /
// Rename. Mirrors GitPromptModal's markup/styling + ConfirmDialogHost's mount
// pattern. Holds a local `draft` synced from the singleton on open, autofocuses
// + selects the field, and settles the pending promise on submit / cancel / Esc.
import { nextTick, ref, useTemplateRef, watch } from 'vue'

const { state, settle } = useTextPrompt()
const { t } = useI18n()

const input = useTemplateRef<HTMLInputElement>('input')
const draft = ref('')

function submit() {
  const v = draft.value.trim()
  if (!v) return
  settle(v)
}

// Sync the local draft from the singleton whenever the prompt opens, then
// autofocus + select the field for quick overwrite (rename) / typing.
watch(
  () => state.open,
  (isOpen) => {
    if (!isOpen) return
    draft.value = state.value
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
.tph-ovl {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}
.tph-card {
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
.tph-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--text);
}
.tph-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
}
.tph-input:focus {
  border-color: var(--accent);
}
.tph-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.tph-foot .btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
