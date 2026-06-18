export type ThemeName = 'dark' | 'light'

export interface SyntaxTokens {
  h1: string
  h2: string
  h3: string
  bold: string
  italic: string
  code: string
  link: string
  listMark: string
  blockquote: string
}

export interface ThemeTokens {
  // Background
  bg: string
  bgPanel: string
  bgCanvas: string
  bgElevated: string
  bgHover: string
  bgActive: string
  bgInput: string
  bgRail: string
  bgSubtle: string
  // Assistant reply bubble fill — tuned per theme to read as a pale, clean card
  // (white in light; a touch lighter than bgElevated in dark) instead of a gray
  // slab. Scoped to the chat bubble so the rest of the card surfaces are untouched.
  bubbleBg: string
  // Border
  border: string
  borderStrong: string
  borderFocus: string
  // Text
  text: string
  textMuted: string
  textDim: string
  textFaint: string
  // Accent
  accent: string
  accentHover: string
  accentText: string
  accentMuted: string
  // Semantic
  warning: string
  warningBg: string
  warningBorder: string
  success: string
  danger: string
  dangerBg: string
  dangerBorder: string
  info: string
  infoBg: string
  infoBorder: string
  // Canvas
  dotPattern: string
  edge: string
  edgeActive: string
  connectingEdge: string
  // Git
  gitAdded: string
  gitModified: string
  gitDeleted: string
  gitUntracked: string
  gitConflict: string
  diffOurs: string
  diffTheirs: string
  // Overlay / On-accent text
  overlay: string
  onAccent: string
  // Diff (markdown editor diff view)
  diffAdd: string
  diffDel: string
  // Status indicator
  statusOk: string
  statusWarn: string
  // Misc
  shadow: string
  // Liquid Glass surfaces (translucent header + pill segments). Layered over
  // `bg` and paired with backdrop-blur; alpha lets the base tint show through.
  glassBg: string
  glassBorder: string
  glassHighlight: string
  glassActive: string
  glassHover: string
  syntax: SyntaxTokens
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  dark: {
    bg: '#0a0a0a',
    bgPanel: '#0a0a0a',
    bgCanvas: '#111111',
    bgElevated: '#161616',
    bgHover: '#1a1a1a',
    bgActive: '#1f1f1f',
    bgInput: '#161616',
    bgRail: '#080808',
    bgSubtle: '#131313',
    bubbleBg: '#1e1e1e',
    border: '#222222',
    borderStrong: '#2e2e2e',
    borderFocus: '#525252',
    text: '#ffffff',
    textMuted: '#a3a3a3',
    textDim: '#737373',
    textFaint: '#525252',
    accent: '#fafafa',
    accentHover: '#ffffff',
    accentText: '#0a0a0a',
    accentMuted: '#a3a3a3',
    warning: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.08)',
    warningBorder: 'rgba(245, 158, 11, 0.35)',
    success: '#a3a3a3',
    danger: '#ef4444',
    dangerBg: 'rgba(239, 68, 68, 0.08)',
    dangerBorder: 'rgba(239, 68, 68, 0.35)',
    info: '#60a5fa',
    infoBg: 'rgba(96, 165, 250, 0.08)',
    infoBorder: 'rgba(96, 165, 250, 0.3)',
    dotPattern: '#262626',
    edge: '#525252',
    edgeActive: '#ededed',
    connectingEdge: '#a3a3a3',
    gitAdded: '#86efac',
    gitModified: '#fbbf24',
    gitDeleted: '#fca5a5',
    gitUntracked: '#737373',
    gitConflict: '#fb923c',
    // Conflict resolver block highlights — ADR 0017 OQ-10. Background tint
    // overlaid on top of `bg`; foreground label color uses `info` / accent.
    diffOurs: 'rgba(96, 165, 250, 0.18)',
    diffTheirs: 'rgba(192, 132, 252, 0.18)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    onAccent: '#ffffff',
    diffAdd: '#86efac',
    diffDel: '#fca5a5',
    statusOk: '#22c55e',
    statusWarn: '#fbbf24',
    shadow: 'rgba(0, 0, 0, 0.5)',
    glassBg: 'rgba(20, 20, 22, 0.72)',
    glassBorder: 'rgba(255, 255, 255, 0.10)',
    glassHighlight: 'rgba(255, 255, 255, 0.14)',
    glassActive: 'rgba(255, 255, 255, 0.12)',
    glassHover: 'rgba(255, 255, 255, 0.06)',
    syntax: {
      h1: '#f1c40f',
      h2: '#e74c3c',
      h3: '#3498db',
      bold: '#ededed',
      // Readable on dark — the old #a3a3a3 (== textMuted) was too dim for body
      // emphasis; the italic slant already de-emphasises without dropping contrast.
      italic: '#cbcbcb',
      code: '#86efac',
      link: '#60a5fa',
      listMark: '#737373',
      blockquote: '#737373',
    },
  },
  light: {
    // Off-white shell canvas so the white surfaces above (bgElevated cards,
    // bgInput, message bubbles, chat/detail panes) read as raised and stand out.
    bg: '#f5f6f8',
    bgPanel: '#fafaf9',
    bgCanvas: '#f5f5f4',
    bgElevated: '#ffffff',
    bgHover: '#f5f5f4',
    bgActive: '#e7e5e4',
    bgInput: '#ffffff',
    bgRail: '#f5f5f4',
    bgSubtle: '#fafaf9',
    bubbleBg: '#ffffff',
    border: '#e7e5e4',
    borderStrong: '#d6d3d1',
    borderFocus: '#78716c',
    text: '#000000',
    textMuted: '#57534e',
    textDim: '#78716c',
    textFaint: '#a8a29e',
    accent: '#1c1917',
    accentHover: '#000000',
    accentText: '#fafaf9',
    accentMuted: '#57534e',
    warning: '#b45309',
    warningBg: 'rgba(180, 83, 9, 0.06)',
    warningBorder: 'rgba(180, 83, 9, 0.3)',
    success: '#57534e',
    danger: '#b91c1c',
    dangerBg: 'rgba(185, 28, 28, 0.06)',
    dangerBorder: 'rgba(185, 28, 28, 0.3)',
    info: '#1d4ed8',
    infoBg: 'rgba(29, 78, 216, 0.06)',
    infoBorder: 'rgba(29, 78, 216, 0.3)',
    dotPattern: '#e7e5e4',
    edge: '#a8a29e',
    edgeActive: '#1c1917',
    connectingEdge: '#57534e',
    gitAdded: '#047857',
    gitModified: '#b45309',
    gitDeleted: '#b91c1c',
    gitUntracked: '#78716c',
    gitConflict: '#c2410c',
    // Conflict resolver block highlights — ADR 0017 OQ-10 (light variant).
    diffOurs: 'rgba(59, 130, 246, 0.10)',
    diffTheirs: 'rgba(168, 85, 247, 0.10)',
    overlay: 'rgba(0, 0, 0, 0.45)',
    onAccent: '#ffffff',
    diffAdd: '#16a34a',
    diffDel: '#dc2626',
    statusOk: '#16a34a',
    statusWarn: '#d97706',
    shadow: 'rgba(0, 0, 0, 0.08)',
    glassBg: 'rgba(255, 255, 255, 0.88)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.9)',
    glassActive: 'rgba(0, 0, 0, 0.06)',
    glassHover: 'rgba(0, 0, 0, 0.035)',
    syntax: {
      h1: '#b45309',
      h2: '#b91c1c',
      h3: '#1d4ed8',
      bold: '#1c1917',
      italic: '#57534e',
      code: '#047857',
      link: '#1d4ed8',
      listMark: '#78716c',
      blockquote: '#78716c',
    },
  },
}

