// Auto-update settings — persisted in localStorage (same pattern as
// `useGitSettings` / `useAppearance`). Call once at app start so the persisted
// `enabled` toggle is loaded before the update store decides whether to schedule
// background checks (ADR 0028).
import { storeToRefs } from 'pinia'
import {
  DEFAULT_AUTO_UPDATE_SETTINGS,
  useSettingsStore,
  type AutoUpdateSettings,
} from '~/stores/settings'

const STORAGE_KEY = 'awog.autoUpdate.v1'

const coerce = (raw: unknown): AutoUpdateSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_AUTO_UPDATE_SETTINGS.enabled,
    lastCheckedAt: typeof v.lastCheckedAt === 'string' ? v.lastCheckedAt : null,
  }
}

const loadFromStorage = (): AutoUpdateSettings | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerce(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (s: AutoUpdateSettings) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useUpdateSettings = () => {
  const store = useSettingsStore()
  const { autoUpdate } = storeToRefs(store)
  const initialized = useState('autoUpdateSettings:initialized', () => false)

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.autoUpdate = persisted
    watch(
      autoUpdate,
      (next) => {
        writeToStorage(next)
      },
      { deep: true },
    )
    initialized.value = true
  }

  return {
    autoUpdate,
    update: store.updateAutoUpdate,
    defaults: DEFAULT_AUTO_UPDATE_SETTINGS,
  }
}
