import { acceptHMRUpdate, defineStore } from 'pinia'
import type { UpdateEvent } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import { nowIso } from '~/utils/time'

// Live auto-update state machine (ADR 0028). Transient — driven by updater
// events forwarded from the Electron main process; nothing here is persisted
// (the user's toggle lives in settings via `useUpdateSettings`).

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

const INITIAL_DELAY_MS = 10_000 // first check, after startup settles
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // every 4h while running
const FOCUS_MIN_GAP_MS = 30 * 60 * 1000 // debounce focus-triggered checks

export const useUpdateStore = defineStore('update', () => {
  const status = ref<UpdateStatus>('idle')
  const currentVersion = ref('')
  const newVersion = ref<string | null>(null)
  const progressPercent = ref(0)
  const canAutoInstall = ref(false)
  const isPackaged = ref(false)
  const dismissed = ref(false)
  const errorMessage = ref<string | null>(null)

  // True once the user kicked off a flow (manual check or a download they
  // started) — gates the error banner so background failures stay silent.
  const userActive = ref(false)

  // Non-reactive bookkeeping (store is a singleton, so these persist for its life).
  let lastShownVersion: string | null = null
  let lastCheckMs = 0

  // Banner shows for the update lifecycle. Background-check errors stay silent
  // (spec AC7); errors surface only when the user initiated the flow.
  const bannerVisible = computed(() => {
    if (dismissed.value) return false
    if (
      status.value === 'available' ||
      status.value === 'downloading' ||
      status.value === 'downloaded'
    )
      return true
    if (status.value === 'error' && userActive.value) return true
    return false
  })

  const settingsEnabled = (): boolean => useSettingsStore().autoUpdate.enabled

  function routeEvent(event: UpdateEvent): void {
    switch (event.type) {
      case 'checking':
        status.value = 'checking'
        errorMessage.value = null
        break
      case 'available':
        // Don't re-nag a version the user already dismissed this session.
        if (event.version === lastShownVersion && dismissed.value) break
        newVersion.value = event.version
        lastShownVersion = event.version
        dismissed.value = false
        status.value = 'available'
        break
      case 'not-available':
        newVersion.value = null
        status.value = 'not-available'
        break
      case 'progress':
        status.value = 'downloading'
        progressPercent.value = event.percent
        break
      case 'downloaded':
        newVersion.value = event.version
        progressPercent.value = 100
        dismissed.value = false // a finished download is worth showing again
        status.value = 'downloaded'
        break
      case 'error':
        errorMessage.value = event.message
        status.value = 'error'
        break
      default:
        break
    }
  }

  async function runCheck(manual: boolean): Promise<void> {
    if (!isPackaged.value) return
    const sidecar = useSidecar()
    if (!sidecar.available) return
    if (manual) userActive.value = true
    lastCheckMs = Date.now()
    useSettingsStore().updateAutoUpdate({ lastCheckedAt: nowIso() })
    try {
      await sidecar.checkForUpdates()
    } catch {
      // Outcome (incl. errors) arrives via updater events; nothing to do here.
    }
  }

  async function checkNow(): Promise<void> {
    await runCheck(true)
  }

  async function download(): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    userActive.value = true
    status.value = 'downloading'
    progressPercent.value = 0
    await sidecar.downloadUpdate().catch(() => {})
  }

  async function restart(): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    await sidecar.installUpdate().catch(() => {})
  }

  async function openReleases(): Promise<void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    await sidecar.openReleasesPage().catch(() => {})
  }

  function dismiss(): void {
    dismissed.value = true
    if (status.value === 'error') {
      status.value = 'idle'
      userActive.value = false
    }
  }

  // App-lifetime subscription (called from app.vue). Reads app info, listens for
  // updater events, and schedules background checks honoring the user's toggle.
  async function subscribe(): Promise<() => void> {
    const sidecar = useSidecar()
    if (!sidecar.available) return () => {}

    try {
      const info = await sidecar.getAppInfo()
      currentVersion.value = info.version
      isPackaged.value = info.isPackaged
      canAutoInstall.value = info.canAutoInstall
    } catch {
      return () => {}
    }

    let unlisten: () => void = () => {}
    try {
      unlisten = await sidecar.onUpdateEvent(routeEvent)
    } catch {
      return () => {}
    }

    const scheduledCheck = (): void => {
      if (isPackaged.value && settingsEnabled()) runCheck(false)
    }
    const initial = window.setTimeout(scheduledCheck, INITIAL_DELAY_MS)
    const interval = window.setInterval(scheduledCheck, CHECK_INTERVAL_MS)
    const onFocus = (): void => {
      if (Date.now() - lastCheckMs >= FOCUS_MIN_GAP_MS) scheduledCheck()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearTimeout(initial)
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      unlisten()
    }
  }

  return {
    status,
    currentVersion,
    newVersion,
    progressPercent,
    canAutoInstall,
    isPackaged,
    dismissed,
    errorMessage,
    bannerVisible,
    subscribe,
    checkNow,
    download,
    restart,
    openReleases,
    dismiss,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useUpdateStore, import.meta.hot))
}
