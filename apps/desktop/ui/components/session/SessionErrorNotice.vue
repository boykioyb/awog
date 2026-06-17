<template>
  <div
    class="rounded-lg px-3 py-2.5 flex flex-col gap-2"
    :style="{ background: t.dangerBg, border: `1px solid ${t.dangerBorder}` }"
  >
    <div class="flex items-start gap-2">
      <TriangleAlert :size="14" class="flex-shrink-0 mt-0.5" :style="{ color: t.danger }" />
      <div class="flex-1 min-w-0">
        <div class="text-[1em] font-medium" :style="{ color: t.danger }">
          {{ tr('session.error.title') }}
        </div>
        <!-- Full provider/runtime cause. Monospace + pre-wrap so a multi-line
             stack or JSON body stays readable; capped height with scroll so a
             huge body can't push the composer off-screen. -->
        <div
          class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed"
          :style="{ color: t.text }"
        >
          {{ message }}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <AppButton variant="danger" size="sm" :disabled="disabled" @click="onRetry">
        <RefreshCw :size="13" />
        <span>{{ tr('session.error.retry') }}</span>
      </AppButton>
      <AppButton variant="ghost" size="sm" @click="onCopy">
        <Check v-if="copied" :size="13" />
        <Copy v-else :size="13" />
        <span>{{ copied ? tr('session.msg.copied') : tr('session.error.copy') }}</span>
      </AppButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy, RefreshCw, TriangleAlert } from 'lucide-vue-next'

const props = defineProps<{
  // Id of the failed agent message — retry re-runs the user turn that produced it.
  messageId: string
  // Human-readable error cause (provider message / thrown error / RPC detail).
  message: string
  // True while the session has a live turn — hide retry so it can't race an
  // in-flight reply (regenerate truncates the transcript).
  disabled?: boolean
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useSessionsStore()

// Retry = regenerate this turn: drop the failed reply + its user message and
// re-send with the same settings. Guarded against a live turn via `disabled`.
const onRetry = () => {
  if (props.disabled) return
  void store.regenerate(props.messageId)
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const onCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.message)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // ignore — clipboard may be denied in restricted contexts
  }
}
</script>
