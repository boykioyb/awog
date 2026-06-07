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
    syntax: {
      h1: '#f1c40f',
      h2: '#e74c3c',
      h3: '#3498db',
      bold: '#ededed',
      italic: '#a3a3a3',
      code: '#86efac',
      link: '#60a5fa',
      listMark: '#737373',
      blockquote: '#737373',
    },
  },
  light: {
    bg: '#ffffff',
    bgPanel: '#fafaf9',
    bgCanvas: '#f5f5f4',
    bgElevated: '#ffffff',
    bgHover: '#f5f5f4',
    bgActive: '#e7e5e4',
    bgInput: '#ffffff',
    bgRail: '#f5f5f4',
    bgSubtle: '#fafaf9',
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
