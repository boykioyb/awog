import { storeToRefs } from 'pinia'
import { THEMES, type ThemeName, type ThemeTokens } from '~/utils/themes'
import { applyThemeColor, getAccentOverride, getSurfaceOverride } from '~/utils/theme-presets'
import { useSettingsStore } from '~/stores/settings'

// Convert a theme color (hex or rgb/rgba) to "r g b" channels for the shadcn-vue
// token bridge (ADR 0044). rgba with alpha < 1 is composited over `baseHex` so the
// solid channel matches what the translucent token actually renders as.
const toChannels = (color: string, baseHex: string): string => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(color.trim())
  if (hex) {
    const h = hex[1]!
    return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(color)
  if (rgb) {
    const p = rgb[1]!.split(',').map((s) => parseFloat(s.trim()))
    const r = p[0] ?? 0
    const g = p[1] ?? 0
    const b = p[2] ?? 0
    const a = p[3] ?? 1
    if (a >= 1) return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`
    const base = /^#([0-9a-fA-F]{6})$/.exec(baseHex.trim())
    const br = base ? parseInt(base[1]!.slice(0, 2), 16) : 0
    const bg = base ? parseInt(base[1]!.slice(2, 4), 16) : 0
    const bb = base ? parseInt(base[1]!.slice(4, 6), 16) : 0
    const mix = (ch: number, baseCh: number) => Math.round(ch * a + baseCh * (1 - a))
    return `${mix(r, br)} ${mix(g, bg)} ${mix(b, bb)}`
  }
  return '0 0 0'
}

export const useTheme = () => {
  const themeName = useState<ThemeName>('themeName', () => 'dark')
  const { appearance } = storeToRefs(useSettingsStore())

  const t = computed<ThemeTokens>(() => {
    const base = THEMES[themeName.value]
    const surface = getSurfaceOverride(themeName.value, appearance.value.surfaceDepth)
    const withSurface: ThemeTokens = { ...base, ...surface }
    const withTint = applyThemeColor(
      withSurface,
      themeName.value,
      appearance.value.themeColor,
      appearance.value.themeColorCustom,
      appearance.value.themeColorStrength,
    )
    const accent = getAccentOverride(
      themeName.value,
      appearance.value.accent,
      appearance.value.accentCustom,
    )
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

      // shadcn-vue token bridge (ADR 0044): feed the live theme into the --awog-*
      // CSS vars that tailwind.config maps to shadcn color tokens.
      const c = t.value
      const setTok = (name: string, color: string) =>
        root.style.setProperty(`--awog-${name}`, toChannels(color, c.bg))
      setTok('background', c.bg)
      setTok('foreground', c.text)
      setTok('card', c.bgElevated)
      setTok('card-foreground', c.text)
      setTok('popover', c.bgPanel)
      setTok('popover-foreground', c.text)
      setTok('primary', c.accent)
      setTok('primary-foreground', c.accentText)
      setTok('secondary', c.bgElevated)
      setTok('secondary-foreground', c.text)
      setTok('muted', c.bgInput)
      setTok('muted-foreground', c.textMuted)
      setTok('accent', c.bgHover)
      setTok('accent-foreground', c.text)
      setTok('destructive', c.danger)
      setTok('destructive-foreground', c.onAccent)
      setTok('border', c.border)
      setTok('input', c.border)
      setTok('ring', c.accent)
    })
  }

  return { themeName, t, toggle, setTheme }
}
