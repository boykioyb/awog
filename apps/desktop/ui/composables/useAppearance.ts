import { storeToRefs } from 'pinia'
import type {
  AccentPreset,
  AppearanceSettings,
  AppLocale,
  FontWeight,
  MonoFontFamily,
  SansFontFamily,
  SurfaceDepth,
  ThemeColor,
} from '~/types'
import { DEFAULT_APPEARANCE, useSettingsStore } from '~/stores/settings'

const STORAGE_KEY = 'awog.appearance.v1'

const SANS_STACKS: Record<SansFontFamily, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  geist: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

const MONO_STACKS: Record<MonoFontFamily, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'jetbrains-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  'fira-code': "'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
}

export const SANS_OPTIONS: { value: SansFontFamily; label: string }[] = [
  { value: 'system', label: 'System default' },
  { value: 'inter', label: 'Inter' },
  { value: 'geist', label: 'Geist' },
]

export const MONO_OPTIONS: { value: MonoFontFamily; label: string }[] = [
  { value: 'system', label: 'System mono' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'fira-code', label: 'Fira Code' },
]

export const WEIGHT_OPTIONS: { value: FontWeight; label: string }[] = [
  { value: 300, label: 'Light (300)' },
  { value: 400, label: 'Regular (400)' },
  { value: 500, label: 'Medium (500)' },
  { value: 600, label: 'Semibold (600)' },
  { value: 700, label: 'Bold (700)' },
]

export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 18

const SANS_VALUES: readonly SansFontFamily[] = ['system', 'inter', 'geist']
const MONO_VALUES: readonly MonoFontFamily[] = ['system', 'jetbrains-mono', 'fira-code']
const WEIGHT_VALUES: readonly FontWeight[] = [300, 400, 500, 600, 700]
const ACCENT_VALUES: readonly AccentPreset[] = [
  'mono',
  'blue',
  'violet',
  'cyan',
  'emerald',
  'rose',
  'amber',
  'monokai',
  'dracula',
  'nord',
  'tokyo',
  'gruvbox',
  'catppuccin',
]
const THEME_COLOR_VALUES: readonly ThemeColor[] = [...ACCENT_VALUES, 'custom']
const DEPTH_VALUES: readonly SurfaceDepth[] = ['flat', 'standard', 'deep']
const LOCALE_VALUES: readonly AppLocale[] = ['en', 'vi']

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const pickHex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback

const coerceAppearance = (raw: unknown): AppearanceSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const fontSize =
    typeof v.fontSize === 'number' && v.fontSize >= FONT_SIZE_MIN && v.fontSize <= FONT_SIZE_MAX
      ? v.fontSize
      : DEFAULT_APPEARANCE.fontSize
  return {
    sansFamily: pick(v.sansFamily, SANS_VALUES, DEFAULT_APPEARANCE.sansFamily),
    monoFamily: pick(v.monoFamily, MONO_VALUES, DEFAULT_APPEARANCE.monoFamily),
    fontSize,
    fontWeight: pick(v.fontWeight, WEIGHT_VALUES, DEFAULT_APPEARANCE.fontWeight),
    accent: pick(v.accent, ACCENT_VALUES, DEFAULT_APPEARANCE.accent),
    themeColor: pick(v.themeColor, THEME_COLOR_VALUES, DEFAULT_APPEARANCE.themeColor),
    themeColorCustom: pickHex(v.themeColorCustom, DEFAULT_APPEARANCE.themeColorCustom),
    surfaceDepth: pick(v.surfaceDepth, DEPTH_VALUES, DEFAULT_APPEARANCE.surfaceDepth),
    locale: pick(v.locale, LOCALE_VALUES, DEFAULT_APPEARANCE.locale),
  }
}

const loadFromStorage = (): AppearanceSettings | null => {
  if (!import.meta.client) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return coerceAppearance(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeToStorage = (a: AppearanceSettings) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
  } catch {
    // Storage full or disabled — non-fatal, runtime values still apply.
  }
}

const applyToDom = (a: AppearanceSettings) => {
  if (!import.meta.client) return
  const root = document.documentElement
  root.style.setProperty('--font-sans', SANS_STACKS[a.sansFamily])
  root.style.setProperty('--font-mono', MONO_STACKS[a.monoFamily])
  root.style.setProperty('--font-size-base', `${a.fontSize}px`)
  root.style.setProperty('--font-weight-base', String(a.fontWeight))
}

export const useAppearance = () => {
  const store = useSettingsStore()
  const { appearance } = storeToRefs(store)
  const initialized = useState('appearance:initialized', () => false)

  if (import.meta.client && !initialized.value) {
    const persisted = loadFromStorage()
    if (persisted) store.appearance = persisted
    applyToDom(store.appearance)
    watch(
      appearance,
      (next) => {
        applyToDom(next)
        writeToStorage(next)
      },
      { deep: true },
    )
    initialized.value = true
  }

  const reset = () => {
    store.resetAppearance()
  }

  return {
    appearance,
    update: store.updateAppearance,
    reset,
    defaults: DEFAULT_APPEARANCE,
  }
}
