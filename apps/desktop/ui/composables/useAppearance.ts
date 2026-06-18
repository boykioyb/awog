import { storeToRefs } from 'pinia'
import type {
  AccentPreset,
  AppearanceSettings,
  AppLocale,
  ComposerSendKey,
  FontWeight,
  MonoFontFamily,
  SansFontFamily,
  SurfaceDepth,
  ThemeColor,
  ThemeFamily,
} from '~/types'
import { DEFAULT_APPEARANCE, useSettingsStore } from '~/stores/settings'

const STORAGE_KEY = 'awog.appearance.v1'
// One-time flag (ADR 0044): nudge installs still on the old monochrome/flat
// defaults to the new emerald/standard look once, preserving explicit picks.
const SHADCN_MIGRATION_KEY = 'awog.appearance.migrated.shadcn.v2'
// One-time nudge to the bundled Geist fonts (ADR 0044 follow-up).
const FONT_MIGRATION_KEY = 'awog.appearance.migrated.geist.v1'

const SANS_STACKS: Record<SansFontFamily, string> = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  // Self-hosted via @fontsource-variable/geist (the shadcn.com typeface).
  geist: "'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}

const MONO_STACKS: Record<MonoFontFamily, string> = {
  system: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'jetbrains-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  'fira-code': "'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
  // Self-hosted via @fontsource-variable/geist-mono.
  'geist-mono': "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace",
}

export const SANS_OPTIONS: { value: SansFontFamily; label: string }[] = [
  { value: 'system', label: 'System default' },
  { value: 'inter', label: 'Inter' },
  { value: 'geist', label: 'Geist' },
]

