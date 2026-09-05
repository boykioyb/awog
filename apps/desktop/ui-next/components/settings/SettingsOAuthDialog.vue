<template>
  <SettingsModelDialog
    :open="open"
    :title="dialogTitle"
    :lock-scrim="phase === 'confirming'"
    @close="onCancel"
  >
    <div class="oad">
      <div v-if="reauthAccountId" class="oareauth">{{ t('settingsModels.oauth.reauthHint') }}</div>
      <!-- Step 1 -->
      <section class="oastep">
        <div class="oarow">
          <span class="oabadge on">1</span>
          <div class="oatext">{{ t('settingsModels.oauth.step1') }}</div>
        </div>
        <button
          class="btn pri oaopen"
          type="button"
          :class="{ done: phase === 'waiting-code' }"
          :disabled="phase === 'opening' || phase === 'waiting-code' || phase === 'confirming'"
          @click="onOpenLogin"
        >
          <Icon
            :name="phase === 'waiting-code' ? 'check' : 'agents'"
            style="width: 13px; height: 13px"
          />
          <span>{{ openButtonLabel }}</span>
        </button>
      </section>

      <!-- Step 2 -->
      <section class="oastep">
        <div class="oarow">
          <span class="oabadge" :class="{ on: phase !== 'idle' && phase !== 'opening' }">2</span>
          <div class="oatext">{{ t('settingsModels.oauth.step2') }}</div>
        </div>
      </section>

      <!-- Step 3 -->
      <section class="oastep">
        <div class="oarow">
          <span
            class="oabadge"
            :class="{ on: phase === 'waiting-code' || phase === 'confirming' || phase === 'error' }"
          >
            3
          </span>
          <div class="oatext">{{ t('settingsModels.oauth.step3') }}</div>
        </div>
        <textarea
          ref="codeInput"
          v-model="code"
          rows="3"
          class="keyinp mono oacode"
          :placeholder="t('settingsModels.oauth.codePlaceholder')"
          spellcheck="false"
          :disabled="phase === 'confirming'"
        />
        <input
          v-model="label"
          type="text"
          class="keyinp"
          :placeholder="t('settingsModels.oauth.labelPlaceholder')"
          :disabled="phase === 'confirming'"
        />
      </section>

      <div v-if="error" class="oaerror">{{ error }}</div>
    </div>

    <template #footer>
      <button class="btn sm" type="button" :disabled="phase === 'confirming'" @click="onCancel">
        {{ t('settingsModels.form.cancel') }}
      </button>
      <button class="btn sm pri" type="button" :disabled="!canConfirm" @click="onConfirm">
        {{ t('settingsModels.oauth.confirm') }}
      </button>
    </template>
  </SettingsModelDialog>
</template>

<script setup lang="ts">
import SettingsModelDialog from '~/components/settings/SettingsModelDialog.vue'
import { useSettingsStore, type ProviderAccount } from '~/stores/settings'
import { SidecarError, SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

// Anthropic OAuth (subscription) connect dialog. Flow: startOAuth →
// openExternal(authUrl) → user pastes one-time code → completeOAuth. The user may
// paste "code#state"; we split + verify state. Ported from legacy
// SettingsOAuthCodeDialog.vue into ui-next prototype style.
type Phase = 'idle' | 'opening' | 'waiting-code' | 'confirming' | 'error'

const props = withDefaults(
  defineProps<{
    open: boolean
    // When set, this OAuth flow re-authenticates an existing account in place
    // (refresh expired credentials) instead of adding a new one.
    reauthAccountId?: string | null
  }>(),
  { reauthAccountId: null },
)
const emit = defineEmits<{
  close: []
  connected: [account: ProviderAccount]
}>()

const { t } = useI18n()

const dialogTitle = computed(() =>
  props.reauthAccountId ? t('settingsModels.oauth.reauthTitle') : t('settingsModels.oauth.title'),
)
const settings = useSettingsStore()
const sidecar = useSidecar()

const phase = ref<Phase>('idle')
const oauthState = ref<string | null>(null)
const code = ref('')
const label = ref('')
const error = ref<string | null>(null)
const codeInput = useTemplateRef<HTMLTextAreaElement>('codeInput')

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

const openButtonLabel = computed(() => {
  if (phase.value === 'opening') return t('settingsModels.oauth.opening')
  if (phase.value === 'waiting-code') return t('settingsModels.oauth.opened')
  return t('settingsModels.oauth.openLogin')
})

const canConfirm = computed(() => {
  if (phase.value === 'confirming') return false
  if (!oauthState.value) return false
  return code.value.trim().length > 0
})

const errorMessageFrom = (err: unknown): string => {
  if (err instanceof SidecarUnavailableError) return t('settingsModels.error.sidecarUnavailable')
  if (err instanceof SidecarError) return err.message || `Sidecar error ${err.code}`
  if (err instanceof Error) return err.message
  return t('settingsModels.error.unknown')
}

const onOpenLogin = async () => {
  error.value = null
  phase.value = 'opening'
  try {
    const { state, authUrl } = await settings.connectAnthropicOAuth()
    oauthState.value = state
    await sidecar.openExternal(authUrl)
    phase.value = 'waiting-code'
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
      error.value = t('settingsModels.oauth.stateMismatch')
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
      props.reauthAccountId ?? undefined,
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

<style scoped>
.oad {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.oareauth {
  font-size: 1em;
  color: var(--textDim);
  line-height: 1.5;
  padding: 9px 11px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.oastep {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.oarow {
  display: flex;
  align-items: center;
  gap: 9px;
}
.oabadge {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: var(--fs-xs);
  font-weight: 650;
  flex: 0 0 auto;
  background: var(--bgInput);
  color: var(--textDim);
  border: 1px solid var(--border);
}
.oabadge.on {
  background: var(--accent);
  color: var(--accentText);
  border-color: transparent;
}
.oatext {
  font-size: 1em;
  color: var(--text);
}
.oaopen {
  justify-content: center;
  width: 100%;
}
.oaopen.done {
  background: var(--bgInput);
  color: var(--text);
  border: 1px solid var(--borderStrong);
  font-weight: 550;
}
.oacode {
  width: 100%;
  resize: none;
  font-family: var(--code);
}
.oaerror {
  border-radius: var(--r-sm);
  padding: 8px 11px;
  font-size: 1em;
  background: var(--dangerDim);
  border: 1px solid var(--danger);
  color: var(--danger);
}
</style>
