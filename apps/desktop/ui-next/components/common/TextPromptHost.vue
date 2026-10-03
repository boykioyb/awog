<template>
  <Teleport to="body">
    <div v-if="state.open" class="tph-ovl" @click.self="settle(null)">
      <div class="tph-card" role="dialog" aria-modal="true">
        <div class="tph-title">{{ state.title }}</div>
        <Input
          ref="input"
          v-model="draft"
          :placeholder="state.placeholder"
          @keydown.enter.prevent="submit"
          @keydown.esc.prevent="settle(null)"
        />
        <div class="tph-foot">
          <Button variant="outline" @click="settle(null)">{{ t('common.cancel') }}</Button>
          <Button :disabled="!draft.trim()" variant="default" @click="submit">
            {{ state.submitLabel || t('common.confirm') }}
          </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius); /* rounded-lg */
  box-shadow: var(--shadow-lg);
}
.tph-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--foreground);
}
.tph-input {
  width: 100%;
  padding: 9px 12px;
  background: var(--muted);
  border: 1px solid var(--input);
  border-radius: var(--r-sm); /* rounded-md */
  outline: none;
  color: var(--foreground);
  font-size: 1em;
  font-family: var(--sans);
}
.tph-input:focus-visible {
  border-color: var(--input);
  box-shadow: 0 0 0 1px var(--ring);
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
