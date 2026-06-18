import { useSettingsStore } from '~/stores/settings'

const SNAPSHOT_DEBOUNCE_MS = 400

// Bridge between localStorage (fast FOUC cache) and ~/.awog/settings.json
// (durable source of truth, written by the sidecar). See ADR 0045.
export const useSettingsSync = () => {
  const store = useSettingsStore()
  const sidecar = useSidecar()
  const { themeName, setTheme } = useTheme()
  const initialized = useState('settingsSync:initialized', () => false)

  // Plain, serializable snapshot of every persisted slice (accounts excluded).
  const snapshot = () => ({
    version: 1,
    themeMode: themeName.value,
    appearance: { ...store.appearance },
    defaults: { ...store.defaults },
    git: { ...store.git },
    autoUpdate: { ...store.autoUpdate },
    composer: { ...store.composer },
    quotaWarning: { ...store.quotaWarning },
    workspacePath: store.workspacePath,
    autoApprove: store.autoApprove,
    notificationsEnabled: store.notificationsEnabled,
    autoCompact: store.autoCompact,
  })

  // Suppress the write-back the deep-watch would fire while we apply file values.
  let suppressWrite = false

  // File → store. Coerce every slice (file is untrusted L1 input) before applying.
  const distribute = (raw: Record<string, unknown>) => {
    suppressWrite = true
    try {
      if (raw.appearance) store.appearance = coerceAppearance(raw.appearance)
      if (raw.defaults) store.defaults = coerceSessionDefaults(raw.defaults)
      if (raw.git) store.git = coerceGitSettings(raw.git)
      if (raw.autoUpdate) store.autoUpdate = coerceAutoUpdateSettings(raw.autoUpdate)
      if (raw.composer) store.composer = coerceComposerSettings(raw.composer)
      if (raw.quotaWarning) store.quotaWarning = coerceQuotaWarningSettings(raw.quotaWarning)
      if (typeof raw.workspacePath === 'string') store.workspacePath = raw.workspacePath
      if (typeof raw.autoApprove === 'boolean') store.autoApprove = raw.autoApprove
      if (typeof raw.notificationsEnabled === 'boolean')
        store.notificationsEnabled = raw.notificationsEnabled
      if (typeof raw.autoCompact === 'boolean') store.autoCompact = raw.autoCompact
      if (raw.themeMode === 'dark' || raw.themeMode === 'light') setTheme(raw.themeMode)
    } finally {
      // Release after the watcher flush so the applied values don't echo back.
      nextTick(() => {
        suppressWrite = false
      })
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  const scheduleWrite = () => {
    if (suppressWrite) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      sidecar.request('settings.set', { patch: snapshot() }).catch(() => {
        // Sidecar offline (browser dev) — localStorage cache still applies.
      })
    }, SNAPSHOT_DEBOUNCE_MS)
  }

  // Boot: pull the file (source of truth). If present → apply; else seed it.
  const hydrate = async () => {
    try {
      const raw = await sidecar.request<Record<string, unknown>>('settings.get')
      if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
        distribute(raw)
      } else {
        await sidecar.request('settings.set', { patch: snapshot() })
      }
    } catch {
      // Sidecar offline / unavailable — localStorage cache already applied.
    }
  }

  if (import.meta.client && !initialized.value) {
    initialized.value = true
    watch(snapshot, scheduleWrite, { deep: true })
  }

  return { hydrate }
}
