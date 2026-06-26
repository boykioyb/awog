// Render a GitHub issue/PR label chip so it stays readable in both themes.
//
// GitHub label colors are authored as solid BACKGROUND fills with auto-contrast
// text — so the naive approach (use the raw hex as foreground on a transparent
// chip) makes pale labels (e.g. the yellow `epic-*` ones) practically invisible
// on the white page in light mode.
//
//   Light mode → solid fill (background = label color) with black/white text
//                chosen by perceived luminance + a faint darker edge so a
//                near-white label still keeps an outline. (GitHub's classic
//                light-mode label rendering.)
//   Dark mode  → keep the subtle transparent + colored-text/border look; it
//                reads fine on the dark surface and matches the rest of the UI.

export type ChipStyle = {
  color: string
  background?: string
  borderColor: string
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m?.[1]) return null
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// sRGB-weighted perceived luminance, 0 (black) … 1 (white).
function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// Threshold matching GitHub's classic label algorithm: text is black above it,
// white below it.
const LIGHTNESS_THRESHOLD = 0.453

export function ghLabelStyle(color: string, dark: boolean): ChipStyle {
  const rgb = color ? parseHex(color) : null

  // Missing / unparseable color → neutral chip (theme token).
  if (!rgb) return { color: 'var(--textDim)', borderColor: 'var(--border)' }

  const { r, g, b } = rgb
  const fill = `rgb(${r}, ${g}, ${b})`

  if (dark) return { color: fill, borderColor: fill }

  // Light: solid fill + contrast text. Black/white are contrast values against
  // an arbitrary external (GitHub) color, not theme colors — no token applies.
  const text = luminance(r, g, b) > LIGHTNESS_THRESHOLD ? '#000000' : '#ffffff'
  const edge = `rgba(${Math.round(r * 0.7)}, ${Math.round(g * 0.7)}, ${Math.round(b * 0.7)}, 0.5)`
  return { color: text, background: fill, borderColor: edge }
}
