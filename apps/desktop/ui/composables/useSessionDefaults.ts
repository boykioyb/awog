// Session launch defaults — persisted in localStorage (same pattern as
// `useGitSettings`/`useAppearance`). Loaded at app start (app.vue) so a new
// Session/Task picks up the user's saved provider/model/mode instead of the
// hardcoded fallbacks after every reload.
import { storeToRefs } from 'pinia'
import { DEFAULT_SESSION_DEFAULTS, useSettingsStore, type SessionDefaults } from '~/stores/settings'
import type { AgentMode, ProviderName, ThinkingLevel } from '~/types'

const STORAGE_KEY = 'awog.defaults.v1'

const PROVIDER_VALUES: readonly ProviderName[] = ['anthropic', 'openai', 'google']
const MODE_VALUES: readonly AgentMode[] = ['ask', 'accept-edits', 'plan', 'execute']
const LEVEL_VALUES: readonly ThinkingLevel[] = ['low', 'medium', 'high', 'extra-high', 'max']

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const pickString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

export const coerceSessionDefaults = (raw: unknown): SessionDefaults => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    // systemPrompt/instructions may legitimately be empty strings (user cleared
    // them), so only fall back when the field is missing/not a string.
    systemPrompt:
      typeof v.systemPrompt === 'string' ? v.systemPrompt : DEFAULT_SESSION_DEFAULTS.systemPrompt,
    instructions:
      typeof v.instructions === 'string' ? v.instructions : DEFAULT_SESSION_DEFAULTS.instructions,
    provider: pick(v.provider, PROVIDER_VALUES, DEFAULT_SESSION_DEFAULTS.provider),
    modelId: pickString(v.modelId, DEFAULT_SESSION_DEFAULTS.modelId),
    mode: pick(v.mode, MODE_VALUES, DEFAULT_SESSION_DEFAULTS.mode),
    thinkingLevel: pick(v.thinkingLevel, LEVEL_VALUES, DEFAULT_SESSION_DEFAULTS.thinkingLevel),
    timezone: pickString(v.timezone, DEFAULT_SESSION_DEFAULTS.timezone),
  }
}

const loadFromStorage = (): SessionDefaults | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerceSessionDefaults(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (d: SessionDefaults) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d))
  } catch {
    // Storage full or disabled — non-fatal.
  }
}

export const useSessionDefaults = () => {
  const store = useSettingsStore()
  const { defaults } = storeToRefs(store)
  const initialized = useState('sessionDefaults:initialized', () => false)

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.defaults = persisted
    watch(
      defaults,
      (next) => {
        writeToStorage(next)
      },
      { deep: true },
    )
    initialized.value = true
  }

  return {
    defaults,
    update: store.updateDefaults,
    reset: store.resetDefaults,
    defaultsBaseline: DEFAULT_SESSION_DEFAULTS,
  }
}
