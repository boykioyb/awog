<template>
  <LibraryEntityModal
    :open="!!pairing"
    :title="t('settings.devices.pair.title')"
    :width="420"
    @close="emit('close')"
  >
    <div v-if="pairing" class="flex flex-col items-center gap-3.5">
      <p class="m-0 text-center text-base text-muted-foreground">
        {{ t('settings.devices.scanHint') }}
      </p>

      <div
        class="flex size-60 items-center justify-center overflow-hidden rounded-lg border bg-muted"
      >
        <img
          v-if="qrDataUrl && !expired"
          :src="qrDataUrl"
          :alt="t('settings.devices.pair.title')"
          class="block size-full"
        />
        <div v-else class="flex flex-col items-center gap-2 text-base text-dim">
          <Icon name="clock" class="size-5.5" />
          <span>{{ t('settings.devices.pair.expired') }}</span>
        </div>
      </div>

      <!-- Countdown vs regenerate: swap the live timer for a re-pair CTA once the
           code expires (the QR/text can no longer complete a pairing). -->
      <div v-if="!expired" class="text-sm text-dim tabular-nums">
        {{ t('settings.devices.expiresIn', { time: countdownLabel }) }}
      </div>
      <Button v-else class="self-center" variant="default" size="sm" @click="emit('regenerate')">
        <Icon name="refresh" class="size-3.5" />
        {{ t('settings.devices.regenerate') }}
      </Button>

      <Separator />
      <div class="flex w-full items-center justify-center gap-2">
        <span class="text-sm text-dim">{{ t('settings.devices.codeFallback') }}</span>
        <!-- mono-ok: mã ghép nối — gõ từng ký tự trên điện thoại -->
        <code
          class="rounded-md border bg-background px-2.5 py-1 font-mono text-lg tracking-widest text-foreground"
        >
          {{ pairing.code }}
        </code>
      </div>
    </div>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// The pairing QR + countdown modal (Wave 2). Encodes the URL a device opens to
// pair: `http://{host}:{port}/#pair={code}` — the Wave 3 PWA reads `#pair=` from
// `location.hash` and derives host/port from the URL it was opened at, so this
// exact shape is a cross-wave contract. The code expires main-side; here we only
// show a live countdown and, once past `expiresAt`, a "generate new code" CTA.
import QRCode from 'qrcode'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { AwogPairingInfo } from '~/types/awog-bridge'

const props = defineProps<{
  pairing: AwogPairingInfo | null
}>()

const emit = defineEmits<{
  regenerate: []
  close: []
}>()

const { t } = useI18n()

const qrDataUrl = ref('')
// A 1s ticker (only while a pairing is open) drives the countdown — useNow's 30s
// cadence is too coarse for an mm:ss timer.
const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

const expired = computed(() => !props.pairing || nowMs.value >= props.pairing.expiresAt)

const countdownLabel = computed(() => {
  if (!props.pairing) return '0:00'
  const remainingSec = Math.max(0, Math.ceil((props.pairing.expiresAt - nowMs.value) / 1000))
  const min = Math.floor(remainingSec / 60)
  const sec = remainingSec % 60
  return `${min}:${String(sec).padStart(2, '0')}`
})

function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = undefined
  }
}

// The Wave 3 pairing URL — kept as a single source so the QR always matches the
// text fallback below it.
function pairingUrl(info: AwogPairingInfo): string {
  return `http://${info.host}:${info.port}/#pair=${info.code}`
}

watch(
  () => props.pairing,
  async (info) => {
    stopTicker()
    qrDataUrl.value = ''
    if (!info) return
    nowMs.value = Date.now()
    ticker = setInterval(() => {
      nowMs.value = Date.now()
    }, 1000)
    try {
      // margin: 3 bakes a white quiet-zone into the PNG itself, so the code stays
      // scannable on any theme surface without a hardcoded white container.
      qrDataUrl.value = await QRCode.toDataURL(pairingUrl(info), { margin: 3, width: 240 })
    } catch {
      qrDataUrl.value = ''
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopTicker)
</script>
