// Mermaid integration — lazy-loaded so the ~1MB bundle only ships when a chat
// reply actually contains a diagram. `renderMermaidIn` is idempotent: it skips
// blocks already tagged with data-rendered, so calling it on every message
// update during streaming is cheap.

import type { Mermaid } from 'mermaid'

let mermaidPromise: Promise<Mermaid> | null = null

const decodeSource = (s: string): string => {
  if (typeof window === 'undefined') return Buffer.from(s, 'base64').toString('utf8')
  return decodeURIComponent(escape(window.atob(s)))
}

async function getMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const lib = m.default
      lib.initialize({
        startOnLoad: false,
        // We render into a dark UI, so default to the `dark` theme regardless
        // of the user's appearance preference for now. Theme-aware swap can
        // come later if/when we add a light surface.
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'inherit',
      })
      return lib
    })
  }
  return mermaidPromise
}

let counter = 0
const nextId = (): string => `awog-mmd-${Date.now().toString(36)}-${(counter++).toString(36)}`

// Scan the container for unrendered mermaid placeholders and replace each one
// with its rendered SVG. Errors (incomplete source mid-stream, invalid syntax)
// leave the block as-is so the raw fenced code keeps showing.
export async function renderMermaidIn(root: HTMLElement | null | undefined): Promise<void> {
  if (!root) return
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.awog-mermaid:not([data-rendered])'),
  )
  if (!blocks.length) return
  const mermaid = await getMermaid()
  for (const el of blocks) {
    const encoded = el.dataset.source ?? ''
    let source: string
    try {
      source = decodeSource(encoded).trim()
    } catch {
      continue
    }
    if (!source) continue
    try {
      const { svg, bindFunctions } = await mermaid.render(nextId(), source)
      el.innerHTML = svg
      el.dataset.rendered = 'true'
      if (bindFunctions) bindFunctions(el)
    } catch {
      // Parse failed (likely truncated mid-stream). Leave the <pre><code> fallback;
      // we'll retry on the next call once the source stabilises.
    }
  }
}
