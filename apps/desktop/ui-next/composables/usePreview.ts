import { computed, ref } from 'vue'

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
  // In-memory source for markdown / text (e.g. drag-dropped files).
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
//
// `version` (a reload counter) rides along only to make the URL differ, so the media
// element re-requests a file that was rewritten in place. The handler reads root+path
// and ignores everything else.
export function mediaFileUrl(workspaceRoot: string, path: string, version = 0): string {
  const qs = `root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent(path)}`
  return `media://awog/?${qs}${version ? `&v=${version}` : ''}`
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

// One chat attachment mapped onto a PreviewRef — the shape the modal and the image gallery
// consume. Structural param (not the SessionAttachment type) to keep this store free of
// session imports. Shared by the bubble chips, the composer tray and the context-files panel
// so all three open the same way and can hand each other's siblings to the gallery.
export type AttachmentLike = {
  name: string
  img: boolean
  src?: string
  text?: string
  size?: number
  mime?: string
  path?: string
  folder?: boolean
}
export function previewRefFromAttachment(a: AttachmentLike): PreviewRef {
  // A dragged folder previews as its lazy tree, rooted at its own path.
  if (a.folder && a.path) return { name: a.name, kind: 'folder', workspaceRoot: a.path }
  const item: PreviewRef = { name: a.name, kind: previewKindFromAttachment(a) }
  if (a.src) item.src = a.src
  if (a.text != null) item.text = a.text
  if (a.size != null) item.size = a.size
  if (a.mime) item.mime = a.mime
  return item
}

// Image siblings of an attachment list, for the gallery's "context" scope: stepping an
// attachment must walk the attachments it was opened with, not its folder on disk (it may
// have none). Non-images are skipped — ‹ › only makes sense between pictures.
export function imageSiblingsFromAttachments(list: readonly AttachmentLike[]): PreviewRef[] {
  return list.map(previewRefFromAttachment).filter((r) => r.kind === 'image')
}

const current = ref<PreviewRef | null>(null)
// Browser-style back history UNDER `current`. A frame is pushed when the user
// navigates INTO a file from within an open preview (a link in the rendered
// markdown, a file in the folder tree); Back / Esc pop it. A top-level open() resets
// it — a new open is a new root, not a deeper frame. Kept in this store so `current`
// stays the single "top of stack" every caller already reads.
const stack = ref<PreviewRef[]>([])
// Soft cap so a link cycle (A→B→A→…) can't grow history without bound.
const STACK_MAX = 25

// One-shot restore hint consumed by usePreviewModal right after (re)open. Carries
// the view mode + scroll offset captured when a preview was minimized so restoring
// a parked markdown lands where the user left off instead of at the top.
export type PreviewRestore = { view: 'render' | 'raw'; scrollTop: number }
const pendingRestore = ref<PreviewRestore | null>(null)

// Sibling set of the opened item — "the images this one belongs to". Supplied by the OPENER
// because only it knows the context: the composer's pending attachments, one message's
// attachments, … The preview steps through this instead of the enclosing folder, which is the
// wrong context for an attachment (it may not even be a workspace file). Empty → the modal
// falls back to listing the item's folder.
const gallery = ref<PreviewRef[]>([])

// Bumped on every preview-session boundary — a top-level open/restore and close, but NOT
// push/replace/back (those stay inside one session). Consumers that hold a per-session read
// cache (usePreviewModal's data-URL cache) key off this, so a file REGENERATED on disk between
// two opens is read again instead of being served from a stale entry.
const openEpoch = ref(0)

export function usePreview() {
  // True while there's a frame to go back to (drives the header Back button).
  const canGoBack = computed(() => stack.value.length > 0)

  function open(item: PreviewRef, siblings?: PreviewRef[]) {
    stack.value = [] // top-level open → new root
    current.value = item
    gallery.value = siblings ?? []
    pendingRestore.value = null
    openEpoch.value++
  }
  // Re-open a previously minimized item, replaying its captured view + scroll. The
  // back history is transient (not parked with the dock snapshot) → restore lands at
  // the root.
  function restore(item: PreviewRef, hint: PreviewRestore) {
    stack.value = []
    current.value = item
    gallery.value = []
    pendingRestore.value = hint
    openEpoch.value++
  }
  // Navigate INTO a new item, keeping the current one as history. A different file is a
  // different context, so the sibling set does NOT carry over.
  function push(item: PreviewRef) {
    if (current.value) {
      stack.value.push(current.value)
      if (stack.value.length > STACK_MAX) stack.value.shift()
    }
    current.value = item
    gallery.value = []
    pendingRestore.value = null
  }
  // Swap the top item in place (rename / move / reload / a gallery step): the SAME logical
  // context at a new path/content, so it must NOT become a history frame (Back would otherwise
  // land on a stale path that no longer exists) and the sibling set stays as it is.
  function replace(item: PreviewRef) {
    current.value = item
    pendingRestore.value = null
  }
  // Pop one frame. Returns false when already at the root (nothing to go back to).
  function back(): boolean {
    const prev = stack.value.pop()
    if (!prev) return false
    current.value = prev
    gallery.value = []
    pendingRestore.value = null
    return true
  }
  function close() {
    stack.value = []
    current.value = null
    gallery.value = []
    openEpoch.value++
  }
  // Consume the pending hint (one-shot; clears itself).
  function takeRestore(): PreviewRestore | null {
    const r = pendingRestore.value
    pendingRestore.value = null
    return r
  }
  return {
    current,
    gallery,
    canGoBack,
    openEpoch,
    open,
    restore,
    push,
    replace,
    back,
    close,
    takeRestore,
  }
}