// ─── Shadcn (slate) theme family ─────────────────────────────────────────────
// Authentic shadcn.com "slate" palette mapped onto AWOG's token shape. Selected
// via `appearance.themeFamily === 'shadcn'`; useTheme returns these as-is (the
// accent/theme-color/surface-depth controls don't apply — slate defines its own
// neutral relationships). The shadcn token bridge derives correctly from these
// (card = bg, separated by a visible border; secondary/muted/accent = one slate
// gray distinct from card; primary = slate-900/50). Semantic/git/syntax tokens
// inherit from the matching AWOG base theme.
//
// shadcn slate scale: 50 #f8fafc · 100 #f1f5f9 · 200 #e2e8f0 · 300 #cbd5e1 ·
// 400 #94a3b8 · 500 #64748b · 600 #475569 · 700 #334155 · 800 #1e293b ·
// 900 #0f172a · 950 #020817.
const SHADCN_DARK: Partial<ThemeTokens> = {
  bg: '#020817',
  bgPanel: '#020817',
  bgCanvas: '#0b1220',
  bgElevated: '#020817', // card == background; separated by border (shadcn way)
  bgHover: '#1e293b', // → accent (hover/selected fill)
  bgActive: '#1e293b', // → secondary
  bgInput: '#1e293b', // → muted
  bgRail: '#020817',
  bgSubtle: '#0b1220',
  bubbleBg: '#0f172a',
  border: '#1e293b', // slate-800 — clearly visible (the shadcn signature)
  borderStrong: '#334155',
  borderFocus: '#cbd5e1',
  text: '#f8fafc',
  textMuted: '#94a3b8', // slate-400 → muted-foreground
  textDim: '#64748b',
  textFaint: '#475569',
  accent: '#f8fafc', // → primary (near-white)
  accentHover: '#e2e8f0',
  accentText: '#0f172a',
  accentMuted: '#94a3b8',
  onAccent: '#0f172a',
  dotPattern: '#1e293b',
  edge: '#475569',
  glassBg: 'rgba(2, 8, 23, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.06)',
  glassActive: 'rgba(255, 255, 255, 0.10)',
  glassHover: 'rgba(255, 255, 255, 0.05)',
}

