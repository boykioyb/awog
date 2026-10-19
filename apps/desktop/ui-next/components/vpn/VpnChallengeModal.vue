<template>
  <LibraryEntityModal
    :open="open"
    :title="t('vpn.challenge.title')"
    :width="440"
    lock-scrim
    @close="onCancel"
  >
    <div class="flex flex-col gap-2.5">
      <p class="text-base text-muted-foreground">{{ t('vpn.challenge.sub', { name }) }}</p>
      <p class="text-lg font-semibold text-foreground">{{ promptText }}</p>

      <Input
        ref="input"
        v-model="code"
        :type="echo ? 'text' : 'password'"
        inputmode="text"
        autocomplete="one-time-code"
        autocapitalize="off"
        spellcheck="false"
        :placeholder="t('vpn.challenge.placeholder')"
        @keydown.enter.prevent="onSubmit"
      />

      <p class="text-sm text-muted-foreground">{{ t('vpn.challenge.hint') }}</p>
    </div>

    <template #footer>
      <Button variant="outline" @click="onCancel">{{ t('common.cancel') }}</Button>
      <span class="flex-1" />
      <Button :disabled="!code.trim()" variant="default" @click="onSubmit">
        {{ t('vpn.challenge.submit') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
