import { storeToRefs } from 'pinia'
import { THEMES, type ThemeName, type ThemeTokens } from '~/utils/themes'
import { applyThemeColor, getAccentOverride, getSurfaceOverride } from '~/utils/theme-presets'
import { useSettingsStore } from '~/stores/settings'

export const useTheme = () => {
  const themeName = useState<ThemeName>('themeName', () => 'dark')
  const { appearance } = storeToRefs(useSettingsStore())

  const t = computed<ThemeTokens>(() => {
    const base = THEMES[themeName.value]
    const surface = getSurfaceOverride(themeName.value, appearance.value.surfaceDepth)
    const withSurface: ThemeTokens = { ...base, ...surface }
    const withTint = applyThemeColor(withSurface, themeName.value, appearance.value.themeColor)
    const accent = getAccentOverride(themeName.value, appearance.value.accent)
    return { ...withTint, ...accent }
  })

  const toggle = () => {
    themeName.value = themeName.value === 'dark' ? 'light' : 'dark'
  }

  const setTheme = (name: ThemeName) => {
    themeName.value = name
  }

  if (import.meta.client) {
    watchEffect(() => {
      const root = document.documentElement
      root.style.setProperty('--scrollbar-thumb', t.value.borderStrong)
      root.style.setProperty('--scrollbar-thumb-hover', t.value.textDim)
      root.style.setProperty('--scrollbar-thumb-active', t.value.textMuted)
      root.style.setProperty('color-scheme', themeName.value)
    })
  }

  return { themeName, t, toggle, setTheme }
}
