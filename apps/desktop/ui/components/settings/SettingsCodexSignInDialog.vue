<template>
  <!-- Teleport ra body: ancestor Liquid Glass (backdrop-filter/transform) tạo
       containing block mới cho position:fixed → overlay phải teleport mới phủ
       toàn viewport. -->
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      :style="{ background: t.overlay }"
      @click.self="onCancel"
    >
      <div
        class="w-full max-w-md rounded-xl shadow-xl"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="px-4 py-3 flex items-center justify-between"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <div class="text-[1em] font-semibold" :style="{ color: t.text }">
            Sign in with ChatGPT
          </div>
          <button
            type="button"
            class="p-1.5 rounded-md transition flex items-center"
            :style="{ color: t.textDim }"
            aria-label="Close"
            @click="onCancel"
          >
            <X :size="14" />
          </button>
        </div>

        <div class="px-4 py-4 space-y-4">
          <!-- Starting: waiting for the sidecar to build the authorize URL -->
          <div
            v-if="phase === 'starting'"
            class="flex items-center gap-2"
            :style="{ color: t.text }"
          >
            <Loader2 :size="14" class="animate-spin shrink-0" />
            <span class="text-[1em]">Preparing OpenAI sign-in…</span>
          </div>

          <!-- URL ready: the browser was opened; wait for the loopback callback -->
          <template v-else-if="phase === 'waiting'">
            <div class="text-[1em]" :style="{ color: t.text }">
              A browser window was opened to sign in with ChatGPT. Complete the login there — this
              dialog finishes automatically once you authorize.
            </div>
            <button
              v-if="authUrl"
              type="button"
              class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[1em] font-medium transition"
              :style="{ background: t.accent, color: t.accentText, border: 'none' }"
              @click="onOpen"
            >
              <ExternalLink :size="13" />
              <span>Reopen sign-in page</span>
            </button>
            <div class="flex items-center gap-2 text-[1em]" :style="{ color: t.textDim }">
              <Loader2 :size="13" class="animate-spin shrink-0" />
              <span>Waiting for authorization…</span>
            </div>
          </template>

          <div
            v-if="error"
            class="rounded-lg px-3 py-2 text-[1em]"
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
            class="px-3 py-1.5 text-[1em] rounded-lg transition"
            :style="{
              background: 'transparent',
              border: `1px solid ${t.borderStrong}`,
              color: t.text,
            }"
            @click="onCancel"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ExternalLink, Loader2, X } from 'lucide-vue-next'
import type { ProviderAccount } from '~/types'
import { SidecarError, SidecarUnavailableError } from '~/composables/useSidecar'

type Phase = 'starting' | 'waiting' | 'error'

// Payload of the sidecar `auth.oauth-url` event — the public OAuth authorize URL
// (no secret) the user opens to complete the browser/loopback login.
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

const { t } = useTheme()
const settings = useSettingsStore()
const sidecar = useSidecar()

const phase = ref<Phase>('starting')
const authUrl = ref<string | null>(null)
const error = ref<string | null>(null)
const flowId = ref<string>('')
const unlisten = ref<(() => void) | null>(null)
// Whether the long-lived connect promise has settled (so cancel/close skip the
// abort RPC after success/failure).
const settled = ref(false)

const errorMessageFrom = (err: unknown): string => {
  if (err instanceof SidecarUnavailableError) {
    return 'Sidecar unavailable. Make sure you are running the desktop app.'
  }
  if (err instanceof SidecarError) {
    if (err.message.includes('CANCELED')) return 'Sign-in cancelled.'
    return err.message || `Sidecar error ${err.code}`
  }
  if (err instanceof Error) return err.message
  return 'Unknown error'
}

const newFlowId = (): string => `codex_${Math.random().toString(36).slice(2)}_${Date.now()}`

const cleanup = () => {
  if (unlisten.value) {
    unlisten.value()
    unlisten.value = null
  }
}

// Open the authorize URL in the OS browser. Best-effort: a failure just leaves
// the "Reopen sign-in page" button for a manual retry.
const openAuthUrl = async () => {
  if (!authUrl.value) return
  try {
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
      // Auto-open the browser; the button stays for manual reopen.
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
    // A cancel surfaces as CANCELED — just close quietly instead of showing it.
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
  // Abort the in-flight login (no-op on the sidecar if already settled).
  if (!settled.value && flowId.value) {
    settings.cancelOAuth(flowId.value).catch(() => {
      // Best-effort; the start RPC will reject with CANCELED and close anyway.
    })
  }
  cleanup()
  emit('close')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) start()
    else cleanup()
  },
)

onBeforeUnmount(cleanup)
</script>
