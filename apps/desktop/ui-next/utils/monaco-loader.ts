import type * as Monaco from 'monaco-editor'

// Memoized lazy import of the (heavy) monaco-editor bundle. Shared by the Monaco
// viewer (on mount) and the preview modal (warm-up when a text/markdown file
// opens) so the chunk is fetched/parsed at most once — and ideally while the user
// is still reading the rendered view, not on the click into the code view.
//
// Bundle comes from `public/vendor/monaco/monaco.js` — một file ESM do
// `scripts/prebundle-monaco.mjs` build sẵn bằng esbuild (chạy ở
// postinstall/predev/prebuild). Lý do: dep-optimizer gom monaco thành chunk
// ~7.3MB và dep request đi qua transform pipeline Nuxt → stack overflow trên
// file lớn → "Failed to fetch dynamically imported module". File tĩnh trong
// public/ bypass hoàn toàn transform + `?v` churn; load nhanh hơn cả raw-ESM.
// Đường dẫn tĩnh tới bundle prebuilt — để trong biến để TS không resolve module
// (file không tồn tại trong source tree, nó là artifact generate lúc dev/build).
const MONACO_BUNDLE_URL = '/vendor/monaco/monaco.js'
const MONACO_CSS_URL = '/vendor/monaco/monaco.css'

let promise: Promise<typeof Monaco> | null = null
let cssInjected = false

function injectMonacoCss(): void {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = MONACO_CSS_URL
  document.head.appendChild(link)
}

export function loadMonaco(): Promise<typeof Monaco> {
  if (!promise) {
    // Clear the cache on failure — otherwise a single transient import error is
    // memoized forever, poisoning every later call and leaving the viewer stuck
    // on its spinner until a full app reload. Nulling it lets the next open (or
    // the viewer's Retry) re-import.
    injectMonacoCss()
    promise = loadHeavyDep(
      () => import(/* @vite-ignore */ MONACO_BUNDLE_URL) as Promise<typeof Monaco>,
    ).catch((err) => {
      promise = null
      throw err
    })
  }
  return promise
}
