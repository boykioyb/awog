// Quota warning settings — persisted in localStorage (same pattern as
// `useComposerSettings`). Client-only: the quota store reads these refs directly
// to decide when to warn / auto-abort. Nothing is pushed to the sidecar.
import { storeToRefs } from 'pinia'
import {
  DEFAULT_QUOTA_WARNING_SETTINGS,
  QUOTA_THRESHOLD_MAX,
  QUOTA_THRESHOLD_MIN,
  useSettingsStore,
  type QuotaWarningSettings,
} from '~/stores/settings'

const STORAGE_KEY = 'awog.quota-warning.v1'

// Clamp so a corrupt persisted value can't disable the feature outright or fire
// on every poll.
const clampThreshold = (n: number): number =>
  Math.min(QUOTA_THRESHOLD_MAX, Math.max(QUOTA_THRESHOLD_MIN, Math.round(n)))

export const coerceQuotaWarningSettings = (raw: unknown): QuotaWarningSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const threshold =
    typeof v.threshold === 'number' && Number.isFinite(v.threshold)
      ? clampThreshold(v.threshold)
      : DEFAULT_QUOTA_WARNING_SETTINGS.threshold
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_QUOTA_WARNING_SETTINGS.enabled,
    threshold,
    abortSessionsOnThreshold:
      typeof v.abortSessionsOnThreshold === 'boolean'
        ? v.abortSessionsOnThreshold
        : DEFAULT_QUOTA_WARNING_SETTINGS.abortSessionsOnThreshold,
    blockNewSessionsOnThreshold:
      typeof v.blockNewSessionsOnThreshold === 'boolean'
        ? v.blockNewSessionsOnThreshold
        : DEFAULT_QUOTA_WARNING_SETTINGS.blockNewSessionsOnThreshold,
  }
}

const loadFromStorage = (): QuotaWarningSettings | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerceQuotaWarningSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (q: QuotaWarningSettings) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(q))
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useQuotaWarningSettings = () => {
  const store = useSettingsStore()
  const { quotaWarning } = storeToRefs(store)
  const initialized = useState('quotaWarningSettings:initialized', () => false)

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.quotaWarning = persisted
    watch(
      quotaWarning,
      (next) => {
        writeToStorage(next)
      },
      { deep: true },
    )
    initialized.value = true
  }

  return {
    quotaWarning,
    update: store.updateQuotaWarning,
    defaults: DEFAULT_QUOTA_WARNING_SETTINGS,
    thresholdMin: QUOTA_THRESHOLD_MIN,
    thresholdMax: QUOTA_THRESHOLD_MAX,
  }
}
