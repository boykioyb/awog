import { ref } from 'vue'

// Shared, app-wide preview state (§7). A single PreviewModal instance reads this
// store so a chip rendered deep in the transcript can open the full-window viewer
// without prop-drilling. The modal also still accepts a local `item` prop (the
// pre-existing composer flow), which takes priority over this shared `current`.
//
// Module-level refs → one source of truth for every caller. `open()` replaces the
// current item; `close()` clears it. Callers map their domain object (e.g. a
// SessionAttachment) into a PreviewItem before calling `open`.

// Mirrors PreviewModal's PreviewItem, declared here to avoid a circular import
// (PreviewModal imports from this composable). The modal re-exports its own type
// for prop typing; both shapes are kept in sync by hand (small, stable surface).
export type PreviewRef = {
  name: string
  kind: 'image' | 'pdf' | 'markdown' | 'text' | 'file'
  // Object URL / data URL for images and PDFs (drag-dropped / inlined files).
  src?: string
  // In-memory source for markdown / text (drag-dropped files, mock data).
  text?: string
  size?: number
  mime?: string
  // Monaco language hint for the code viewer (§9). Best-effort; absent = inferred.
  language?: string
  // ── Workspace-file reference (§7 "preview from real workspace") ─────────────
  // When set AND the Electron bridge is available, the modal lazily reads the
  // file content via fs.readFile / fs.readFileBase64 (gated by
  // assertInsideWorkspace) instead of relying on `src`/`text`. Degrades to the
  // in-memory fields / placeholder when absent or unavailable.
  workspaceRoot?: string
  path?: string
}

const current = ref<PreviewRef | null>(null)

export function usePreview() {
  function open(item: PreviewRef) {
    current.value = item
  }
  function close() {
    current.value = null
  }
  return { current, open, close }
}
