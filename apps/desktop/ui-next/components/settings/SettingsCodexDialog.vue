<template>
  <SettingsModelDialog
    :open="open"
    :title="t('settingsModels.codex.title')"
    lock-scrim
    @close="onCancel"
  >
    <div class="flex flex-col gap-3.5">
      <!-- Starting: waiting for the sidecar to build the authorize URL -->
      <div v-if="phase === 'starting'" class="flex items-center gap-2 text-foreground">
        <span
          class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary"
        />
        <span>{{ t('settingsModels.codex.preparing') }}</span>
      </div>

      <!-- URL ready: the browser was opened; wait for the loopback callback -->
      <template v-else-if="phase === 'waiting'">
        <div class="text-foreground">{{ t('settingsModels.codex.opened') }}</div>
        <Button v-if="authUrl" type="button" class="w-full" variant="default" @click="onOpen">
          <Icon name="agents" class="size-3.5" />
          <span>{{ t('settingsModels.codex.reopen') }}</span>
        </Button>
        <div class="flex items-center gap-2 text-dim">
          <span
            class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-primary"
          />
          <span>{{ t('settingsModels.codex.waiting') }}</span>
        </div>
      </template>

      <Alert
        v-if="error"
        variant="destructive"
        class="border-destructive/50 bg-destructive/10 px-3 py-2"
      >
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>

    <template #footer>
      <Button type="button" variant="outline" size="sm" @click="onCancel">
        {{ t('settingsModels.form.cancel') }}
      </Button>
    </template>
  </SettingsModelDialog>
</template>

<script setup lang="ts">
import SettingsModelDialog from '~/components/settings/SettingsModelDialog.vue'
import { useSettingsStore, type ProviderAccount } from '~/stores/settings'
import {
  SidecarError,
  SidecarUnavailableError,
  useSidecar,
  type UnlistenFn,
} from '~/composables/useSidecar'

// OpenAI Codex (ChatGPT subscription) sign-in. Long-lived: generate a flowId,
// subscribe to `auth.oauth-url` matching it → openExternal(url);
// connectOpenAiCodex(flowId) resolves on authorize; cancelOAuth(flowId) on close.
// A CANCELED error closes silently. Ported from legacy SettingsCodexSignInDialog.
type Phase = 'starting' | 'waiting' | 'error'

type OAuthUrlInfo = {
  provider: string
  flowId: string
  url: string
  instructions?: string
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  connected: [account: ProviderAccount]
}>()

const { t } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()

const phase = ref<Phase>('starting')
const authUrl = ref<string | null>(null)
const error = ref<string | null>(null)
const flowId = ref<string>('')
const unlisten = ref<UnlistenFn | null>(null)
// Whether the long-lived connect promise settled (so cancel/close skips the abort
// RPC after success/failure).
const settled = ref(false)

const errorMessageFrom = (err: unknown): string => {
  if (err instanceof SidecarUnavailableError) return t('settingsModels.error.sidecarUnavailable')
  if (err instanceof SidecarError) {
    if (err.message.includes('CANCELED')) return t('settingsModels.error.signInCancelled')
    return err.message || `Sidecar error ${err.code}`
  }
  if (err instanceof Error) return err.message
  return t('settingsModels.error.unknown')
}

const newFlowId = (): string => `codex_${Math.random().toString(36).slice(2)}_${Date.now()}`

const cleanup = () => {
  if (unlisten.value) {
    unlisten.value()
    unlisten.value = null
  }
}

const openAuthUrl = async () => {
  if (!authUrl.value) return
  try {
    // NOT through useLinkOpen: same reason as the Anthropic dialog — an OAuth flow
    // belongs in the user's own browser, never in the agent's partition.
    await sidecar.openExternal(authUrl.value)
  } catch (err) {
    error.value = errorMessageFrom(err)
  }
}

const start = async () => {
  phase.value = 'starting'
  authUrl.value = null
  error.value = null
  settled.value = false
  flowId.value = newFlowId()

  // Subscribe BEFORE starting so we never miss the authorize-url event.
  try {
    unlisten.value = await sidecar.onEvent((event) => {
      if (event.type !== 'auth.oauth-url') return
      const payload = event.payload as OAuthUrlInfo
      if (payload.flowId !== flowId.value) return
      authUrl.value = payload.url
      phase.value = 'waiting'
      void openAuthUrl()
    })
  } catch (err) {
    phase.value = 'error'
    error.value = errorMessageFrom(err)
    return
  }

  try {
    const account = await settings.connectOpenAiCodex(flowId.value)
    settled.value = true
    cleanup()
    emit('connected', account)
    emit('close')
  } catch (err) {
    settled.value = true
    cleanup()
    // A cancel surfaces as CANCELED — close quietly instead of showing it.
    if (err instanceof SidecarError && err.message.includes('CANCELED')) {
      emit('close')
      return
    }
    phase.value = 'error'
    error.value = errorMessageFrom(err)
  }
}

const onOpen = () => {
  void openAuthUrl()
}

const onCancel = () => {
  if (!settled.value && flowId.value) {
    settings.cancelOAuth(flowId.value).catch(() => {
      // Best-effort; the start RPC rejects with CANCELED and closes anyway.
    })
  }
  cleanup()
  emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void start()
    else cleanup()
  },
)

onBeforeUnmount(cleanup)
</script>
