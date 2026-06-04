// Mermaid integration — lazy-loaded so the ~1MB bundle only ships when a chat
// reply actually contains a diagram. `renderMermaidIn` is idempotent: it skips
// blocks already tagged with data-rendered, so calling it on every message
// update during streaming is cheap.

import type { Mermaid } from 'mermaid'

let mermaidPromise: Promise<Mermaid> | null = null

// `data-source` on each `.awog-mermaid` block is base64-encoded UTF-8 (see
// utils/markdown.ts). Exported so the zoom modal can recover the raw diagram
// source and re-render it at full size.
export function decodeMermaidSource(s: string): string {
  if (typeof window === 'undefined') return Buffer.from(s, 'base64').toString('utf8')
  return decodeURIComponent(escape(window.atob(s)))
}

async function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const lib = m.default
      lib.initialize({ startOnLoad: false, securityLevel: 'strict', fontFamily: 'inherit' })
      return lib
    })
  }
  return mermaidPromise
}

// mermaid config is global, so we (re)set the theme right before each render to
// match the current app appearance — `dark` for dark mode, the built-in light
// `default` otherwise. Without this, diagrams render dark-on-light in light mode.
function applyTheme(mermaid: Mermaid, dark: boolean): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    fontFamily: 'inherit',
    theme: dark ? 'dark' : 'default',
  })
}

let counter = 0
const nextId = (): string => `awog-mmd-${Date.now().toString(36)}-${(counter++).toString(36)}`

// Render a raw diagram source to an SVG string. Used by the full-screen zoom
// modal, which re-renders from source so the enlarged diagram is crisp (rather
// than scaling the inline SVG). Throws on parse failure — caller shows a hint.
export async function renderMermaidSource(source: string, dark = true): Promise<string> {
  const mermaid = await getMermaid()
  applyTheme(mermaid, dark)
  const { svg } = await mermaid.render(nextId(), source.trim())
  return svg
}

// Build the small overlay button that opens the full-screen zoom modal. It's a
// plain DOM node (not a Vue component) because it lives inside v-html'd markup;
// SessionMessageList delegates the click via `.awog-mermaid-zoom`.
function makeZoomButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'awog-mermaid-zoom'
  btn.title = label
  btn.setAttribute('aria-label', label)
  // lucide `maximize-2` glyph, inlined (lucide is a Vue component lib, unusable
  // inside raw HTML). currentColor lets CSS drive the stroke.
  btn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>'
  return btn
}

// Scan the container for unrendered mermaid placeholders and replace each one
// with its rendered SVG. Errors (incomplete source mid-stream, invalid syntax)
// leave the block as-is so the raw fenced code keeps showing.
export async function renderMermaidIn(
  root: HTMLElement | null | undefined,
  opts?: { zoomLabel?: string; dark?: boolean },
): Promise<void> {
  if (!root) return
  // Skip blocks already rendered, and blocks whose exact source we already tried
  // and failed on — avoids re-parsing identical invalid/partial source on every
  // DOM mutation. A longer source (continued streaming) clears the guard.
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.awog-mermaid:not([data-rendered])'),
  ).filter((el) => el.dataset.mermaidTried !== String((el.dataset.source ?? '').length))
  if (!blocks.length) return
  const mermaid = await getMermaid()
  applyTheme(mermaid, opts?.dark ?? true)
  await Promise.all(
    blocks.map(async (el) => {
      const encoded = el.dataset.source ?? ''
      let source: string
      try {
        source = decodeMermaidSource(encoded).trim()
      } catch {
        el.dataset.mermaidTried = String(encoded.length)
        return
      }
      if (!source) return
      try {
        const { svg, bindFunctions } = await mermaid.render(nextId(), source)
        el.innerHTML = svg
        el.dataset.rendered = 'true'
        if (bindFunctions) bindFunctions(el)
        // Append the zoom affordance after the SVG so a click anywhere on it
        // opens the full-screen view (delegated in SessionMessageList).
        el.appendChild(makeZoomButton(opts?.zoomLabel ?? 'Zoom'))
      } catch {
        // Parse failed: truncated mid-stream (will retry when source grows) or a
        // genuinely invalid diagram. Tag the tried length so we don't re-parse the
        // same source on every mutation; the <pre><code> fallback stays visible.
        el.dataset.mermaidTried = String(encoded.length)
      }
    }),
  )
}
