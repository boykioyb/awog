<template>
  <Teleport to="body">
    <Transition name="pe">
      <div v-if="state" class="pe-ovl">
        <div class="pe-card" role="dialog" aria-modal="true">
          <div class="pe-head">
            <Pencil :size="14" class="pe-head-ic" />
            <span class="pe-title">{{ t('palette.edit.title') }}</span>
            <span class="pe-spacer" />
            <button class="pe-x" :title="t('palette.edit.cancel')" @click="cancel">
              <X :size="14" />
            </button>
          </div>

          <textarea
            ref="taRef"
            v-model="draft"
            class="pe-textarea"
            :placeholder="t('palette.edit.placeholder')"
            @keydown.meta.enter.prevent="confirm"
            @keydown.ctrl.enter.prevent="confirm"
          />

          <div class="pe-foot">
            <button class="pe-btn ghost" @click="cancel">{{ t('palette.edit.cancel') }}</button>
            <button class="pe-btn primary" :disabled="!draft.trim()" @click="confirm">
              {{ t('palette.edit.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { Pencil, X } from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useCommandPalette } from '~/composables/useCommandPalette'

// Focused prompt-edit overlay (§9 globals). Driven by the useCommandPalette
// singleton's `promptEdit` state: a caller does `await openPromptEdit(seed)` and
// this overlay resolves the promise with the edited text (confirm) or null
// (cancel). Decoupled from the sessions store so any component can use it without
// this overlay knowing the resend flow.

const { t } = useI18n()
const { promptEdit, confirmPromptEdit, cancelPromptEdit } = useCommandPalette()

const state = computed(() => promptEdit.value)
const draft = ref('')
const taRef = useTemplateRef<HTMLTextAreaElement>('taRef')

function confirm() {
  const next = draft.value.trim()
  if (!next) return
  confirmPromptEdit(next)
}
function cancel() {
  cancelPromptEdit()
}

// ESC closes the overlay even when focus isn't inside the textarea (e.g. tabbed to
// a button); gated on the open `state`.
useEscToClose(() => !!state.value, cancel)

// Seed the draft + focus whenever a new edit request opens.
watch(
  state,
  (s) => {
    if (!s) return
    draft.value = s.text
    nextTick(() => {
      const el = taRef.value
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  },
  { immediate: true },
)
</script>

<style scoped>
.pe-ovl {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
  background: rgba(0, 0, 0, 0.55);
}
.pe-card {
  width: 100%;
  max-width: 560px;
  margin: 0 16px;
  display: flex;
  flex-direction: column;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.pe-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.pe-head-ic {
  color: var(--textDim);
}
.pe-title {
  font-weight: 600;
  font-size: 1em;
}
.pe-spacer {
  flex: 1;
}
.pe-x {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
  background: transparent;
}
.pe-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.pe-textarea {
  resize: vertical;
  min-height: 9rem;
  margin: 12px 14px;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--text);
  font-size: 1em;
  font-family: var(--sans);
  line-height: 1.6;
}
.pe-textarea:focus {
  border-color: var(--accent);
}
.pe-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 14px 14px;
}
.pe-btn {
  padding: 6px 12px;
  border-radius: var(--r-xs);
  font-size: 1em;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
}
.pe-btn.ghost:hover {
  background: var(--bgHover);
}
.pe-btn.primary {
  background: var(--accent);
  color: var(--accentText);
  border-color: var(--accent);
}
.pe-btn.primary:disabled {
  opacity: 0.45;
  cursor: default;
}

.pe-enter-active,
.pe-leave-active {
  transition: opacity 120ms ease;
}
.pe-enter-from,
.pe-leave-to {
  opacity: 0;
}
</style>
