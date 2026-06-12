// Shared mermaid theme variables. AWOG renders diagrams through two paths —
// inline session messages (utils/mermaid.ts, bundled mermaid v11) and the
// MarkdownRenderer block (MermaidBlock.vue, CDN mermaid v8). Both must produce
// the same high-contrast text in dark/light mode; keeping one source of truth
// here stops the paths drifting (that drift made dark-mode label text render as
// an unreadable gray). Values are plain hex so they work across mermaid versions.

export const mermaidDarkVars = {
  darkMode: true,
  background: '#161616',
  primaryColor: '#262626',
  primaryTextColor: '#ededed',
  primaryBorderColor: '#525252',
  secondaryColor: '#1f1f1f',
  tertiaryColor: '#0a0a0a',
  lineColor: '#a3a3a3',
  textColor: '#ededed',
  // Label text for flowchart/ER nodes (`.label` uses nodeTextColor first), class
  // diagrams, and diagram titles — pinned bright so they stay readable on dark fills.
  nodeTextColor: '#ededed',
  titleColor: '#ededed',
  classText: '#ededed',
  mainBkg: '#262626',
  nodeBorder: '#525252',
  clusterBkg: '#1a1a1a',
  clusterBorder: '#2e2e2e',
  edgeLabelBackground: '#161616',
  actorBorder: '#525252',
  actorBkg: '#262626',
  actorTextColor: '#ededed',
  actorLineColor: '#737373',
  signalColor: '#ededed',
  signalTextColor: '#ededed',
  labelBoxBkgColor: '#262626',
  labelBoxBorderColor: '#525252',
  labelTextColor: '#ededed',
  loopTextColor: '#ededed',
  noteBkgColor: '#3f3f1a',
  noteBorderColor: '#525252',
  noteTextColor: '#ededed',
}

export const mermaidLightVars = {
  background: '#ffffff',
  primaryColor: '#f5f5f4',
  primaryTextColor: '#1c1917',
  primaryBorderColor: '#a8a29e',
  lineColor: '#57534e',
  textColor: '#1c1917',
  nodeTextColor: '#1c1917',
  titleColor: '#1c1917',
  classText: '#1c1917',
  mainBkg: '#fafaf9',
  nodeBorder: '#a8a29e',
  clusterBkg: '#f5f5f4',
  clusterBorder: '#d6d3d1',
}

// Theme name + variables for a mermaid `initialize` call. Spread into the config.
export function mermaidTheme(dark: boolean): {
  theme: 'dark' | 'default'
  themeVariables: Record<string, unknown>
} {
  return {
    theme: dark ? 'dark' : 'default',
    themeVariables: dark ? mermaidDarkVars : mermaidLightVars,
  }
}

// Parse a CSS color (`rgb()/rgba()` as returned by getComputedStyle, or a hex
// literal from a `fill="#.."` attribute) to [r,g,b] 0-255. Returns null for
// `none`/transparent/unparseable so the caller leaves the themed color alone.
function parseRgb(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase()
  if (!c || c === 'none' || c === 'transparent') return null
  const fn = c.match(/^rgba?\(([^)]+)\)$/)
  if (fn) {
    const parts = (fn[1] ?? '').split(/[,/\s]+/).map((p) => parseFloat(p))
    const [r, g, b, a] = parts
    if (r === undefined || g === undefined || b === undefined) return null
    if (![r, g, b].every(Number.isFinite)) return null
    if (a === 0) return null // fully transparent
    return [r, g, b]
  }
  let hex = c.startsWith('#') ? c.slice(1) : c
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('')
  if (hex.length === 6 && /^[0-9a-f]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]
  }
  return null
}

// Pick readable text (near-black vs near-white) for a given fill via perceived
// luminance. Null when the fill can't be parsed (transparent/none) so the node
// keeps the theme's label color (correct on the dark/light canvas).
function readableTextOn(fill: string): string | null {
  const rgb = parseRgb(fill)
  if (!rgb) return null
  const [r, g, b] = rgb
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum > 0.55 ? '#1c1917' : '#ededed'
}

// Re-color node labels for contrast AFTER mermaid renders. A diagram that sets
// custom node fills (`style X fill:#c8e6c9`, classDef, …) keeps the theme's
// single label color — e.g. near-white text on a pastel fill in dark mode, which
// is unreadable. Derive each node's label color from its ACTUAL fill luminance so
// text stays legible on any fill, themed or custom. Nodes with no/transparent
// fill are left to the theme color (correct on the canvas). Call once with the
// container the SVG was mounted into (getComputedStyle needs it in the DOM).
export function applyMermaidLabelContrast(root: ParentNode | null | undefined): void {
  if (!root || typeof window === 'undefined') return
  const svg =
    root instanceof SVGSVGElement ? root : (root as Element).querySelector?.<SVGSVGElement>('svg')
  if (!svg) return
  svg.querySelectorAll<SVGGElement>('g.node').forEach((node) => {
    const shape = node.querySelector<SVGGraphicsElement>('rect, polygon, circle, ellipse, path')
    if (!shape) return
    let fill = ''
    try {
      fill = window.getComputedStyle(shape).fill
    } catch {
      fill = ''
    }
    if (!fill || fill === 'none') fill = shape.getAttribute('fill') ?? ''
    const color = readableTextOn(fill)
    if (!color) return
    // htmlLabels path: <foreignObject> with a span/div. SVG-text path: <text>.
    node.querySelectorAll<HTMLElement>('foreignObject *').forEach((el) => {
      el.style.color = color
    })
    node.querySelectorAll<SVGTextElement>('text, tspan').forEach((el) => {
      el.style.fill = color
    })
  })
}
