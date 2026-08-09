import { computed, nextTick, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { PreviewRef } from '~/composables/usePreview'
import {
  usePreview,
  previewKindFromPath,
  mediaFileUrl,
  isOfficeKind,
} from '~/composables/usePreview'
import { useOfficePreview } from '~/composables/useOfficePreview'
import { base64ToBytes, type Bytes } from '~/utils/office-zip'
import { useSidecar } from '~/composables/useSidecar'
import { useI18n } from '~/composables/useI18n'
import { useMarkdown, type MdSegment } from '~/composables/useMarkdown'
import { useZoomPan } from '~/composables/useZoomPan'
import { useMarkdownOutline } from '~/composables/useMarkdownOutline'
import { usePreviewFind } from '~/composables/usePreviewFind'
import { ATTACHMENT_TEXT_MAX, useChatAttach } from '~/composables/useChatAttach'
import { normalizeWorkspacePath } from '~/utils/file-links'
import { useMinimizeDock, previewDockId } from '~/composables/useMinimizeDock'
import type { SessionAttachment, TreeNode } from '~/composables/useSessionsData'
import type { FileTreeController } from '~/components/session/SessionFileTree.vue'

// Page-controller for the shared PreviewModal (nuxt-vue page-controller rule): the
// SFC stays a thin template, all state + IPC live here. Orchestrates:
//   - item resolution (prop wins, shared usePreview() store fallback)
//   - lazy workspace-file load (fs.readFile / fs.readFileBase64)
//   - viewer state (image transform, markdown render/raw + outline, monaco lang)
//   - edit mode (editable Monaco) + atomic save (fs.writeFile)
//   - file actions (reveal / open-in-browser / copy-path / rename / move / delete /
//     add-to-chat), gated to real workspace-file previews
// SoC: no DOM / SDK imports — IPC goes through useSidecar; the modal never touches fs.

type PreviewEmit = (e: 'close') => void

// Sidecar fs.* result shapes (mirror apps/desktop/sidecar/src/types/shared.ts).
// Declared locally so the UI owns no cross-app import; small, stable surface.
interface FsFileContent {
  path: string
  content: string
  language?: string
  truncated: boolean
  isBinary: boolean
}
interface FsFileBase64 {
  path: string
  base64: string
  mimeType: string
  size: number
  truncated: boolean
}

type LoadStatus = 'idle' | 'loading' | 'error' | 'tooLarge' | 'binary' | 'officeError'

type RenameMode = 'rename' | 'move'

// A deferred yes/no prompt rendered by the modal (delete + discard-edits reuse it).
export interface ConfirmRequest {
  titleKey: string
  messageKey: string
  confirmKey: string
  danger: boolean
  run: () => void | Promise<void>
}

// Monaco language inferred from a file extension when the sidecar didn't supply one.
const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'html',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
}
const langFromName = (name: string): string =>
  EXT_LANG[name.split('.').pop()?.toLowerCase() ?? ''] ?? ''

// Read cap for text/markdown previews. The sidecar default (512 KB) silently
// dropped the tail of larger docs — both the markdown render and the code view
// showed a truncated file with no indication, so a long doc looked "cut off".
// Match the sidecar hard max so reasonable docs render in full; the rare file
// past this still surfaces via the `truncated` flag instead of failing silently.
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024

