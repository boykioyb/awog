import { useSidecar } from '~/composables/useSidecar'
import { useUpdateStore } from '~/stores/update'

// Client-only auto-update wiring (ADR 0028). The update store owns the state
// machine, the event subscription, and the background-check schedule
// (honouring settings.autoUpdate.enabled); this plugin just kicks off that
// single app-lifetime subscription once the Electron bridge is present.
//
// We deliberately do NOT auto-download or auto-install: autoDownload=false
// (ADR 0028) means the updater only reports availability. Downloading /
// installing is an explicit user action surfaced by the global UpdateBanner and
// the Settings → About panel.

export default defineNuxtPlugin(() => {
  const sidecar = useSidecar()
  // Browser-dev (no Electron shell) has no updater bridge — nothing to wire.
  if (!sidecar.available) return

  const update = useUpdateStore()
  let cleanup: (() => void) | null = null
  void update.subscribe().then((fn) => {
    cleanup = fn
  })

  // Best-effort cleanup if the app context tears down (HMR / window close).
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      cleanup?.()
      cleanup = null
    })
  }
})
