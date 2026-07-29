<template>
  <LibraryEntityModal
    :open="!!pairing"
    :title="t('settings.devices.pair.title')"
    :width="420"
    @close="emit('close')"
  >
    <div v-if="pairing" class="pair">
      <p class="pair-hint">{{ t('settings.devices.scanHint') }}</p>

      <div class="pair-qr">
        <img
          v-if="qrDataUrl && !expired"
          :src="qrDataUrl"
          :alt="t('settings.devices.pair.title')"
        />
        <div v-else class="pair-qr-expired">
          <Icon name="clock" style="width: 22px; height: 22px" />
          <span>{{ t('settings.devices.pair.expired') }}</span>
        </div>
      </div>

      <!-- Countdown vs regenerate: swap the live timer for a re-pair CTA once the
           code expires (the QR/text can no longer complete a pairing). -->
      <div v-if="!expired" class="pair-countdown">
        {{ t('settings.devices.expiresIn', { time: countdownLabel }) }}
      </div>
      <button v-else class="btn pri sm pair-regen" @click="emit('regenerate')">
        <Icon name="refresh" style="width: 13px; height: 13px" />
        {{ t('settings.devices.regenerate') }}
      </button>

      <div class="pair-fallback">
        <span class="pair-fallback-label">{{ t('settings.devices.codeFallback') }}</span>
        <code class="pair-code">{{ pairing.code }}</code>
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

<style scoped>
.pair {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.pair-hint {
  margin: 0;
  text-align: center;
  color: var(--textMuted);
  font-size: 1rem;
  line-height: 1.5;
}
.pair-qr {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bgSubtle);
}
.pair-qr img {
  width: 100%;
  height: 100%;
  display: block;
}
.pair-qr-expired {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--textDim);
  font-size: 1rem;
}
.pair-countdown {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
}
.pair-regen {
  align-self: center;
}
.pair-fallback {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  width: 100%;
  justify-content: center;
}
.pair-fallback-label {
  color: var(--textDim);
  font-size: 12px;
}
.pair-code {
  font-family: var(--code);
  font-size: 1.0769rem;
  letter-spacing: 0.12em;
  color: var(--text);
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 10px;
}
</style>
