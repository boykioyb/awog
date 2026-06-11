// RTK token optimizer settings (ADR 0031) — persisted in localStorage (same
// pattern as `useUpdateSettings` / `useGitSettings`) and pushed to the sidecar's
// Bash tool via the `settings.set-rtk` RPC. Call once at app start (app.vue) so
// the persisted toggle reaches the engine before any agent runs a shell command.
import { storeToRefs } from 'pinia'
import { DEFAULT_RTK_SETTINGS, useSettingsStore, type RtkSettings } from '~/stores/settings'

const STORAGE_KEY = 'awog.rtk.v1'

const coerce = (raw: unknown): RtkSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_RTK_SETTINGS.enabled,
  }
}

const loadFromStorage = (): RtkSettings | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerce(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (s: RtkSettings) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useRtkSettings = () => {
  const store = useSettingsStore()
  const { rtk, rtkStatus } = storeToRefs(store)
  const sidecar = useSidecar()
  const initialized = useState('rtkSettings:initialized', () => false)

  // Push the current toggle to the engine and capture the bundled-binary status
  // (whether it loaded on this platform + version). Best-effort: the engine may
  // not be ready on the very first call — the toggle defaults ON sidecar-side and
  // is re-pushed on change / when the Settings panel mounts.
  const sync = async (): Promise<void> => {
    if (!sidecar.available) return
    try {
      const status = await sidecar.request<{ available: boolean; version?: string }>(
        'settings.set-rtk',
        { enabled: rtk.value.enabled },
      )
      store.setRtkStatus({ available: status.available, version: status.version })
    } catch {
      // Engine offline / not ready — leave status as-is.
    }
  }

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.rtk = persisted
    watch(
      rtk,
      (next) => {
        writeToStorage(next)
        void sync()
      },
      { deep: true },
    )
    void sync()
    initialized.value = true
  }

  return {
    rtk,
    rtkStatus,
    update: store.updateRtk,
    sync,
    defaults: DEFAULT_RTK_SETTINGS,
  }
}