export function usePreviewModal(
  props: { item: PreviewRef | null; windowMode?: boolean },
  emit: PreviewEmit,
) {
  const { t } = useI18n()
  const { renderMarkdown } = useMarkdown()
  const sc = useSidecar()
  const {
    current: sharedItem,
    gallery: sharedGallery,
    close: closeShared,
    takeRestore,
    push: pushShared,
    replace: replaceShared,
    back: backShared,
    canGoBack,
  } = usePreview()
  const chatAttach = useChatAttach()
  const dock = useMinimizeDock()
  // Office (docx/xlsx) model + view state, parsed from the file's bytes.
  const office = useOfficePreview()

  // Effective item: explicit prop wins, shared store is the fallback.
  const item = computed<PreviewRef | null>(() => props.item ?? sharedItem.value)

  // Only the shared store drives real workspace-file previews, so file mutations
  // (rename/delete) repoint the shared item; gate every action on this.
  const hasWorkspaceFile = computed(
    () => !!(item.value?.workspaceRoot && item.value?.path && sc.available),
  )

  // Scroll offset to replay once the (re)opened markdown has rendered — set from a
  // minimize-dock restore hint; null otherwise. Applied by the watcher below.
  const pendingScroll = ref<number | null>(null)

  // ── image transform ─────────────────────────────────────────────────────────
  const {
    scale,
    tx,
    ty,
    zoomBy,
    setScale,
    reset,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = useZoomPan()
  const rotate = ref(0)
  const flipH = ref(false)
  const flipV = ref(false)
  const imgStyle = computed(() => ({
    transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value}) rotate(${rotate.value}deg) scaleX(${flipH.value ? -1 : 1}) scaleY(${flipV.value ? -1 : 1})`,
  }))
  function resetView() {
    reset()
    rotate.value = 0
    flipH.value = false
    flipV.value = false
  }

  // Image viewport (`.pvimgvp`) + the <img> — measured by fitImage().
  const imgVpRef = useTemplateRef<HTMLElement>('imgVp')
  const imgElRef = useTemplateRef<HTMLImageElement>('imgEl')

  // Fit a `w`×`h` bitmap into the frame and re-center. Kept separate from any DOM read so it
  // can be applied to an image that hasn't been put in the <img> yet (see showImage — that's
  // what lets the swap and its zoom land on the SAME frame instead of flashing at 100% first).
  // `shrinkOnly` never scales past 1:1.
  function applyImageFit(w: number, h: number, opts?: { shrinkOnly?: boolean }): void {
    const vp = imgVpRef.value
    if (!vp || !w || !h) return
    const quarter = Math.abs(Math.round(rotate.value / 90)) % 2 === 1
    const vw = vp.clientWidth
    const vh = vp.clientHeight
    if (!vw || !vh) return
    const contain = Math.min(vw / (quarter ? h : w), vh / (quarter ? w : h))
    tx.value = 0
    ty.value = 0
    setScale(opts?.shrinkOnly ? Math.min(1, contain) : contain)
  }

  // Toolbar Fit — measures the LIVE img's layout box (offsetWidth/Height: transform-
  // independent, i.e. its size at scale 1 = natural size, since CSS no longer constrains it),
  // never getBoundingClientRect (which already includes the current transform). Zoom is the
  // only thing that sizes the image (see the .pvimgvp/.pvimg CSS), so this is the single place
  // that decides "fits the frame". Fits BOTH ways, so a small image fills the frame too.
  function fitImage(): void {
    const img = imgElRef.value
    if (!img) return
    applyImageFit(img.offsetWidth, img.offsetHeight)
  }

  // Every image opens FITTED (shrink-only, so a small one stays 1:1 as viewers do). Normally
  // showImage() does it before the bitmap is even in the <img>; this @load hook covers the
  // paths that bypass it — an in-memory image (attachment / dropped blob) whose src comes
  // straight off the item. Once per item, so it can never fight a manual zoom or a later
  // @load (Reload after an on-disk change keeps whatever zoom the user set).
  const itemKey = (it: PreviewRef): string => `${it.workspaceRoot ?? ''}::${it.path ?? it.name}`
  let autoFitFor: string | null = null
  function onImageLoad(): void {
    const it = item.value
    const img = imgElRef.value
    if (!it || !img || autoFitFor === itemKey(it)) return
    autoFitFor = itemKey(it)
    applyImageFit(img.offsetWidth, img.offsetHeight, { shrinkOnly: true })
  }

  // ── image gallery: step through the images of this context ────────────────────
  // Opening ONE image of a set and having to close + reopen for the next is the pain here, so
  // an image preview gains ‹ › / ←→ stepping. The set is ALWAYS the sibling list the opener
  // handed over (`usePreview().open(item, siblings)`) — the images of this session / this
  // message / the composer tray. Deliberately NOT "every image in the folder": a folder listing
  // pulls in unrelated files (and means nothing for an in-memory attachment), so a preview only
  // ever walks a set someone explicitly decided belongs together.
  const galleryEntries = computed<PreviewRef[]>(() =>
    sharedGallery.value.filter((e) => e.kind === 'image'),
  )

  // Identity within the set: a workspace file is its root+path, an in-memory attachment is its
  // src (data/blob URL), and a bare name is the last resort.
  const sameEntry = (a: PreviewRef, b: PreviewRef): boolean =>
    a.workspaceRoot && a.path
      ? a.workspaceRoot === b.workspaceRoot && a.path === b.path
      : a.src
        ? a.src === b.src
        : a.name === b.name && !b.path

  const galleryIndex = computed(() => {
    const it = item.value
    return it ? galleryEntries.value.findIndex((e) => sameEntry(it, e)) : -1
  })
  const canStepImages = computed(() => galleryIndex.value >= 0 && galleryEntries.value.length > 1)
  const galleryLabel = computed(() =>
    canStepImages.value ? `${galleryIndex.value + 1}/${galleryEntries.value.length}` : '',
  )

  // Read + decode the images either side of the current one while it's on screen, so a step is
  // instant and paints without an intermediate frame. Fire-and-forget: a failed prefetch just
  // means the step does the work itself.
  function prefetchNeighbours(): void {
    if (!canStepImages.value) return
    const n = galleryEntries.value.length
    for (const delta of [1, -1]) {
      const next = galleryEntries.value[(galleryIndex.value + delta + n) % n]
      if (!next || (item.value && sameEntry(item.value, next))) continue
      if (next.workspaceRoot && next.path) {
        void readDataUrl(next)
          .then((url) => {
            if (url) new Image().src = url // decode too — the swap then paints immediately
          })
          .catch(() => null)
      } else if (next.src) {
        new Image().src = next.src // already in memory; just warm the decode
      }
    }
  }

  // Move `delta` images through the set (wrapping). Replaces the current item instead of
  // pushing history: stepping a gallery is not "navigating into" a file, so Back still
  // returns to whatever opened the first image.
  function stepImage(delta: number): void {
    if (!canStepImages.value) return
    const n = galleryEntries.value.length
    const next = galleryEntries.value[(galleryIndex.value + delta + n) % n]
    if (!next) return
    // No resetView() here: it would zero the zoom while the PREVIOUS image is still the one on
    // screen, flashing it at 100% for a frame. showImage() resets the view as part of the swap.
    // The item watcher warms the new neighbours right after this (see prefetchNeighbours).
    replaceShared({ ...next })
  }

  // ── workspace-file loading ───────────────────────────────────────────────────
  const loadStatus = ref<LoadStatus>('idle')
  const loadedText = ref<string | null>(null)
  const loadedSrc = ref<string | null>(null)
  const loadedLang = ref<string | undefined>(undefined)
  // True when the file exceeded PREVIEW_MAX_BYTES and only its head was read.
  const truncated = ref(false)
  let loadSeq = 0

  const isBinaryKind = (k: PreviewRef['kind']) => k === 'image' || k === 'pdf'
  // Video/audio never go through the base64 reader — they stream via media://
  // (or an in-memory `src`) and are decoded by the native <video>/<audio> element.
  const isMediaKind = (k: PreviewRef['kind']) => k === 'video' || k === 'audio'

  // Set when the media element can't decode the source (unsupported codec, read
  // error) → the modal swaps the player for an "open externally" placeholder.
  const mediaError = ref(false)
  function onMediaError() {
    mediaError.value = true
  }

  // ── binary (image/pdf) data-URL cache ────────────────────────────────────────
  // Stepping a gallery re-reads each file through the sidecar, and an async read means one
  // frame with no source at all — the modal falls back to its loading placeholder and the
  // viewer visibly BLINKS between images. A tiny cache makes a step that lands on an
  // already-read neighbour instant (no read, no placeholder), and prefetchNeighbours() warms
  // the next/previous image while the current one is on screen so forward/back stepping is
  // normally a cache hit. Capped by count, evicting oldest-first, since a decoded data URL
  // is ~1.4× the file size and these are full-resolution renders.
  const DATA_URL_CACHE_MAX = 6
  const dataUrlCache = new Map<string, string>()
  const cacheKey = (it: PreviewRef): string => `${it.workspaceRoot ?? ''}::${it.path ?? ''}`

  function cachedDataUrl(it: PreviewRef | null): string | null {
    if (!it?.workspaceRoot || !it.path) return null
    return dataUrlCache.get(cacheKey(it)) ?? null
  }

  // Read a binary file as a data: URL (cached). null when it's too large / unreadable —
  // the caller surfaces that as its own status, and nothing is cached.
  async function readDataUrl(it: PreviewRef): Promise<string | null> {
    const cached = cachedDataUrl(it)
    if (cached) return cached
    const res = await sc.request<FsFileBase64>('fs.readFileBase64', {
      workspaceRoot: it.workspaceRoot,
      path: it.path,
    })
    if (res.truncated || !res.base64) return null
    const url = `data:${res.mimeType};base64,${res.base64}`
    dataUrlCache.set(cacheKey(it), url)
    while (dataUrlCache.size > DATA_URL_CACHE_MAX) {
      const oldest = dataUrlCache.keys().next().value
      if (oldest === undefined) break
      dataUrlCache.delete(oldest)
    }
    return url
  }

  // Show a workspace IMAGE without a visible transition. Every naive ordering blinks:
  //   - clearing the src first → one frame of empty frame / loading placeholder;
  //   - swapping the src and fitting on @load → one frame of the new bitmap at 100%, which for
  //     a tall render means a huge picture flashing past before it snaps to fit.
  // So: read (cache-first) → DECODE off-screen → then, in a single tick, hand the src to the
  // live <img> together with the zoom that fits it. Until that tick the previous image stays
  // painted, so a gallery step is a straight cut with no intermediate state. The loading
  // placeholder is only used when there is nothing on screen yet (first open of the modal).
  async function showImage(it: PreviewRef): Promise<void> {
    const seq = ++loadSeq
    if (!loadedSrc.value) loadStatus.value = 'loading'
    try {
      // A workspace file is read (cache-first); an in-memory attachment already carries its
      // data/blob URL and only needs the decode + fit half of this flow.
      const url = it.workspaceRoot && it.path ? await readDataUrl(it) : (it.src ?? null)
      if (seq !== loadSeq) return
      if (!url) {
        loadStatus.value = 'tooLarge'
        loadedSrc.value = null
        return
      }
      const probe = new Image()
      probe.src = url
      // decode() resolves once the bitmap is ready to paint (instantly for a prefetched
      // neighbour). Its rejection is not interesting — the <img> itself will surface a broken
      // image, and the natural size is read from the probe either way.
      await probe.decode().catch(() => undefined)
      if (seq !== loadSeq) return
      autoFitFor = itemKey(it) // this IS the item's automatic fit — @load must not redo it
      rotate.value = 0
      flipH.value = false
      flipV.value = false
      applyImageFit(probe.naturalWidth, probe.naturalHeight, { shrinkOnly: true })
      loadedSrc.value = url
      loadStatus.value = 'idle'
    } catch {
      if (seq !== loadSeq) return
      loadStatus.value = 'error'
      loadedSrc.value = null
    }
  }

  async function loadFromWorkspace(it: PreviewRef) {
    const seq = ++loadSeq
    loadStatus.value = 'loading'
    loadedText.value = null
    loadedSrc.value = null
    loadedLang.value = undefined
    truncated.value = false
    try {
      if (isOfficeKind(it.kind)) {
        const res = await sc.request<FsFileBase64>('fs.readFileBase64', {
          workspaceRoot: it.workspaceRoot,
          path: it.path,
        })
        if (seq !== loadSeq) return
        if (res.truncated || !res.base64) {
          loadStatus.value = 'tooLarge'
          return
        }
        await parseOffice(it, base64ToBytes(res.base64), seq)
      } else if (isBinaryKind(it.kind)) {
        const url = await readDataUrl(it)
        if (seq !== loadSeq) return
        if (!url) {
          loadStatus.value = 'tooLarge'
          return
        }
        loadedSrc.value = url
        loadStatus.value = 'idle'
      } else {
        const res = await sc.request<FsFileContent>('fs.readFile', {
          workspaceRoot: it.workspaceRoot,
          path: it.path,
          maxBytes: PREVIEW_MAX_BYTES,
        })
        if (seq !== loadSeq) return
        if (res.isBinary) {
          loadStatus.value = 'binary'
          return
        }
        loadedText.value = res.content
        loadedLang.value = res.language
        truncated.value = res.truncated
        loadStatus.value = 'idle'
        // Code/config files (kind 'text') open ready to edit — no read-only gate,
        // no extra "Edit" click. Markdown/html keep their rendered preview as the
        // default and edit on demand. Skip a truncated read: saving would drop the
        // unread tail. (seq check above guarantees `it` is still the current item.)
        if (it.kind === 'text' && isEditableFile.value && !truncated.value) startEdit()
      }
    } catch {
      if (seq !== loadSeq) return
      loadStatus.value = 'error'
    }
  }

  // Parse docx/xlsx bytes into the office model. A file we can't read (corrupt,
  // encrypted, or a legacy .doc renamed to .docx) resolves to 'officeError', which
  // keeps the toolbar so "open externally" is still one click away.
  async function parseOffice(it: PreviewRef, bytes: Bytes, seq: number) {
    const kind = it.kind === 'sheet' ? 'sheet' : 'doc'
    const ok = await office.parse(kind, bytes)
    if (seq !== loadSeq) return
    loadStatus.value = ok ? 'idle' : 'officeError'
  }

  // In-memory office preview (attachment / SFTP download): the bytes live behind a
  // data:/blob: URL rather than a workspace path.
  async function loadOfficeFromSrc(it: PreviewRef) {
    const seq = ++loadSeq
    loadStatus.value = 'loading'
    try {
      const bytes = new Uint8Array(await (await fetch(it.src ?? '')).arrayBuffer())
      if (seq !== loadSeq) return
      await parseOffice(it, bytes, seq)
    } catch {
      if (seq !== loadSeq) return
      loadStatus.value = 'officeError'
    }
  }

  // Effective content: prefer freshly-loaded workspace data, fall back to in-memory.
  const effectiveText = computed(() => loadedText.value ?? item.value?.text ?? '')
  const effectiveSrc = computed(() => {
    const it = item.value
    // Media streams from a URL, never base64: an in-memory `src` (drag-dropped
    // blob) wins; otherwise a workspace file resolves to its media:// URL.
    if (it && isMediaKind(it.kind)) {
      if (it.src) return it.src
      if (it.workspaceRoot && it.path && sc.available)
        return mediaFileUrl(it.workspaceRoot, it.path)
      return ''
    }
    return loadedSrc.value ?? it?.src ?? ''
  })
  const effectiveLang = computed(() => item.value?.language ?? loadedLang.value)

  const monacoLang = computed(() => {
    const it = item.value
    if (!it) return ''
    if (it.kind === 'markdown') return 'markdown'
    return effectiveLang.value ?? langFromName(it.name)
  })

  // ── folder tree (kind: 'folder') ─────────────────────────────────────────────
  // Lazy file tree of item.workspaceRoot (a dragged working folder). Mirrors the
  // Files-tab controller (WorkspaceFiles.vue) rooted at the previewed folder via
  // fs.listDir. Clicking a file repoints the modal to that file (workspaceRoot +
  // path → fs.readFile), so the tree and file views share this one modal.
  type FsDirEntry = { name: string; path: string; kind: 'file' | 'dir'; size?: number }
  const treeChildren = reactive<Record<string, FsDirEntry[]>>({})
  const treeExpanded = reactive<Set<string>>(new Set())
  const treeSelected = ref<string | null>(null)
  const treeLoading = ref(false)

  const treeNodesFor = (dir: string): TreeNode[] =>
    (treeChildren[dir] ?? []).map<TreeNode>((e) =>
      e.kind === 'dir' ? { d: e.name } : { f: e.name },
    )
  const treeRootNodes = computed<TreeNode[]>(() => treeNodesFor(''))

  async function loadTreeDir(root: string, dir: string): Promise<void> {
    if (treeChildren[dir]) return
    treeLoading.value = true
    try {
      const res = await sc.request<{ entries: FsDirEntry[] }>('fs.listDir', {
        workspaceRoot: root,
        ...(dir ? { path: dir } : {}),
      })
      treeChildren[dir] = res.entries
    } catch {
      treeChildren[dir] = []
    } finally {
      treeLoading.value = false
    }
  }

  function openTreeFile(path: string): void {
    const root = item.value?.workspaceRoot
    if (!root) return
    treeSelected.value = path
    // Navigate INTO the file (push history) → the load watcher fetches its content,
    // and Back returns to this folder tree.
    pushShared({
      name: path.split('/').pop() || path,
      kind: previewKindFromPath(path),
      workspaceRoot: root,
      path,
    })
  }

  // A workspace/relative link clicked inside the RENDERED markdown → open the
  // referenced file IN THIS modal (repoint the shared item) instead of letting the
  // SPA router navigate to a dead route (a bare doc path like `tasks/…/review.md`
  // has no page → 404 + "Go back home" nukes the session). Mirrors
  // SessionMarkdownHtml's link handling; the shell-mounted modal has no
  // useFilePreview index, so it resolves the href relative to the current file's
  // dir (resolveMdAsset — same base the inline images use) under the item's
  // workspaceRoot. External URLs / in-page anchors are filtered by the caller.
  function openLink(href: string): void {
    const root = item.value?.workspaceRoot
    if (!root) return
    const path = resolveMdAsset(href)
    if (!path) return
    // Navigate INTO the linked file (push history) so Back returns to the doc/response
    // the link was clicked from.
    pushShared({
      name: path.split('/').pop() || path,
      kind: previewKindFromPath(path),
      workspaceRoot: root,
      path,
    })
  }

  const treeCtrl: FileTreeController = {
    isOpen: (p) => treeExpanded.has(p),
    toggle: (p) => {
      const root = item.value?.workspaceRoot
      if (treeExpanded.has(p)) {
        treeExpanded.delete(p)
      } else {
        treeExpanded.add(p)
        if (root) void loadTreeDir(root, p)
      }
    },
    selectedPath: treeSelected,
    selectFile: (p) => openTreeFile(p),
    childrenFor: (p) => treeNodesFor(p),
  }

  // ── markdown / html render/raw + outline ─────────────────────────────────────
  const view = ref<'render' | 'raw'>('render')
  // Bumped on reload to force the HTML iframe to re-create (re-run its scripts even
  // when the content string is unchanged).
  const htmlReloadKey = ref(0)
  // Re-fetch the file from disk (HTML preview "reload"): pick up on-disk edits and
  // re-render. Bumping the key also re-runs an unchanged page's scripts.
  function reload(): void {
    htmlReloadKey.value += 1
    const it = item.value
    if (it && it.workspaceRoot && it.path && sc.available) void loadFromWorkspace(it)
  }
  // ── markdown image resolution (workspace-relative → base64 data URL) ──────────
  // A markdown file's `![](…)` images use paths relative to the file on disk; v-html
  // resolves them against the app:// origin (not the file's directory), so they render
  // broken. Read each referenced image through the sidecar (fs.readFileBase64) and swap
  // its src to a data: URL inline. Keyed by the ORIGINAL src string; '' marks in-flight
  // / failed (keeps the original src, so a genuinely missing file still reads as broken).
  const mdImages = reactive<Record<string, string>>({})

  // Leave remote/data/app assets alone — only local relative refs need resolving.
  const isRelativeAsset = (src: string): boolean =>
    !!src && !/^(?:https?:|data:|blob:|app:|file:)/i.test(src)

  // Directory of the markdown file relative to workspaceRoot ('' at root). In-memory
  // markdown (a fullscreened chat reply) has no file → '' , i.e. refs are anchored at
  // the workspace root, matching how the transcript resolves the same text.
  function mdDir(): string {
    const p = item.value?.path ?? ''
    const i = p.lastIndexOf('/')
    return i >= 0 ? p.slice(0, i) : ''
  }

  // Resolve a relative image/link ref against the md file's own dir (a leading '/' =
  // workspace root) to a normalized workspace-relative path — shared with the other
  // markdown surfaces via utils/file-links.
  const resolveMdAsset = (src: string): string | null => normalizeWorkspacePath(src, mdDir())

  // Capture groups: 1 = `<img … src="`, 2 = the src, 3 = the closing quote.
  const IMG_SRC_RE = /(<img\b[^>]*?\bsrc=")([^"]*)(")/gi
  function rewriteImgSrc(html: string): string {
    if (!html.includes('<img')) return html
    return html.replace(IMG_SRC_RE, (m, pre: string, src: string, post: string) => {
      if (!isRelativeAsset(src)) return m
      const data = mdImages[src]
      return data ? `${pre}${data}${post}` : m
    })
  }

  async function loadMdImages(): Promise<void> {
    const it = item.value
    // A root is enough — `path` is optional (in-memory markdown resolves from the root).
    if (!it || it.kind !== 'markdown' || !it.workspaceRoot || !sc.available) return
    const srcs = new Set<string>()
    for (const seg of rawSegments.value) {
      if (seg.type !== 'html') continue
      for (const m of seg.html.matchAll(IMG_SRC_RE)) {
        const src = m[2]
        if (src && isRelativeAsset(src) && !(src in mdImages)) srcs.add(src)
      }
    }
    for (const src of srcs) {
      const rel = resolveMdAsset(src)
      if (!rel) continue
      mdImages[src] = '' // in-flight sentinel (dedupe concurrent loads)
      try {
        const res = await sc.request<FsFileBase64>('fs.readFileBase64', {
          workspaceRoot: it.workspaceRoot,
          path: rel,
        })
        if (res.base64 && !res.truncated) {
          mdImages[src] = `data:${res.mimeType};base64,${res.base64}`
        }
      } catch {
        // leave '' → keeps the original relative src (renders as a missing file)
      }
    }
  }

  const rawSegments = computed(() =>
    item.value?.kind === 'markdown' ? renderMarkdown(effectiveText.value) : [],
  )
  // Rendered segments with relative image srcs rewritten to loaded data URLs.
  const segments = computed<MdSegment[]>(() =>
    rawSegments.value.map((seg) =>
      seg.type === 'html' ? { type: 'html', html: rewriteImgSrc(seg.html) } : seg,
    ),
  )
  const outline = useMarkdownOutline(computed(() => `${view.value}:${segments.value.length}`))

  // ── find-in-page (⌘/Ctrl+F) ──────────────────────────────────────────────────
  // Custom search bar drives the markdown-render surface (`.mdbody`); Monaco/PDF use
  // their own native find. `monacoRef` is the MonacoViewer's exposed { focusFind }.
  const monacoRef = shallowRef<{ focusFind: () => boolean } | null>(null)
  const find = usePreviewFind(
    () => (outline.mdScroll.value?.querySelector('.mdbody') as HTMLElement | null) ?? null,
  )
  const isMarkdownRender = computed(
    () => item.value?.kind === 'markdown' && view.value === 'render',
  )
  // Leaving the markdown-render surface (render→raw, or edit mode) tears down find.
  watch(view, () => find.closeFind())

  // The user's current text selection, but only when it lies inside the
  // markdown-render surface (`.mdbody`) — used to prefill the find bar on ⌘/Ctrl+F.
  // Collapsed to a single line + capped so a huge multi-line selection doesn't become
  // an unwieldy query; empty string when there's nothing usable.
  function selectionInMdBody(): string {
    const sel = window.getSelection()
    const raw = sel?.toString() ?? ''
    if (!raw.trim() || !sel || sel.rangeCount === 0) return ''
    const root = outline.mdScroll.value?.querySelector('.mdbody')
    if (!root) return ''
    const node = sel.getRangeAt(0).commonAncestorContainer
    const el = node instanceof HTMLElement ? node : node.parentElement
    if (!el || !root.contains(el)) return ''
    return (raw.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  }

  // (Re)resolve markdown images whenever the rendered content changes (file load,
  // on-disk edit, or switching to another markdown file).
  watch(
    () => (item.value?.kind === 'markdown' ? effectiveText.value : ''),
    () => {
      void loadMdImages()
    },
  )

  // Replay a restore hint's scroll once the markdown render view has content in the
  // DOM (content loads async, so the item watcher fires before it lands). rAF after
  // nextTick lets layout settle so scrollTop sticks; one-shot then cleared.
  watch([effectiveText, view], () => {
    if (pendingScroll.value == null) return
    if (item.value?.kind !== 'markdown' || view.value !== 'render') return
    const y = pendingScroll.value
    nextTick(() =>
      requestAnimationFrame(() => {
        const el = outline.mdScroll.value
        if (el) el.scrollTop = y
        pendingScroll.value = null
      }),
    )
  })

  // ── minimize (park to the corner dock) ───────────────────────────────────────
  // Offered unless there are UNSAVED edits — the dock snapshot doesn't carry a
  // draft, so minimizing mid-edit would drop it. A clean editor (e.g. a code file
  // that auto-opened in edit mode but wasn't touched) can still be parked; restore
  // re-loads it. Captures the current view + markdown scroll so restore lands where
  // the user left off.
  // The minimize dock lives in the main window, so a popout parks nothing — it already
  // IS a window the OS can minimize.
  const canMinimize = computed(() => !!item.value && !dirty.value && !props.windowMode)
  function minimize() {
    const it = item.value
    if (!it || dirty.value) return
    const scrollTop =
      it.kind === 'markdown' && view.value === 'render'
        ? (outline.mdScroll.value?.scrollTop ?? 0)
        : 0
    dock.minimize({
      id: previewDockId(it),
      kind: 'preview',
      icon: headIcon.value,
      title: it.name,
      ref: it,
      view: view.value,
      scrollTop,
    })
    doClose()
  }

  // ── edit mode + save ─────────────────────────────────────────────────────────
  const editMode = ref(false)
  const draft = ref('')
  const isEditableFile = computed(
    () =>
      hasWorkspaceFile.value && (item.value?.kind === 'text' || item.value?.kind === 'markdown'),
  )
  const dirty = computed(() => editMode.value && draft.value !== effectiveText.value)
  // What the Monaco viewer renders: the live draft while editing, else the file.
  const editorValue = computed(() => (editMode.value ? draft.value : effectiveText.value))
  const editorReadOnly = computed(() => !editMode.value)

  function startEdit() {
    if (!isEditableFile.value) return
    draft.value = effectiveText.value
    if (item.value?.kind === 'markdown') view.value = 'raw'
    editMode.value = true
  }
  function cancelEdit() {
    editMode.value = false
    draft.value = ''
  }
  function onEditorChange(text: string) {
    if (editMode.value) draft.value = text
  }
  async function save() {
    const it = item.value
    if (!editMode.value || !it?.workspaceRoot || !it.path) return
    try {
      await sc.request('fs.writeFile', {
        workspaceRoot: it.workspaceRoot,
        path: it.path,
        content: draft.value,
      })
      loadedText.value = draft.value // new baseline → dirty clears
      flash(t('common.preview.saved'))
    } catch (e) {
      flash(errMessage(e) || t('common.preview.saveError'), true)
    }
  }

  // ── transient action feedback (no toast system in ui-next yet) ────────────────
  const actionMsg = ref<string | null>(null)
  const actionErr = ref(false)
  let msgTimer: ReturnType<typeof setTimeout> | null = null
  function flash(msg: string, err = false) {
    actionMsg.value = msg
    actionErr.value = err
    if (msgTimer) clearTimeout(msgTimer)
    msgTimer = setTimeout(() => {
      actionMsg.value = null
    }, 2400)
  }
  function errMessage(e: unknown): string {
    return e instanceof Error ? e.message : ''
  }

  // ── file actions ─────────────────────────────────────────────────────────────
  async function reveal() {
    const it = item.value
    if (!it?.workspaceRoot || !it.path) return
    try {
      await sc.revealPath(it.workspaceRoot, it.path)
    } catch {
      flash(t('common.preview.revealError'), true)
    }
  }
  async function openInBrowser() {
    const it = item.value
    if (!it?.workspaceRoot || !it.path) return
    try {
      await sc.openFileExternal(it.workspaceRoot, it.path)
    } catch {
      flash(t('common.preview.browserError'), true)
    }
  }
  // Pop the file out into its own OS window (docs/features/preview-popout-window.md) so
  // it can sit on a second display while work continues in the main window. Gated on a
  // real workspace file — the popout renderer re-reads the content from disk, so an
  // in-memory preview (a fullscreened chat reply, a dropped blob) has nothing to read —
  // and hidden inside a popout, which must not spawn another copy of itself.
  const canOpenInWindow = computed(() => hasWorkspaceFile.value && !props.windowMode)
  async function openInWindow() {
    const it = item.value
    if (!it?.workspaceRoot || !it.path) return
    try {
      await sc.openPreviewWindow(it.workspaceRoot, it.path, it.name)
    } catch {
      flash(t('common.preview.windowError'), true)
    }
  }
  async function copyPath() {
    const it = item.value
    if (!it?.workspaceRoot || !it.path) return
    const abs = `${it.workspaceRoot.replace(/[/\\]+$/, '')}/${it.path}`
    try {
      await navigator.clipboard.writeText(abs)
      flash(t('common.preview.pathCopied'))
    } catch {
      flash(t('common.preview.copyError'), true)
    }
  }
  // What "copy" and "add to chat" hand over. Office kinds carry no text of their
  // own — they project their parsed model (docx prose / sheet TSV), which is what
  // makes a .docx spec or .xlsx table usable as chat context.
  const plainText = computed(() =>
    item.value && isOfficeKind(item.value.kind) ? office.text.value : effectiveText.value,
  )

  // Copy the visible text content (markdown/code/text/office), independent of file actions.
  async function copyContent() {
    if (plainText.value) await navigator.clipboard.writeText(plainText.value)
  }

  const canAddToChat = computed(
    () =>
      chatAttach.available.value &&
      item.value != null &&
      item.value.kind !== 'file' &&
      // Media has no attachable payload (its src is a stream URL, not data the
      // model can read) — exclude it from "Add to chat".
      !isMediaKind(item.value.kind) &&
      (!!plainText.value || !!effectiveSrc.value),
  )
  function addToChat() {
    const it = item.value
    if (!it) return
    const att: SessionAttachment = { name: it.name, img: it.kind === 'image' }
    if (it.mime) att.mime = it.mime
    if (it.size != null) att.size = it.size
    if (it.kind === 'image' || it.kind === 'pdf') {
      const src = effectiveSrc.value
      if (src) {
        att.src = src
        if (it.kind === 'image') att.dataUrl = src // carried to the model
      }
    } else if (plainText.value) {
      att.text = plainText.value.slice(0, ATTACHMENT_TEXT_MAX)
    }
    chatAttach.request(att)
    flash(t('common.preview.addedToChat'))
  }

  // ── rename / move overlay ────────────────────────────────────────────────────
  const rename = reactive({ open: false, mode: 'rename' as RenameMode, value: '', error: '' })
  function openRename(mode: RenameMode) {
    const it = item.value
    if (!it?.path) return
    rename.mode = mode
    rename.value = it.path
    rename.error = ''
    rename.open = true
  }
  function closeRename() {
    rename.open = false
    rename.error = ''
  }
  async function submitRename() {
    const it = item.value
    if (!it?.workspaceRoot || !it.path) return
    const to = rename.value.trim()
    if (!to || to === it.path) {
      closeRename()
      return
    }
    try {
      await sc.request('fs.rename', {
        workspaceRoot: it.workspaceRoot,
        fromPath: it.path,
        toPath: to,
      })
      // Replace in place (NOT a history push) → the load watcher refetches the new
      // path; Back must not return to the old path that no longer exists.
      replaceShared({ ...it, path: to, name: to.split('/').pop() || to })
      closeRename()
      flash(t(rename.mode === 'move' ? 'common.preview.moved' : 'common.preview.renamed'))
    } catch (e) {
      rename.error = errMessage(e) || t('common.preview.renameError')
    }
  }

  // ── confirm (delete + discard-on-close) ──────────────────────────────────────
  const confirmReq = shallowRef<ConfirmRequest | null>(null)
  function cancelConfirm() {
    confirmReq.value = null
  }
  async function runConfirm() {
    const req = confirmReq.value
    confirmReq.value = null
    if (req) await req.run()
  }
  function askDelete() {
    if (!hasWorkspaceFile.value) return
    confirmReq.value = {
      titleKey: 'common.preview.deleteTitle',
      messageKey: 'common.preview.deleteConfirm',
      confirmKey: 'common.delete',
      danger: true,
      run: doDelete,
    }
  }
  async function doDelete() {
    const it = item.value
    if (!it?.workspaceRoot || !it.path) return
    try {
      await sc.request('fs.delete', { workspaceRoot: it.workspaceRoot, path: it.path })
      // Return to the parent frame (folder tree / doc) if we navigated in; otherwise
      // close the modal.
      if (!backShared()) doClose()
    } catch (e) {
      flash(errMessage(e) || t('common.preview.deleteError'), true)
    }
  }

  // ── derived view flags ───────────────────────────────────────────────────────
  // True while a workspace file's content is being fetched (drives a spinner in
  // the status placeholder, distinct from the error/tooLarge/binary states).
  const loading = computed(() => loadStatus.value === 'loading')
  const statusMessage = computed(() => {
    switch (loadStatus.value) {
      case 'loading':
        return t('sessions.preview.loading')
      case 'error':
        return t('sessions.preview.loadError')
      case 'tooLarge':
        return t('sessions.preview.tooLarge')
      case 'binary':
        return t('sessions.preview.binary')
      case 'officeError':
        return t('common.preview.officeError')
      default:
        return ''
    }
  })

  // Parsed office models ready to render (both are null until a parse lands).
  const showOfficeDoc = computed(
    () =>
      item.value?.kind === 'doc' &&
      !statusMessage.value &&
      (office.doc.value?.blocks.length ?? 0) > 0,
  )
  // A workbook keeps its grid even when the active sheet is blank, so the tab strip
  // stays reachable (the empty state is shown inside the grid instead).
  const showOfficeSheet = computed(
    () => item.value?.kind === 'sheet' && !statusMessage.value && office.sheet.value != null,
  )
  // Only a Word document can parse to nothing renderable at all.
  const officeEmpty = computed(
    () =>
      item.value?.kind === 'doc' && !statusMessage.value && office.doc.value?.blocks.length === 0,
  )

  // Monaco shows for plain text and for the raw view of markdown / html.
  const showCode = computed(() => {
    const it = item.value
    if (!it || statusMessage.value) return false
    if (it.kind === 'text') return true
    return (it.kind === 'markdown' || it.kind === 'html') && view.value === 'raw'
  })

  // HTML render view: the sandboxed iframe fills the body like an image/pdf.
  const htmlRender = computed(
    () => item.value?.kind === 'html' && view.value === 'render' && !statusMessage.value,
  )

  const bodyClass = computed(() => {
    const it = item.value
    if (!it) return {}
    return {
      flush:
        !statusMessage.value &&
        (it.kind === 'image' ||
          it.kind === 'pdf' ||
          it.kind === 'video' ||
          htmlRender.value ||
          showCode.value ||
          // The sheet grid owns its scroll (sticky headers + bottom tab strip).
          showOfficeSheet.value),
      mdrender: it.kind === 'markdown' && view.value === 'render' && !statusMessage.value,
      // Folder tree fills the body (left-aligned, own scroll) — not the centered prose layout.
      tree: it.kind === 'folder',
    }
  })

  // Header icon: clip (image) · folder (folder tree) · play (media) · table (sheet)
  // · doc (else).
  const headIcon = computed(() => {
    const k = item.value?.kind
    if (k === 'image') return 'clip'
    if (k === 'folder') return 'folder'
    if (k === 'video' || k === 'audio') return 'play'
    if (k === 'sheet') return 'table'
    return 'rules'
  })

  // The bar shows when there are view controls OR actionable workspace-file actions.
  const hasBar = computed(() => {
    const it = item.value
    if (!it || statusMessage.value) return false
    // Media plays through the native <video>/<audio> controls — the floating bar
    // has no playback controls and would just sit over them, so hide it. Only when
    // the media can't play do we show the bar (so "open externally" stays reachable).
    if (isMediaKind(it.kind)) return mediaError.value && hasWorkspaceFile.value
    return (
      ['image', 'markdown', 'html', 'text', 'doc', 'sheet'].includes(it.kind) ||
      hasWorkspaceFile.value
    )
  })

  function fmtSize(n?: number): string {
    if (n == null) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }
  const meta = computed(() => {
    if (!item.value) return ''
    return [fmtSize(item.value.size), item.value.mime].filter(Boolean).join(' · ')
  })

  // ── close (guard unsaved edits) ──────────────────────────────────────────────
  function doClose() {
    cancelEdit()
    closeShared()
    emit('close')
  }
  function close() {
    if (dirty.value) {
      confirmReq.value = {
        titleKey: 'common.preview.discardTitle',
        messageKey: 'common.preview.discardConfirm',
        confirmKey: 'common.preview.discard',
        danger: true,
        run: doClose,
      }
      return
    }
    doClose()
  }
  // Back one frame in the preview history (Back button + Esc when depth>0). Guards
  // unsaved edits with the same discard confirm as close(), so going back never
  // silently drops a draft.
  function goBack() {
    if (!canGoBack.value) return
    if (dirty.value) {
      confirmReq.value = {
        titleKey: 'common.preview.discardTitle',
        messageKey: 'common.preview.discardConfirm',
        confirmKey: 'common.preview.discard',
        danger: true,
        run: () => {
          cancelEdit()
          backShared()
        },
      }
      return
    }
    backShared()
  }

  // Reset per-item view + edit state and (re)load when the previewed item changes.
  watch(
    item,
    (it, prev) => {
      // Tear down find highlights + bar BEFORE Vue re-renders `.mdbody` for the new
      // item, so no stale <mark> or highlight state carries over.
      find.closeFind()
      // A minimize-dock restore replays the parked view + scroll; a plain open
      // resets to the default render view at the top.
      const hint = takeRestore()
      view.value = hint?.view ?? 'render'
      pendingScroll.value = hint?.scrollTop ?? null
      editMode.value = false
      draft.value = ''
      // Image → image (a gallery step) is handed to showImage, which keeps the previous
      // picture painted until the next one is decoded and then swaps src + zoom together. So
      // DON'T reset the view or drop the src here: either would show the outgoing image at
      // 100% / an empty frame for a tick — exactly the blink this avoids.
      const imageSwap = it?.kind === 'image' && prev?.kind === 'image' && !!loadedSrc.value
      if (!imageSwap) resetView()
      loadSeq++
      loadStatus.value = 'idle'
      loadedText.value = null
      if (!imageSwap) loadedSrc.value = null
      loadedLang.value = undefined
      truncated.value = false
      mediaError.value = false
      office.reset()
      for (const k of Object.keys(mdImages)) delete mdImages[k]
      // In-memory markdown (a fullscreened chat reply) has no async file load, so the
      // effectiveText watcher below may not fire for it — resolve its images here.
      if (it?.kind === 'markdown' && it.workspaceRoot && !it.path) void loadMdImages()
      // Warm the neighbours of the newly shown image so stepping stays instant.
      prefetchNeighbours()
      // Reset folder-tree state on every item change; load the root when a folder opens.
      for (const k of Object.keys(treeChildren)) delete treeChildren[k]
      treeExpanded.clear()
      treeSelected.value = null
      treeLoading.value = false
      // Images take the decode-then-swap path (no visible transition) whether their bytes come
      // from the workspace or from an in-memory attachment.
      if (it?.kind === 'image' && ((it.workspaceRoot && it.path && sc.available) || it.src)) {
        void showImage(it)
      }
      // Media streams via media:// (effectiveSrc) — never through the base64 reader.
      else if (it && it.workspaceRoot && it.path && sc.available && !isMediaKind(it.kind)) {
        void loadFromWorkspace(it)
      }
      // Office file with no workspace path (attachment / SFTP download): its bytes
      // are behind the in-memory src.
      else if (it && isOfficeKind(it.kind) && it.src) void loadOfficeFromSrc(it)
      if (it?.kind === 'folder' && it.workspaceRoot && sc.available) {
        void loadTreeDir(it.workspaceRoot, '')
      }
    },
    { immediate: true },
  )

  function onKey(e: KeyboardEvent) {
    if (!item.value) return
    // ⌘/Ctrl+F: markdown-render → AWOG find bar; Monaco → its own find widget; pdf +
    // unsupported surfaces → leave the browser default (find can't reach them anyway).
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
      if (isMarkdownRender.value) {
        e.preventDefault()
        e.stopPropagation()
        find.openFind(selectionInMdBody()) // prefill from selection when present
      } else if (showCode.value && monacoRef.value?.focusFind()) {
        e.preventDefault()
      }
      return
    }
    // ←/→ step the image gallery. Only for an image preview, and never while a dialog or
    // the find bar owns the keyboard — elsewhere the arrows belong to Monaco / the browser.
    if (
      canStepImages.value &&
      !rename.open &&
      !confirmReq.value &&
      !find.findOpen.value &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault()
      stepImage(e.key === 'ArrowRight' ? 1 : -1)
      return
    }
    if (e.key === 'Escape') {
      // Close the find bar first (shallowest layer the user just opened), then the
      // usual rename → confirm → back-stack → close chain.
      if (find.findOpen.value) find.closeFind()
      else if (rename.open) closeRename()
      else if (confirmReq.value) cancelConfirm()
      // Esc pops one history frame when we've navigated in; only closes at the root.
      else if (canGoBack.value) goBack()
      else close()
    }
  }

  return {
    // item + meta
    item,
    meta,
    statusMessage,
    loading,
    truncated,
    hasWorkspaceFile,
    // body / view
    bodyClass,
    headIcon,
    showCode,
    htmlRender,
    htmlReloadKey,
    reload,
    hasBar,
    view,
    // folder tree (kind: 'folder')
    treeRootNodes,
    treeCtrl,
    treeLoading,
    segments,
    effectiveText,
    effectiveSrc,
    monacoLang,
    // media (video/audio)
    mediaError,
    onMediaError,
    // office (docx/xlsx)
    office,
    showOfficeDoc,
    showOfficeSheet,
    officeEmpty,
    // image transform
    scale,
    imgStyle,
    rotate,
    flipH,
    flipV,
    zoomBy,
    resetView,
    fitImage,
    onImageLoad,
    imgVpRef,
    imgElRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    // image gallery (the opener's sibling set)
    canStepImages,
    galleryLabel,
    stepImage,
    // markdown outline
    outline,
    // edit/save
    isEditableFile,
    editMode,
    dirty,
    editorValue,
    editorReadOnly,
    startEdit,
    cancelEdit,
    onEditorChange,
    save,
    // file actions
    reveal,
    openLink,
    openInBrowser,
    canOpenInWindow,
    openInWindow,
    copyPath,
    copyContent,
    canAddToChat,
    addToChat,
    // rename/move
    rename,
    openRename,
    closeRename,
    submitRename,
    // confirm
    confirmReq,
    runConfirm,
    cancelConfirm,
    askDelete,
    // minimize
    canMinimize,
    minimize,
    // feedback + lifecycle
    actionMsg,
    actionErr,
    close,
    canGoBack,
    goBack,
    onKey,
    // find-in-page
    find,
    monacoRef,
  }
}

export type PreviewController = ReturnType<typeof usePreviewModal>
