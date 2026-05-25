import { THEMES, type ThemeName, type ThemeTokens } from '~/utils/themes'

export const useTheme = () => {
  const themeName = useState<ThemeName>('themeName', () => 'dark')
  const t = computed<ThemeTokens>(() => THEMES[themeName.value])

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
