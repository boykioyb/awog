import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { pushActionToast } from '~/composables/useActionToasts'
import { useConfirm } from '~/composables/useConfirm'
import type { AwogGatewayStatus, AwogPairingInfo, AwogRemoteDevice } from '~/types/awog-bridge'

// Wave 2 of Mobile Remote Control — renderer controller for the Electron main
// gateway (`window.awog.gateway`). Owns the tailnet status, the paired-device
// list, and the currently-open pairing session, and mirrors them live via the
// gateway's change events.
//
// Browser-dev (no bridge) → `available = false` and every action is a no-op, so
// the Devices panel degrades to an inert placeholder rather than throwing. Load
// status + devices on mount; subscribe on mount and unsubscribe on unmount
// (page-controller lifecycle — the composable is called from SettingsDevices).
export function useRemoteGateway() {
  const gw = typeof window !== 'undefined' ? window.awog?.gateway : undefined
  const available = !!gw

  const { t } = useI18n()
  const { confirm } = useConfirm()

  const status = ref<AwogGatewayStatus | null>(null)
  const devices = ref<AwogRemoteDevice[]>([])
  // The pairing session shown in the modal (null = closed). The code itself
  // expires main-side; we only hold the info needed to render the QR + countdown.
  const pairing = ref<AwogPairingInfo | null>(null)
  const pairingBusy = ref(false)

  const connected = computed(() => status.value?.tailnet === 'connected')
  const host = computed(() => status.value?.host ?? '')

  function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function refresh(): Promise<void> {
    if (!gw) return
    try {
      const [s, d] = await Promise.all([gw.status(), gw.listDevices()])
      status.value = s
      devices.value = d
    } catch (err) {
      pushActionToast(t('settings.devices.loadFailed', { error: errText(err) }), 'error')
    }
  }

  // Open (or regenerate) a pairing session. Guarded by `connected` at the call
  // site; the gateway also rejects when the tailnet is down, surfaced as a toast.
  async function createPairing(): Promise<void> {
    if (!gw || pairingBusy.value) return
    pairingBusy.value = true
    try {
      pairing.value = await gw.createPairing()
    } catch (err) {
      pushActionToast(t('settings.devices.pairFailed', { error: errText(err) }), 'error')
    } finally {
      pairingBusy.value = false
    }
  }

  function closePairing(): void {
    pairing.value = null
  }

  async function revokeDevice(device: AwogRemoteDevice): Promise<void> {
    if (!gw) return
    const ok = await confirm({
      title: t('settings.devices.confirmRevoke.title'),
      description: t('settings.devices.confirmRevoke.body', { label: device.label }),
      kind: 'danger',
    })
    if (!ok) return
    try {
      await gw.revokeDevice(device.id)
      // Optimistic removal for snappiness; onDevicesChanged reconciles the truth.
      devices.value = devices.value.filter((d) => d.id !== device.id)
      pushActionToast(t('settings.devices.revoked', { label: device.label }), 'success')
    } catch (err) {
      pushActionToast(t('settings.devices.revokeFailed', { error: errText(err) }), 'error')
    }
  }

  let offDevices: (() => void) | undefined
  let offStatus: (() => void) | undefined

  onMounted(() => {
    if (!gw) return
    void refresh()
    offDevices = gw.onDevicesChanged((d) => {
      devices.value = d
    })
    offStatus = gw.onStatusChanged((s) => {
      status.value = s
      // Tailnet dropped while a pairing modal is open → the code is unreachable,
      // so close it rather than show a stale QR that no device can consume.
      if (s.tailnet !== 'connected') pairing.value = null
    })
  })

  onBeforeUnmount(() => {
    offDevices?.()
    offStatus?.()
  })

  return {
    available,
    status,
    devices,
    pairing,
    pairingBusy,
    connected,
    host,
    refresh,
    createPairing,
    closePairing,
    revokeDevice,
  }
}
