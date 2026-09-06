<template>
  <div class="acc">
    <div class="acc-row">
      <div class="acc-main">
        <div class="acc-title">{{ t('settings.devices.access.title') }}</div>
        <div class="acc-hint">{{ t('settings.devices.access.hint') }}</div>
      </div>
      <button class="btn sm" :title="t('settings.devices.access.copy')" @click="copy">
        <Icon
          :name="copied ? 'check' : 'copy'"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ copied ? t('settings.devices.access.copied') : t('settings.devices.access.copy') }}
      </button>
      <button class="btn sm" :title="t('settings.devices.access.qr')" @click="showQr = !showQr">
        <Icon name="scan" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ showQr ? t('settings.devices.access.hideQr') : t('settings.devices.access.qr') }}
      </button>
    </div>

    <code class="acc-url">{{ url }}</code>

    <div v-if="showQr" class="acc-qr">
      <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('settings.devices.access.qr')" />
      <div class="acc-qr-hint">{{ t('settings.devices.access.qrHint') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// The gateway's plain access URL + QR — how an ALREADY-PAIRED phone gets back to
// the PWA after closing the tab (its device token lives in that browser, so no
// re-pairing is needed; it only needs the address again).
//
// Deliberately NOT the pairing URL: no `#pair=` code here, so this QR is safe to
// leave on screen — scanning it grants nothing on its own.
import QRCode from 'qrcode'
import { computed, ref, watch } from 'vue'

const props = defineProps<{ host: string; port: number }>()

const { t } = useI18n()

const showQr = ref(false)
const qrDataUrl = ref('')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const url = computed(() => `http://${props.host}:${props.port}/`)

// Render lazily: the QR is only built once the user asks to see it (and again if
// the tailnet address changes underneath).
watch(
  [showQr, url],
  async ([open, address]) => {
    if (!open) return
    try {
      // margin: 3 bakes a white quiet-zone into the PNG so it scans on any theme.
      qrDataUrl.value = await QRCode.toDataURL(address, { margin: 3, width: 200 })
    } catch {
      qrDataUrl.value = ''
    }
  },
  { immediate: true },
)

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    // Clipboard blocked — the URL is on screen to type by hand.
  }
}
</script>

<style scoped>
.acc {
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  padding: 12px 14px;
  margin-bottom: 14px;
}
.acc-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.acc-main {
  flex: 1;
  min-width: 0;
}
.acc-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.acc-hint {
  margin-top: 2px;
  font-size: 12px;
  color: var(--textMuted);
  line-height: 1.5;
}
.acc-url {
  display: block;
  margin-top: 10px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bgInput);
  /* mono-ok: pairing URL */
  font-family: var(--code);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
  overflow-x: auto;
  white-space: nowrap;
}
.acc-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.acc-qr img {
  width: 200px;
  height: 200px;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  display: block;
}
.acc-qr-hint {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
  text-align: center;
}
</style>
