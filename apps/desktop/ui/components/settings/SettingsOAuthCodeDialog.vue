<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    :style="{ background: t.overlay }"
    @click.self="onCancel"
  >
    <div
      class="w-full max-w-md rounded-lg shadow-xl"
      :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="px-4 py-3 flex items-center justify-between"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="text-[1em] font-semibold" :style="{ color: t.text }">
          Connect Claude Pro/Max
        </div>
        <button
          type="button"
          class="p-1 rounded transition flex items-center"
          :style="{ color: t.textDim }"
          aria-label="Close"
          @click="onCancel"
        >
          <X :size="14" />
        </button>
      </div>

      <div class="px-4 py-4 space-y-4">
        <!-- Step 1 -->
        <section class="space-y-2">
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[1em] font-semibold"
              :style="{ background: t.accent, color: t.accentText }"
            >
              1
            </span>
            <div class="text-[1em]" :style="{ color: t.text }">
              Open the Anthropic login page in your browser.
            </div>
          </div>
          <button
            type="button"
            class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded text-[1em] font-medium transition"
            :style="openButtonStyle"
            :disabled="phase === 'opening' || phase === 'waiting-code' || phase === 'confirming'"
            @click="onOpenLogin"
          >
            <LogIn v-if="phase !== 'waiting-code'" :size="13" />
            <Check v-else :size="13" />
            <span>{{ openButtonLabel }}</span>
          </button>
        </section>

        <!-- Step 2 -->
        <section class="space-y-1">
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[1em] font-semibold"
              :style="stepBadgeStyle(phase !== 'idle' && phase !== 'opening')"
            >
              2
            </span>
            <div class="text-[1em]" :style="{ color: t.text }">
              After signing in, Anthropic will show a one-time code. Copy it.
            </div>
          </div>
        </section>

        <!-- Step 3 -->
        <section class="space-y-2">
          <div class="flex items-center gap-2">
            <span
              class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[1em] font-semibold"
              :style="
                stepBadgeStyle(
                  phase === 'waiting-code' || phase === 'confirming' || phase === 'error',
                )
              "
            >
              3
            </span>
            <div class="text-[1em]" :style="{ color: t.text }">
              Paste the code below, then click Confirm.
            </div>
          </div>

          <textarea
            ref="codeInput"
            v-model="code"
            rows="3"
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono resize-none"
            :style="inputStyle"
            placeholder="Paste the one-time code here"
            spellcheck="false"
            :disabled="phase === 'confirming'"
          />

          <input
            v-model="label"
            type="text"
            class="w-full rounded px-2 py-1.5 text-[1em]"
            :style="inputStyle"
            placeholder="Optional label (e.g. Personal Pro)"
            :disabled="phase === 'confirming'"
          />
        </section>

        <div
          v-if="error"
          class="rounded px-3 py-2 text-[1em]"
          :style="{
            background: t.dangerBg,
            border: `1px solid ${t.dangerBorder}`,
            color: t.danger,
          }"
        >
          {{ error }}
        </div>
      </div>

      <div
        class="px-4 py-3 flex items-center justify-end gap-2"
        :style="{ borderTop: `1px solid ${t.border}` }"
      >
        <button
          type="button"
          class="px-3 py-1.5 text-[1em] rounded transition"
          :style="secondaryBtnStyle"
          :disabled="phase === 'confirming'"
          @click="onCancel"
        >
          Cancel
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 text-[1em] rounded transition"
          :style="primaryBtnStyle"
          :disabled="!canConfirm"
          @click="onConfirm"
        >
          <Loader2
            v-if="phase === 'confirming'"
            :size="13"
            class="animate-spin shrink-0"
            aria-hidden="true"
          />
          <span class="leading-none">Confirm</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, Loader2, LogIn, X } from 'lucide-vue-next'
import type { ProviderAccount } from '~/types'
import { SidecarError, SidecarUnavailableError } from '~/composables/useSidecar'