export const MONO_OPTIONS: { value: MonoFontFamily; label: string }[] = [
  { value: 'geist-mono', label: 'Geist Mono' },
  { value: 'system', label: 'System mono' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  { value: 'fira-code', label: 'Fira Code' },
]

export const THEME_FAMILY_OPTIONS: { value: ThemeFamily; label: string }[] = [
  { value: 'awog', label: 'AWOG' },
  { value: 'shadcn', label: 'Shadcn (slate)' },
]

export const WEIGHT_OPTIONS: { value: FontWeight; label: string }[] = [
  { value: 300, label: 'Light (300)' },
  { value: 400, label: 'Regular (400)' },
  { value: 500, label: 'Medium (500)' },
  { value: 600, label: 'Semibold (600)' },
  { value: 700, label: 'Bold (700)' },
]

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 18

export const THEME_STRENGTH_MIN = 0
export const THEME_STRENGTH_MAX = 50

const SANS_VALUES: readonly SansFontFamily[] = ['system', 'inter', 'geist']
const MONO_VALUES: readonly MonoFontFamily[] = [
  'system',
  'jetbrains-mono',
  'fira-code',
  'geist-mono',
]
const THEME_FAMILY_VALUES: readonly ThemeFamily[] = ['awog', 'shadcn']
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
const ACCENT_SELECTION_VALUES: readonly (AccentPreset | 'custom')[] = [...ACCENT_VALUES, 'custom']
const THEME_COLOR_VALUES: readonly ThemeColor[] = [
  ...ACCENT_VALUES,
  'github-dark',
  'subtle-purple',
  'custom',
]
const DEPTH_VALUES: readonly SurfaceDepth[] = ['flat', 'standard', 'deep']
const LOCALE_VALUES: readonly AppLocale[] = ['en', 'vi']
const SEND_KEY_VALUES: readonly ComposerSendKey[] = ['enter', 'shift-enter']

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const pickHex = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : fallback

export const coerceAppearance = (raw: unknown): AppearanceSettings => {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const fontSize =
    typeof v.fontSize === 'number' && v.fontSize >= FONT_SIZE_MIN && v.fontSize <= FONT_SIZE_MAX
      ? v.fontSize
      : DEFAULT_APPEARANCE.fontSize
  const themeColorStrength =
    typeof v.themeColorStrength === 'number' &&
    v.themeColorStrength >= THEME_STRENGTH_MIN &&
    v.themeColorStrength <= THEME_STRENGTH_MAX
      ? v.themeColorStrength
      : DEFAULT_APPEARANCE.themeColorStrength
  return {
    themeFamily: pick(v.themeFamily, THEME_FAMILY_VALUES, DEFAULT_APPEARANCE.themeFamily),
    sansFamily: pick(v.sansFamily, SANS_VALUES, DEFAULT_APPEARANCE.sansFamily),
    monoFamily: pick(v.monoFamily, MONO_VALUES, DEFAULT_APPEARANCE.monoFamily),
    fontSize,
    fontWeight: pick(v.fontWeight, WEIGHT_VALUES, DEFAULT_APPEARANCE.fontWeight),
    accent: pick(v.accent, ACCENT_SELECTION_VALUES, DEFAULT_APPEARANCE.accent),
    accentCustom: pickHex(v.accentCustom, DEFAULT_APPEARANCE.accentCustom),
    themeColor: pick(v.themeColor, THEME_COLOR_VALUES, DEFAULT_APPEARANCE.themeColor),
    themeColorCustom: pickHex(v.themeColorCustom, DEFAULT_APPEARANCE.themeColorCustom),
    themeColorStrength,
    surfaceDepth: pick(v.surfaceDepth, DEPTH_VALUES, DEFAULT_APPEARANCE.surfaceDepth),
    liquidGlass:
      typeof v.liquidGlass === 'boolean' ? v.liquidGlass : DEFAULT_APPEARANCE.liquidGlass,
    assistantBubble:
      typeof v.assistantBubble === 'boolean'
        ? v.assistantBubble
        : DEFAULT_APPEARANCE.assistantBubble,
    locale: pick(v.locale, LOCALE_VALUES, DEFAULT_APPEARANCE.locale),
    composerSendKey: pick(v.composerSendKey, SEND_KEY_VALUES, DEFAULT_APPEARANCE.composerSendKey),
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
    if (persisted) {
      // One-time upgrade to the new emerald/standard defaults — only when still
      // on the old defaults, so any explicit customisation is left untouched.
      if (import.meta.client && !window.localStorage.getItem(SHADCN_MIGRATION_KEY)) {
        if (persisted.accent === 'mono') persisted.accent = DEFAULT_APPEARANCE.accent
        if (persisted.surfaceDepth === 'flat')
          persisted.surfaceDepth = DEFAULT_APPEARANCE.surfaceDepth
        // Surface tint now comes from the Theme-color picker: nudge it to emerald
        // (with a visible strength) so the green look is configurable, not hardcoded.
        if (persisted.themeColor === 'mono') {
          persisted.themeColor = DEFAULT_APPEARANCE.themeColor
          persisted.themeColorStrength = DEFAULT_APPEARANCE.themeColorStrength
        }
        window.localStorage.setItem(SHADCN_MIGRATION_KEY, '1')
      }
      // One-time nudge to the bundled Geist fonts (the shadcn.com typeface) — only
      // when still on the previous system/JetBrains defaults, leaving explicit picks.
      if (import.meta.client && !window.localStorage.getItem(FONT_MIGRATION_KEY)) {
        if (persisted.sansFamily === 'system') persisted.sansFamily = DEFAULT_APPEARANCE.sansFamily
        if (persisted.monoFamily === 'jetbrains-mono')
          persisted.monoFamily = DEFAULT_APPEARANCE.monoFamily
        window.localStorage.setItem(FONT_MIGRATION_KEY, '1')
      }
      store.appearance = persisted
    }
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

  // Apply + persist directly on every change instead of relying solely on the
  // one-time watch above (which a component-scope change / HMR can orphan).
  const update = (patch: Partial<AppearanceSettings>) => {
    store.updateAppearance(patch)
    applyToDom(store.appearance)
    writeToStorage(store.appearance)
  }

  const reset = () => {
    store.resetAppearance()
    applyToDom(store.appearance)
    writeToStorage(store.appearance)
  }

  return {
    appearance,
    update,
    reset,
    defaults: DEFAULT_APPEARANCE,
  }
}
