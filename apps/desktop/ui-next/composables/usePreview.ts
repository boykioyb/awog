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
  // 'folder' renders a lazy file tree of `workspaceRoot` (dragged working folder);
  // 'html' renders a sandboxed iframe (render) with a raw (Monaco) toggle;
  // 'video' / 'audio' stream through the media:// protocol (workspace files) or an
  // in-memory `src` (drag-dropped blob); 'doc' (Word) / 'sheet' (Excel) are parsed
  // from their OOXML bytes (utils/office-*); all other kinds render a single file.
  kind:
    | 'image'
    | 'pdf'
    | 'markdown'
    | 'text'
    | 'file'
    | 'html'
    | 'folder'
    | 'video'
    | 'audio'
    | 'doc'
    | 'sheet'
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

// Single source of truth for mapping a filename/path → preview kind. Previously
// duplicated in 5 places (Files tab, Diff, folder tree, attachment chip, composer).
const RE_IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i
const RE_PDF = /\.pdf$/i
const RE_MD = /\.(md|markdown|mdx)$/i
const RE_HTML = /\.html?$/i
// Formats Chromium can play; the media:// handler (electron/src/media.ts) serves
// the matching MIME. mkv/mov depend on codec — the modal falls back gracefully.
const RE_VIDEO = /\.(mp4|m4v|webm|ogv|mov|mkv)$/i
const RE_AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|weba)$/i
// OOXML only — the legacy binary .doc/.xls formats aren't parseable in-app and
// keep falling through to the "binary file, open externally" placeholder.
const RE_DOC = /\.(docx|docm|dotx)$/i
const RE_SHEET = /\.(xlsx|xlsm|xltx)$/i

export function previewKindFromPath(path: string): PreviewRef['kind'] {
  if (RE_IMAGE.test(path)) return 'image'
  if (RE_PDF.test(path)) return 'pdf'
  if (RE_MD.test(path)) return 'markdown'
  if (RE_HTML.test(path)) return 'html'
  if (RE_VIDEO.test(path)) return 'video'
  if (RE_AUDIO.test(path)) return 'audio'
  if (RE_DOC.test(path)) return 'doc'
  if (RE_SHEET.test(path)) return 'sheet'
  return 'text'
}

/** True for the OOXML kinds that need raw bytes (not text) to preview. */
export const isOfficeKind = (kind: PreviewRef['kind']): boolean =>
  kind === 'doc' || kind === 'sheet'

// Build the media:// URL for a workspace video/audio file. The Electron main
// process (apps/desktop/electron/src/media.ts) serves this scheme with HTTP Range
// support so the file streams + seeks instead of being base64-inlined. Keep this
// URL shape in sync with that handler.
export function mediaFileUrl(workspaceRoot: string, path: string): string {
  const qs = `root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(path)}`
  return `media://awog/?${qs}`
}

// Attachment variant: image/pdf are decided by the carried data (img flag / mime),
// the rest by the filename. No inline content (`text == null`) → an opaque file card.
export function previewKindFromAttachment(a: {
  img: boolean
  src?: string
  mime?: string
  text?: string
  name: string
}): PreviewRef['kind'] {
  if (a.img) return 'image'
  if (a.src && (a.mime === 'application/pdf' || RE_PDF.test(a.name))) return 'pdf'
  // Media is playable only when it carries a source (blob/object/data URL); a
  // dropped media file with no inline `src` falls through to an opaque file card.
  if (a.src && RE_VIDEO.test(a.name)) return 'video'
  if (a.src && RE_AUDIO.test(a.name)) return 'audio'
  // Office previews parse the bytes behind `src`; without one there's nothing to read.
  if (a.src && RE_DOC.test(a.name)) return 'doc'
  if (a.src && RE_SHEET.test(a.name)) return 'sheet'
  if (a.text == null) return 'file'
  if (RE_MD.test(a.name)) return 'markdown'
  if (RE_HTML.test(a.name)) return 'html'
  return 'text'
}

const current = ref<PreviewRef | null>(null)

// One-shot restore hint consumed by usePreviewModal right after (re)open. Carries
// the view mode + scroll offset captured when a preview was minimized so restoring
// a parked markdown lands where the user left off instead of at the top.
export type PreviewRestore = { view: 'render' | 'raw'; scrollTop: number }
const pendingRestore = ref<PreviewRestore | null>(null)

export function usePreview() {
  function open(item: PreviewRef) {
    current.value = item
    pendingRestore.value = null
  }
  // Re-open a previously minimized item, replaying its captured view + scroll.
  function restore(item: PreviewRef, hint: PreviewRestore) {
    current.value = item
    pendingRestore.value = hint
  }
  function close() {
    current.value = null
  }
  // Consume the pending hint (one-shot; clears itself).
  function takeRestore(): PreviewRestore | null {
    const r = pendingRestore.value
    pendingRestore.value = null
    return r
  }
  return { current, open, restore, close, takeRestore }
}
