import { THEMES, type ThemeName, type ThemeTokens } from './themes'

export type AccentPreset =
  | 'mono'
  | 'blue'
  | 'violet'
  | 'cyan'
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'monokai'
  | 'dracula'
  | 'nord'
  | 'tokyo'
  | 'gruvbox'
  | 'catppuccin'
// Full dark background bases (not accents) — replace the surface palette outright
// instead of tinting it. Dark-theme only. Mirrors `BackgroundPreset` in ~/types.
export type BackgroundPreset = 'github-dark' | 'subtle-purple'
export type ThemeColor = AccentPreset | BackgroundPreset | 'custom'
export type SurfaceDepth = 'flat' | 'standard' | 'deep'

export const ACCENT_PRESETS: { value: AccentPreset; label: string; swatch: string }[] = [
  { value: 'mono', label: 'Monochrome', swatch: '#a3a3a3' },
  { value: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { value: 'violet', label: 'Violet', swatch: '#8b5cf6' },
  { value: 'cyan', label: 'Cyan', swatch: '#06b6d4' },
  { value: 'emerald', label: 'Emerald', swatch: '#10b981' },
  { value: 'rose', label: 'Rose', swatch: '#f43f5e' },
  { value: 'amber', label: 'Amber', swatch: '#f59e0b' },
  { value: 'monokai', label: 'Monokai', swatch: '#a6e22e' },
  { value: 'dracula', label: 'Dracula', swatch: '#bd93f9' },
  { value: 'nord', label: 'Nord', swatch: '#88c0d0' },
  { value: 'tokyo', label: 'Tokyo Night', swatch: '#7aa2f7' },
  { value: 'gruvbox', label: 'Gruvbox', swatch: '#fe8019' },
  { value: 'catppuccin', label: 'Catppuccin', swatch: '#cba6f7' },
]

// Full background bases for the Theme color picker. Unlike the hue-tint presets
// above, these swap the whole surface palette (see BACKGROUND_SURFACES). They are
// dark surfaces, so the picker only shows them in dark theme.
export const BACKGROUND_PRESETS: { value: BackgroundPreset; label: string; swatch: string }[] = [
  { value: 'github-dark', label: 'GitHub Dark', swatch: '#0d1117' },
  { value: 'subtle-purple', label: 'Subtle Purple', swatch: '#1f1f23' },
]

// Theme color picker = the accent hue tints + the full background bases. Accent
// picker keeps using ACCENT_PRESETS only (a near-black accent button would be
// invisible), so the two lists are intentionally distinct now.
export const THEME_COLOR_PRESETS: { value: ThemeColor; label: string; swatch: string }[] = [
  ...ACCENT_PRESETS,
  ...BACKGROUND_PRESETS,
]

export const SURFACE_DEPTH_OPTIONS: { value: SurfaceDepth; label: string; hint: string }[] = [
  { value: 'flat', label: 'Flat', hint: 'No layer separation (default)' },
  { value: 'standard', label: 'Standard', hint: 'Subtle depth between panels' },
  { value: 'deep', label: 'Deep', hint: 'Strong layer contrast' },
]

type AccentTokens = Pick<
  ThemeTokens,
  'accent' | 'accentHover' | 'accentMuted' | 'accentText' | 'borderFocus' | 'bgActive' | 'bgHover'
>

type SurfaceTokens = Pick<
  ThemeTokens,
  | 'bg'
  | 'bgPanel'
  | 'bgCanvas'
  | 'bgElevated'
  | 'bgHover'
  | 'bgActive'
  | 'bgInput'
  | 'bgRail'
  | 'bgSubtle'
  | 'border'
  | 'borderStrong'
>

type ColorAccent = Exclude<AccentPreset, 'mono'>
type NonFlatDepth = Exclude<SurfaceDepth, 'flat'>

const rgba = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Blend `hex` toward `anchorHex` by `alpha` (0..1) — used for accent hover/muted
// derivation and surface hue-tinting.
const mix = (hex: string, anchorHex: string, alpha: number): string => {
  const parse = (h: string) => {
    const c = h.replace('#', '')
    return {
      r: parseInt(c.slice(0, 2), 16),
      g: parseInt(c.slice(2, 4), 16),
      b: parseInt(c.slice(4, 6), 16),
    }
  }
  const a = parse(hex)
  const b = parse(anchorHex)
  const r = Math.round(a.r * (1 - alpha) + b.r * alpha)
  const g = Math.round(a.g * (1 - alpha) + b.g * alpha)
  const bb = Math.round(a.b * (1 - alpha) + b.b * alpha)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(bb)}`
}

interface AccentRecipe {
  accent: string
  accentHover: string
  accentMuted: string
  accentText: string
}

const ACCENT_RECIPES_DARK: Record<ColorAccent, AccentRecipe> = {
  blue: {
    accent: '#3b82f6',
    accentHover: '#60a5fa',
    accentMuted: '#1e40af',
    accentText: '#ffffff',
  },
  violet: {
    accent: '#8b5cf6',
    accentHover: '#a78bfa',
    accentMuted: '#5b21b6',
    accentText: '#ffffff',
  },
  cyan: {
    accent: '#06b6d4',
    accentHover: '#22d3ee',
    accentMuted: '#0e7490',
    accentText: '#ffffff',
  },
  emerald: {
    accent: '#10b981',
    accentHover: '#34d399',
    accentMuted: '#047857',
    accentText: '#ffffff',
  },
  rose: {
    accent: '#f43f5e',
    accentHover: '#fb7185',
    accentMuted: '#9f1239',
    accentText: '#ffffff',
  },
  amber: {
    accent: '#f59e0b',
    accentHover: '#fbbf24',
    accentMuted: '#92400e',
    accentText: '#0a0a0a',
  },
  monokai: {
    accent: '#a6e22e',
    accentHover: '#c8f04a',
    accentMuted: '#658822',
    accentText: '#0a0a0a',
  },
  dracula: {
    accent: '#bd93f9',
    accentHover: '#d4b8ff',
    accentMuted: '#6b4ba8',
    accentText: '#ffffff',
  },
  nord: {
    accent: '#88c0d0',
    accentHover: '#a3d2df',
    accentMuted: '#4c6677',
    accentText: '#0a0a0a',
  },
  tokyo: {
    accent: '#7aa2f7',
    accentHover: '#9bbcff',
    accentMuted: '#3d5aa0',
    accentText: '#ffffff',
  },
  gruvbox: {
    accent: '#fe8019',
    accentHover: '#ff9a3f',
    accentMuted: '#9f4e0c',
    accentText: '#0a0a0a',
  },
  catppuccin: {
    accent: '#cba6f7',
    accentHover: '#dfc4ff',
    accentMuted: '#7c5db0',
    accentText: '#0a0a0a',
  },
}

const ACCENT_RECIPES_LIGHT: Record<ColorAccent, AccentRecipe> = {
  blue: {
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentMuted: '#1e40af',
    accentText: '#ffffff',
  },
  violet: {
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    accentMuted: '#5b21b6',
    accentText: '#ffffff',
  },
  cyan: {
    accent: '#0891b2',
    accentHover: '#0e7490',
    accentMuted: '#155e75',
    accentText: '#ffffff',
  },
  emerald: {
    accent: '#059669',
    accentHover: '#047857',
    accentMuted: '#065f46',
    accentText: '#ffffff',
  },
  rose: {
    accent: '#e11d48',
    accentHover: '#be123c',
    accentMuted: '#9f1239',
    accentText: '#ffffff',
  },
  amber: {
    accent: '#d97706',
    accentHover: '#b45309',
    accentMuted: '#92400e',
    accentText: '#ffffff',
  },
  monokai: {
    accent: '#65a30d',
    accentHover: '#4d7c0f',
    accentMuted: '#365314',
    accentText: '#ffffff',
  },
  dracula: {
    accent: '#9333ea',
    accentHover: '#7e22ce',
    accentMuted: '#6b21a8',
    accentText: '#ffffff',
  },
  nord: {
    accent: '#0284c7',
    accentHover: '#0369a1',
    accentMuted: '#075985',
    accentText: '#ffffff',
  },
  tokyo: {
    accent: '#3b5dbe',
    accentHover: '#2e4a99',
    accentMuted: '#1e3a8a',
    accentText: '#ffffff',
  },
  gruvbox: {
    accent: '#c2410c',
    accentHover: '#9a3412',
    accentMuted: '#7c2d12',
    accentText: '#ffffff',
  },
  catppuccin: {
    accent: '#8e5acf',
    accentHover: '#7c3aed',
    accentMuted: '#5b21b6',
    accentText: '#ffffff',
  },
}

const HEX6_RE = /^#[0-9a-fA-F]{6}$/

// Perceptual (sRGB-weighted) luminance in 0..1 — picks readable text on the accent.
const luminance = (hex: string): number => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Derive a full accent recipe from a single user hex: hover lightens toward white,
// muted darkens toward black, text flips to dark on bright accents.
const buildCustomAccentRecipe = (hex: string): AccentRecipe => ({
  accent: hex,
  accentHover: mix(hex, '#ffffff', 0.18),
  accentMuted: mix(hex, '#000000', 0.4),
  accentText: luminance(hex) > 0.6 ? '#0a0a0a' : '#ffffff',
})

const buildAccentTokens = (recipe: AccentRecipe, themeName: ThemeName): AccentTokens => {
  const bgActiveAlpha = themeName === 'dark' ? 0.2 : 0.13
  const bgHoverAlpha = themeName === 'dark' ? 0.11 : 0.07
  return {
    accent: recipe.accent,
    accentHover: recipe.accentHover,
    accentMuted: recipe.accentMuted,
    accentText: recipe.accentText,
    borderFocus: recipe.accent,
    bgActive: rgba(recipe.accent, bgActiveAlpha),
    bgHover: rgba(recipe.accent, bgHoverAlpha),
  }
}

const SURFACE_DARK: Record<NonFlatDepth, SurfaceTokens> = {
  standard: {
    bg: '#0a0a0a',
    bgPanel: '#141414',
    bgCanvas: '#1a1a1a',
    bgElevated: '#202020',
    bgHover: '#252525',
    bgActive: '#2d2d2d',
    bgInput: '#1a1a1a',
    bgRail: '#080808',
    bgSubtle: '#181818',
    border: '#2a2a2a',
    borderStrong: '#3a3a3a',
  },
  deep: {
    bg: '#050505',
    bgPanel: '#181818',
    bgCanvas: '#1e1e1e',
    bgElevated: '#262626',
    bgHover: '#2d2d2d',
    bgActive: '#363636',
    bgInput: '#1e1e1e',
    bgRail: '#000000',
    bgSubtle: '#1a1a1a',
    border: '#333333',
    borderStrong: '#4a4a4a',
  },
}

const SURFACE_LIGHT: Record<NonFlatDepth, SurfaceTokens> = {
  standard: {
    bg: '#ffffff',
    bgPanel: '#f4f4f4',
    bgCanvas: '#ececec',
    bgElevated: '#fafafa',
    bgHover: '#ebebeb',
    bgActive: '#dedede',
    bgInput: '#ffffff',
    bgRail: '#efefef',
    bgSubtle: '#f6f6f6',
    border: '#dcdcdc',
    borderStrong: '#c4c4c4',
  },
  deep: {
    bg: '#ffffff',
    bgPanel: '#eeeeee',
    bgCanvas: '#e4e4e4',
    bgElevated: '#f5f5f5',
    bgHover: '#dadada',
    bgActive: '#cccccc',
    bgInput: '#ffffff',
    bgRail: '#e8e8e8',
    bgSubtle: '#ededed',
    border: '#cfcfcf',
    borderStrong: '#aeaeae',
  },
}

// Complete dark surface palettes for the background-base theme colors. Unlike the
// hue-tint presets these REPLACE the surfaces outright: a GitHub `#0d1117` canvas
// ramp, and a subtle purple-tinted dark (`#1f1f23`). Applied only in dark theme.
const BACKGROUND_SURFACES: Record<BackgroundPreset, SurfaceTokens> = {
  'github-dark': {
    bg: '#0d1117',
    bgPanel: '#0d1117',
    bgCanvas: '#161b22',
    bgElevated: '#1c2128',
    bgHover: '#21262d',
    bgActive: '#282e36',
    bgInput: '#161b22',
    bgRail: '#010409',
    bgSubtle: '#11161d',
    border: '#21262d',
    borderStrong: '#30363d',
  },
  'subtle-purple': {
    bg: '#1f1f23',
    bgPanel: '#1f1f23',
    bgCanvas: '#26262c',
    bgElevated: '#2b2b32',
    bgHover: '#303038',
    bgActive: '#37373f',
    bgInput: '#26262c',
    bgRail: '#161619',
    bgSubtle: '#232329',
    border: '#33333b',
    borderStrong: '#42424b',
  },
}

const isBackgroundPreset = (color: ThemeColor): color is BackgroundPreset =>
  color === 'github-dark' || color === 'subtle-purple'

const THEME_COLOR_ANCHORS_DARK: Record<ColorAccent, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  cyan: '#06b6d4',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  monokai: '#a6e22e',
  dracula: '#bd93f9',
  nord: '#5e81ac',
  tokyo: '#7aa2f7',
  gruvbox: '#fe8019',
  catppuccin: '#c6a0f6',
}