const SHADCN_LIGHT: Partial<ThemeTokens> = {
  bg: '#ffffff',
  bgPanel: '#ffffff',
  bgCanvas: '#f8fafc',
  bgElevated: '#ffffff', // card == background; border does the separation
  bgHover: '#f1f5f9', // → accent
  bgActive: '#f1f5f9', // → secondary
  bgInput: '#f1f5f9', // → muted (slate-100)
  bgRail: '#f8fafc',
  bgSubtle: '#f8fafc',
  bubbleBg: '#ffffff',
  border: '#e2e8f0', // slate-200 — visible hairline on white
  borderStrong: '#cbd5e1',
  borderFocus: '#020817',
  text: '#020817', // slate-950
  textMuted: '#64748b', // slate-500 → muted-foreground
  textDim: '#64748b',
  textFaint: '#94a3b8',
  accent: '#0f172a', // → primary (slate-900 dark button)
  accentHover: '#1e293b',
  accentText: '#f8fafc',
  accentMuted: '#64748b',
  onAccent: '#ffffff',
  dotPattern: '#e2e8f0',
  edge: '#94a3b8',
  glassBg: 'rgba(255, 255, 255, 0.85)',
  glassBorder: 'rgba(2, 8, 23, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.9)',
  glassActive: 'rgba(2, 8, 23, 0.06)',
  glassHover: 'rgba(2, 8, 23, 0.04)',
}

export const SHADCN_THEMES: Record<ThemeName, ThemeTokens> = {
  dark: { ...THEMES.dark, ...SHADCN_DARK },
  light: { ...THEMES.light, ...SHADCN_LIGHT },
}
