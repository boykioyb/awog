// Composer behaviour settings — persisted in localStorage (same pattern as
// `useGitSettings`). Client-only: nothing is pushed to the sidecar, the composer
// reads these refs directly to decide whether a large paste becomes a `.txt`
// attachment.
import { storeToRefs } from 'pinia'
import {
  DEFAULT_COMPOSER_SETTINGS,
  useSettingsStore,
  type ComposerSettings,
} from '~/stores/settings'

const STORAGE_KEY = 'awog.composer.v1'

// Clamp the threshold to a sane range so a corrupt persisted value can't disable
// the feature outright or fire on every keystroke.
const PASTE_THRESHOLD_MIN = 200
const PASTE_THRESHOLD_MAX = 100_000

const coerce = (raw: unknown): ComposerSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const threshold =
    typeof v.pasteThreshold === 'number' && Number.isFinite(v.pasteThreshold)
      ? Math.min(PASTE_THRESHOLD_MAX, Math.max(PASTE_THRESHOLD_MIN, Math.floor(v.pasteThreshold)))
      : DEFAULT_COMPOSER_SETTINGS.pasteThreshold
  return {
    pasteAsFile:
      typeof v.pasteAsFile === 'boolean' ? v.pasteAsFile : DEFAULT_COMPOSER_SETTINGS.pasteAsFile,
    pasteThreshold: threshold,
  }
}

const loadFromStorage = (): ComposerSettings | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerce(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (c: ComposerSettings) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useComposerSettings = () => {
  const store = useSettingsStore()
  const { composer } = storeToRefs(store)
  const initialized = useState('composerSettings:initialized', () => false)

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.composer = persisted
    watch(
      composer,
      (next) => {
        writeToStorage(next)
      },
      { deep: true },
    )
    initialized.value = true
  }

  return {
    composer,
    update: store.updateComposer,
    defaults: DEFAULT_COMPOSER_SETTINGS,
  }
}