const THEME_COLOR_ANCHORS_LIGHT: Record<ColorAccent, string> = {
  blue: '#2563eb',
  violet: '#7c3aed',
  cyan: '#0891b2',
  emerald: '#059669',
  rose: '#e11d48',
  amber: '#d97706',
  monokai: '#65a30d',
  dracula: '#9333ea',
  nord: '#0284c7',
  tokyo: '#3b5dbe',
  gruvbox: '#c2410c',
  catppuccin: '#8e5acf',
}

const SURFACE_KEYS = [
  'bg',
  'bgPanel',
  'bgCanvas',
  'bgElevated',
  'bgInput',
  'bgRail',
  'bgSubtle',
  'border',
  'borderStrong',
] as const

export const getAccentOverride = (
  themeName: ThemeName,
  preset: AccentPreset | 'custom',
  customHex?: string,
): Partial<ThemeTokens> => {
  if (preset === 'mono') return {}
  let recipe: AccentRecipe
  if (preset === 'custom') {
    if (!customHex || !HEX6_RE.test(customHex)) return {}
    recipe = buildCustomAccentRecipe(customHex)
  } else {
    recipe = themeName === 'dark' ? ACCENT_RECIPES_DARK[preset] : ACCENT_RECIPES_LIGHT[preset]
  }
  const baseSyntax = THEMES[themeName].syntax
  // Headings + link follow the accent so MarkdownRenderer harmonises with the
  // user's pick (the hardcoded h1/h2/h3 in themes.ts were a holdover from the
  // default monochrome palette). Code / bold / italic / listMark / blockquote
  // stay on the neutral base — they signal structure, not branding.
  return {
    ...buildAccentTokens(recipe, themeName),
    syntax: {
      ...baseSyntax,
      h1: recipe.accent,
      h2: recipe.accentHover,
      h3: recipe.accentMuted,
      link: recipe.accent,
    },
  }
}

