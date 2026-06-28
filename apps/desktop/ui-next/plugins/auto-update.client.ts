import { useSettingsStore } from '~/stores/settings'
import { useSidecar } from '~/composables/useSidecar'
import type { UnlistenFn, UpdateEvent } from '~/composables/useSidecar'

// Client-only auto-update scheduler (ADR 0028). The renderer drives WHEN to check;
// the main process is reactive. This plugin makes settings.autoUpdate.enabled
// actually do something: when enabled (and running inside Electron) it asks the
// updater to check shortly after boot, then on a fixed interval. The "Check now"
// button in SettingsAbout stays an independent one-shot — both just call the same
// main-process check.
//
// We deliberately do NOT auto-download or auto-install here: autoDownload=false
// (ADR 0028) means the updater only reports availability; downloading/installing
// is a separate explicit user action surfaced elsewhere.
//
// Listener hygiene: this plugin owns ONE onUpdateEvent subscription used only to
// stamp settings.autoUpdate.lastCheckedAt when a scheduled check resolves. It is
// separate from SettingsAbout's subscription (which surfaces the transient inline
// status), so the two don't clobber each other.

// Delay the first check so it doesn't compete with boot work.
const FIRST_CHECK_DELAY_MS = 10_000
// Then re-check on this cadence while the app stays open.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

export default defineNuxtPlugin(() => {
  const sidecar = useSidecar()
  // Browser-dev (no Electron shell) has no updater bridge — nothing to schedule.
  if (!sidecar.available) return

  const settings = useSettingsStore()

  let intervalId: ReturnType<typeof setInterval> | null = null
  let firstTimerId: ReturnType<typeof setTimeout> | null = null
  let unlisten: UnlistenFn | null = null
  // Guard against overlapping checks (a slow check + a fired interval).
  let inFlight = false

  const stampLastChecked = (event: UpdateEvent) => {
    // 'checking' is the start signal; record the timestamp once it resolves.
    if (event.type === 'checking') return
    inFlight = false
    settings.updateAutoUpdate({ lastCheckedAt: new Date().toISOString() })
  }

  const runCheck = async () => {
    if (inFlight) return
    inFlight = true
    try {
      if (!unlisten) unlisten = await sidecar.onUpdateEvent(stampLastChecked)
      await sidecar.checkForUpdates()
    } catch {
      // Network/updater errors are non-fatal for the scheduler; the next tick
      // (or a manual "Check now") will retry. Clear the in-flight guard so a
      // failed check doesn't wedge the scheduler.
      inFlight = false
    }
  }

  const stop = () => {
    if (firstTimerId) {
      clearTimeout(firstTimerId)
      firstTimerId = null
    }
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }

  const start = () => {
    stop()
    firstTimerId = setTimeout(runCheck, FIRST_CHECK_DELAY_MS)
    intervalId = setInterval(runCheck, CHECK_INTERVAL_MS)
  }

  // React to the toggle: start scheduling when enabled, tear the timers down when
  // disabled. `immediate` so we honour the persisted value on boot.
  watch(
    () => settings.autoUpdate.enabled,
    (enabled) => {
      if (enabled) start()
      else stop()
    },
    { immediate: true },
  )

  // Best-effort cleanup if the app context ever tears down (HMR / window close).
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      stop()
      unlisten?.()
      unlisten = null
    })
  }
})
