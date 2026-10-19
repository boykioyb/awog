<template>
  <SettingsModelDialog
    :open="open"
    :title="dialogTitle"
    :lock-scrim="phase === 'confirming'"
    @close="onCancel"
  >
    <div class="flex flex-col gap-4">
      <div v-if="reauthAccountId" class="rounded-md border bg-muted px-3 py-2 text-dim">
        {{ t('settingsModels.oauth.reauthHint') }}
      </div>
      <!-- Step 1 -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="grid size-5 shrink-0 place-items-center rounded-full border text-xs font-semibold border-transparent bg-primary text-primary-foreground"
          >
            1
          </span>
          <div class="text-foreground">{{ t('settingsModels.oauth.step1') }}</div>
        </div>
        <Button
          type="button"
          :disabled="phase === 'opening' || phase === 'waiting-code' || phase === 'confirming'"
          class="w-full"
          :variant="phase === 'waiting-code' ? 'outline' : 'default'"
          @click="onOpenLogin"
        >
          <Icon :name="phase === 'waiting-code' ? 'check' : 'agents'" class="size-3.5" />
          <span>{{ openButtonLabel }}</span>
        </Button>
      </section>

      <!-- Step 2 -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="grid size-5 shrink-0 place-items-center rounded-full border text-xs font-semibold"
            :class="badgeClass(phase !== 'idle' && phase !== 'opening')"
          >
            2
          </span>
          <div class="text-foreground">{{ t('settingsModels.oauth.step2') }}</div>
        </div>
      </section>

      <!-- Step 3 -->
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="grid size-5 shrink-0 place-items-center rounded-full border text-xs font-semibold"
            :class="
              badgeClass(phase === 'waiting-code' || phase === 'confirming' || phase === 'error')
            "
          >
            3
          </span>
          <div class="text-foreground">{{ t('settingsModels.oauth.step3') }}</div>
        </div>
        <!-- mono-ok: mã OAuth người dùng dán lại. resize-none: ô dán mã ngắn một mục đích. -->
        <Textarea
          ref="codeInput"
          v-model="code"
          rows="3"
          class="resize-none font-mono"
          :placeholder="t('settingsModels.oauth.codePlaceholder')"
          spellcheck="false"
          :disabled="phase === 'confirming'"
        />
        <Input
          v-model="label"
          type="text"
          :placeholder="t('settingsModels.oauth.labelPlaceholder')"
          :disabled="phase === 'confirming'"
          class="flex-1"
        />
      </section>

      <Alert
        v-if="error"
        variant="destructive"
        class="border-destructive/50 bg-destructive/10 px-3 py-2"
      >
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>

    <template #footer>
      <Button
        type="button"
        :disabled="phase === 'confirming'"
        variant="outline"
        size="sm"
        @click="onCancel"
      >
        {{ t('settingsModels.form.cancel') }}
      </Button>
      <Button type="button" :disabled="!canConfirm" variant="default" size="sm" @click="onConfirm">
        {{ t('settingsModels.oauth.confirm') }}
      </Button>
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
// Textarea là component shadcn — template ref trả instance, phần tử thật ở `$el`.
const codeInput = useTemplateRef<{ $el: HTMLTextAreaElement }>('codeInput')

// Huy hiệu số bước: bước đã tới thì tô primary, chưa tới thì muted.
const badgeClass = (reached: boolean): string =>
  reached ? 'border-transparent bg-primary text-primary-foreground' : 'bg-muted text-dim'

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
    // NOT through useLinkOpen on purpose: an auth flow has to land in the browser
    // where the user's real Claude login lives, and an auth code must never end up
    // in the agent's cookie jar. No chooser here.
    await sidecar.openExternal(authUrl)
    phase.value = 'waiting-code'
    await nextTick()
    codeInput.value?.$el?.focus()
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