export const getSurfaceOverride = (
  themeName: ThemeName,
  depth: SurfaceDepth,
): Partial<ThemeTokens> => {
  if (depth === 'flat') return {}
  return themeName === 'dark' ? SURFACE_DARK[depth] : SURFACE_LIGHT[depth]
}

export const applyThemeColor = (
  tokens: ThemeTokens,
  themeName: ThemeName,
  color: ThemeColor,
  customHex?: string,
  // User-controlled tint strength as a percent (0–50). Maps directly to the mix
  // alpha (10% → 0.1). Falls back to the legacy per-theme default when omitted.
  strengthPct?: number,
): ThemeTokens => {
  if (color === 'mono') return tokens
  // Full background bases replace the surface palette outright. They are dark
  // surfaces (text tokens stay light), so they only make sense in dark theme —
  // no-op in light (the picker hides them there too).
  if (isBackgroundPreset(color)) {
    if (themeName !== 'dark') return tokens
    return { ...tokens, ...BACKGROUND_SURFACES[color] }
  }
  let anchor: string
  if (color === 'custom') {
    if (!customHex || !HEX6_RE.test(customHex)) return tokens
    anchor = customHex
  } else {
    anchor =
      themeName === 'dark' ? THEME_COLOR_ANCHORS_DARK[color] : THEME_COLOR_ANCHORS_LIGHT[color]
  }
  const defaultAlpha = themeName === 'dark' ? 0.1 : 0.07
  const alpha = typeof strengthPct === 'number' ? strengthPct / 100 : defaultAlpha
  if (alpha <= 0) return tokens
  const next = { ...tokens }
  SURFACE_KEYS.forEach((k) => {
    next[k] = mix(tokens[k], anchor, alpha)
  })
  return next
}
