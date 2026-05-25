// Loads mermaid via cdnjs. Uses v8.13.10 because it's a proper UMD bundle that
// reliably attaches window.mermaid (v10+ are ESM-only and break in script tags).

export type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (
    id: string,
    code: string,
    cb?: (svg: string) => void,
  ) => string | Promise<{ svg: string }> | undefined
}

type MermaidWindow = Window & { mermaid?: MermaidApi }

let mermaidLoadPromise: Promise<MermaidApi> | null = null

export function loadMermaid(): Promise<MermaidApi> {
  if (mermaidLoadPromise) return mermaidLoadPromise
  mermaidLoadPromise = new Promise<MermaidApi>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('No window object'))
      return
    }
    const w = window as MermaidWindow
    if (w.mermaid) {
      resolve(w.mermaid)
      return
    }
    const url = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/8.13.10/mermaid.min.js'
    const existing = document.querySelector('script[data-mermaid-loader]')
    if (existing) {
      const start = Date.now()
      const tick = () => {
        if (w.mermaid) resolve(w.mermaid)
        else if (Date.now() - start > 15000) reject(new Error('Timeout waiting for window.mermaid'))
        else setTimeout(tick, 50)
      }
      tick()
      return
    }
    const script = document.createElement('script')
    script.setAttribute('data-mermaid-loader', 'true')
    script.src = url
    script.async = false
    script.onload = () => {
      const start = Date.now()
      const tick = () => {
        if (w.mermaid) resolve(w.mermaid)
        else if (Date.now() - start > 5000)
          reject(new Error('Script loaded but window.mermaid is undefined'))
        else setTimeout(tick, 50)
      }
      tick()
    }
    script.onerror = () => reject(new Error(`Failed to load mermaid script from ${url}`))
    document.head.appendChild(script)
  })
  return mermaidLoadPromise
}