type Phase = 'idle' | 'opening' | 'waiting-code' | 'confirming' | 'error'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  connected: [account: ProviderAccount]
}>()

const { t } = useTheme()
const settings = useSettingsStore()

const phase = ref<Phase>('idle')
const oauthState = ref<string | null>(null)
const code = ref('')
const label = ref('')
const error = ref<string | null>(null)
const codeInput = ref<HTMLTextAreaElement | null>(null)

const resetState = () => {
  phase.value = 'idle'
  oauthState.value = null
  code.value = ''
  label.value = ''
  error.value = null
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) resetState()
  },
)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const openButtonStyle = computed(() => {
  const disabled = phase.value === 'opening' || phase.value === 'confirming'
  return {
    background: phase.value === 'waiting-code' ? t.value.bgInput : t.value.accent,
    color: phase.value === 'waiting-code' ? t.value.text : t.value.accentText,
    border: `1px solid ${phase.value === 'waiting-code' ? t.value.borderStrong : 'transparent'}`,
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
})

const openButtonLabel = computed(() => {
  if (phase.value === 'opening') return 'Opening browser…'
  if (phase.value === 'waiting-code') return 'Browser opened'
  return 'Open Anthropic login'
})

const secondaryBtnStyle = computed(() => ({
  background: 'transparent',
  border: `1px solid ${t.value.borderStrong}`,
  color: t.value.text,
}))

const canConfirm = computed(() => {
  if (phase.value === 'confirming') return false
  if (!oauthState.value) return false
  return code.value.trim().length > 0
})

const primaryBtnStyle = computed(() => {
  const disabled = !canConfirm.value
  return {
    background: t.value.accent,
    color: t.value.accentText,
    border: 'none',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
})

const stepBadgeStyle = (active: boolean) => ({
  background: active ? t.value.accent : t.value.bgInput,
  color: active ? t.value.accentText : t.value.textDim,
  border: `1px solid ${active ? 'transparent' : t.value.border}`,
})

const errorMessageFrom = (err: unknown): string => {
  if (err instanceof SidecarUnavailableError) {
    return 'Sidecar unavailable. Make sure you are running the desktop app.'
  }
  if (err instanceof SidecarError) {
    return err.message || `Sidecar error ${err.code}`
  }
  if (err instanceof Error) return err.message
  return 'Unknown error'
}

const sidecar = useSidecar()

const onOpenLogin = async () => {
  error.value = null
  phase.value = 'opening'
  try {
    const { state, authUrl } = await settings.connectAnthropicOAuth()
    oauthState.value = state
    await sidecar.openExternal(authUrl)
    phase.value = 'waiting-code'
    // Autofocus the textarea once the browser hand-off is initiated.
    await nextTick()
    codeInput.value?.focus()
  } catch (err) {
    phase.value = 'error'
    error.value = errorMessageFrom(err)
  }
}

const onConfirm = async () => {
  if (!oauthState.value) return
  error.value = null
  phase.value = 'confirming'

  // User may paste "code#state" — split and verify state matches our oauthState.
  const raw = code.value.trim()
  const hashIdx = raw.indexOf('#')
  let codeOnly = raw
  if (hashIdx >= 0) {
    const pastedState = raw.slice(hashIdx + 1)
    if (pastedState && pastedState !== oauthState.value) {
      phase.value = 'error'
      error.value = 'The code does not match this authorization session. Please restart.'
      return
    }
    codeOnly = raw.slice(0, hashIdx)
  }

  try {
    const trimmedLabel = label.value.trim()
    const account = await settings.completeAnthropicOAuth(
      oauthState.value,
      codeOnly,
      trimmedLabel || undefined,
    )
    emit('connected', account)
    emit('close')
  } catch (err) {
    phase.value = 'error'
    error.value = errorMessageFrom(err)
  }
}

const onCancel = () => {
  if (phase.value === 'confirming') return
  emit('close')
}
</script>
