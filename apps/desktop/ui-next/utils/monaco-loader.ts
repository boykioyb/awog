import type * as Monaco from 'monaco-editor'

// Memoized lazy import of the (heavy) monaco-editor bundle. Shared by the Monaco
// viewer (on mount) and the preview modal (warm-up when a text/markdown file
// opens) so the chunk is fetched/parsed at most once — and ideally while the user
// is still reading the rendered view, not on the click into the code view. That
// first import pulls in megabytes of editor code (and, under Nuxt dev, hundreds of
// on-demand ESM modules), which made switching to the code view feel very slow.
let promise: Promise<typeof Monaco> | null = null

export function loadMonaco(): Promise<typeof Monaco> {
  if (!promise) {
    // Clear the cache on failure — otherwise a single transient import error (e.g.
    // a Vite dev re-optimize race) is memoized forever, poisoning every later call
    // and leaving the viewer stuck on its spinner until a full app reload. Nulling
    // it lets the next open (or the viewer's Retry) re-import once Vite settles.
    promise = import('monaco-editor').catch((err) => {
      promise = null
      throw err
    })
  }
  return promise
}
