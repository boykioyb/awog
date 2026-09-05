<template>
  <LibraryEntityModal
    :open="open"
    :title="t('vpn.challenge.title')"
    :width="440"
    lock-scrim
    @close="onCancel"
  >
    <div class="vch">
      <p class="vch-sub">{{ t('vpn.challenge.sub', { name }) }}</p>
      <p class="vch-prompt">{{ promptText }}</p>

      <input
        ref="input"
        v-model="code"
        class="vch-input"
        :type="echo ? 'text' : 'password'"
        inputmode="text"
        autocomplete="one-time-code"
        autocapitalize="off"
        spellcheck="false"
        :placeholder="t('vpn.challenge.placeholder')"
        @keydown.enter.prevent="onSubmit"
      />

      <p class="vch-hint">{{ t('vpn.challenge.hint') }}</p>
    </div>

    <template #footer>
      <button class="btn" @click="onCancel">{{ t('common.cancel') }}</button>
      <span style="flex: 1" />
      <button class="btn pri" :disabled="!code.trim()" @click="onSubmit">
        {{ t('vpn.challenge.submit') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// MFA/OTP prompt for a VPN parked at AUTH (ADR 0065). openvpn asked for an authenticator
// code (static-challenge or dynamic CRV1); the user types it here and it travels
// UI → sidecar → openvpn's management socket ONLY (never stored, never echoed back).
// Cancel tears the tunnel down. Enter submits. Re-focuses + clears on a fresh prompt
// (e.g. a wrong-code retry re-issues the challenge).
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'

const props = defineProps<{
  open: boolean
  name: string
  prompt: string
  echo: boolean
}>()

const emit = defineEmits<{ submit: [code: string]; cancel: [] }>()

const { t } = useI18n()

const code = ref('')
const input = useTemplateRef<HTMLInputElement>('input')

// Fall back to a generic label when the server sends an empty challenge string.
const promptText = computed(() => props.prompt.trim() || t('vpn.challenge.defaultPrompt'))

function onSubmit(): void {
  const value = code.value.trim()
  if (!value) return
  emit('submit', value)
  code.value = ''
}

function onCancel(): void {
  code.value = ''
  emit('cancel')
}

// Clear + focus whenever the modal opens OR the prompt changes (a retry re-challenges
// with a fresh prompt while the modal stays open).
watch(
  [() => props.open, () => props.prompt],
  ([isOpen]) => {
    if (!isOpen) return
    code.value = ''
    void nextTick(() => input.value?.focus())
  },
  { immediate: true },
)
</script>

<style scoped>
.vch {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.vch-sub {
  margin: 0;
  font-size: var(--fs-md);
  color: var(--textDim);
}
.vch-prompt {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text);
}
.vch-input {
  width: 100%;
  margin-top: 2px;
  padding: 9px 12px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--code);
  font-size: var(--fs-lg);
  letter-spacing: 0.14em;
  outline: none;
}
.vch-input:focus {
  border-color: var(--accent);
}
.vch-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--textDim);
}
</style>
