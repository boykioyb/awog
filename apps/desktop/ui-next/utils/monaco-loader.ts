import type * as Monaco from 'monaco-editor'

// Memoized lazy import of the (heavy) monaco-editor bundle. Shared by the Monaco
// viewer (on mount) and the preview modal (warm-up when a text/markdown file
// opens) so the chunk is fetched/parsed at most once — and ideally while the user
// is still reading the rendered view, not on the click into the code view. That
// first import pulls in megabytes of editor code (and, under Nuxt dev, hundreds of
// on-demand ESM modules), which made switching to the code view feel very slow.
let promise: Promise<typeof Monaco> | null = null

export function loadMonaco(): Promise<typeof Monaco> {
  if (!promise) promise = import('monaco-editor')
  return promise
}
