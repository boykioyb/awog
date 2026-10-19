<template>
  <div class="mb-4 rounded-lg border bg-muted px-3.5 py-3">
    <div class="flex items-center gap-2.5">
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-foreground">
          {{ t('settings.devices.access.title') }}
        </div>
        <div class="mt-0.5 text-sm text-muted-foreground">
          {{ t('settings.devices.access.hint') }}
        </div>
      </div>
      <Button :title="t('settings.devices.access.copy')" variant="outline" size="sm" @click="copy">
        <Icon :name="copied ? 'check' : 'copy'" class="size-3.5" />
        {{ copied ? t('settings.devices.access.copied') : t('settings.devices.access.copy') }}
      </Button>
      <Button
        :title="t('settings.devices.access.qr')"
        variant="outline"
        size="sm"
        @click="showQr = !showQr"
      >
        <Icon name="scan" class="size-3.5" />
        {{ showQr ? t('settings.devices.access.hideQr') : t('settings.devices.access.qr') }}
      </Button>
    </div>

    <!-- mono-ok: URL truy cập gateway -->
    <code
      class="mt-2.5 block overflow-x-auto rounded-md border bg-background px-2.5 py-1.5 font-mono text-base whitespace-nowrap text-foreground"
    >
      {{ url }}
    </code>

    <div v-if="showQr" class="mt-3 flex flex-col items-center gap-2">
      <img
        v-if="qrDataUrl"
        :src="qrDataUrl"
        :alt="t('settings.devices.access.qr')"
        class="block size-50 rounded-lg border"
      />
      <div class="text-center text-sm text-faint">{{ t('settings.devices.access.qrHint') }}</div>
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
// the mesh address changes underneath).
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
