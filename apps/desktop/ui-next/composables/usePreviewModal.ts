import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { PreviewRef } from '~/composables/usePreview'
import { usePreview } from '~/composables/usePreview'
import { useSidecar } from '~/composables/useSidecar'
import { useI18n } from '~/composables/useI18n'
import { useMarkdown } from '~/composables/useMarkdown'
import { useZoomPan } from '~/composables/useZoomPan'
import { useMarkdownOutline } from '~/composables/useMarkdownOutline'
import { ATTACHMENT_TEXT_MAX, useChatAttach } from '~/composables/useChatAttach'
import type { SessionAttachment } from '~/composables/useSessionsData'

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

type LoadStatus = 'idle' | 'loading' | 'error' | 'tooLarge' | 'binary'
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

export function usePreviewModal(props: { item: PreviewRef | null }, emit: PreviewEmit) {
  const { t } = useI18n()
  const { renderMarkdown } = useMarkdown()
  const sc = useSidecar()
  const { current: sharedItem, close: closeShared } = usePreview()
  const chatAttach = useChatAttach()

  // Effective item: explicit prop wins, shared store is the fallback.
  const item = computed<PreviewRef | null>(() => props.item ?? sharedItem.value)

  // Only the shared store drives real workspace-file previews, so file mutations
  // (rename/delete) repoint the shared item; gate every action on this.
  const hasWorkspaceFile = computed(
    () => !!(item.value?.workspaceRoot && item.value?.path && sc.available),
  )

  // ── image transform ─────────────────────────────────────────────────────────
  const { scale, tx, ty, zoomBy, reset, onWheel, onPointerDown, onPointerMove, onPointerUp } =
    useZoomPan()
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

  // ── workspace-file loading ───────────────────────────────────────────────────
  const loadStatus = ref<LoadStatus>('idle')
  const loadedText = ref<string | null>(null)
  const loadedSrc = ref<string | null>(null)
  const loadedLang = ref<string | undefined>(undefined)
  // True when the file exceeded PREVIEW_MAX_BYTES and only its head was read.
  const truncated = ref(false)
  let loadSeq = 0

  const isBinaryKind = (k: PreviewRef['kind']) => k === 'image' || k === 'pdf'

  async function loadFromWorkspace(it: PreviewRef) {
    const seq = ++loadSeq
    loadStatus.value = 'loading'
    loadedText.value = null
    loadedSrc.value = null
    loadedLang.value = undefined
    truncated.value = false
    try {
      if (isBinaryKind(it.kind)) {
        const res = await sc.request<FsFileBase64>('fs.readFileBase64', {
          workspaceRoot: it.workspaceRoot,
          path: it.path,
        })
        if (seq !== loadSeq) return
        if (res.truncated || !res.base64) {
          loadStatus.value = 'tooLarge'
          return
        }
        loadedSrc.value = `data:${res.mimeType};base64,${res.base64}`
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
      }
    } catch {
      if (seq !== loadSeq) return
      loadStatus.value = 'error'
    }
  }
  // Effective content: prefer freshly-loaded workspace data, fall back to in-memory.
  const effectiveText = computed(() => loadedText.value ?? item.value?.text ?? '')
  const effectiveSrc = computed(() => loadedSrc.value ?? item.value?.src ?? '')
  const effectiveLang = computed(() => item.value?.language ?? loadedLang.value)

  const monacoLang = computed(() => {
    const it = item.value
    if (!it) return ''
    if (it.kind === 'markdown') return 'markdown'
    return effectiveLang.value ?? langFromName(it.name)
  })

  // ── markdown render/raw + outline ────────────────────────────────────────────
  const view = ref<'render' | 'raw'>('render')
  const segments = computed(() =>
    item.value?.kind === 'markdown' ? renderMarkdown(effectiveText.value) : [],
  )
  const outline = useMarkdownOutline(computed(() => `${view.value}:${segments.value.length}`))

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
  // Copy the visible text content (markdown/code/text), independent of file actions.
  async function copyContent() {
    if (effectiveText.value) await navigator.clipboard.writeText(effectiveText.value)
  }

  const canAddToChat = computed(
    () =>
      chatAttach.available.value &&
      item.value != null &&
      item.value.kind !== 'file' &&
      (!!effectiveText.value || !!effectiveSrc.value),
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
    } else if (effectiveText.value) {
      att.text = effectiveText.value.slice(0, ATTACHMENT_TEXT_MAX)
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
      // Repoint the shared item → the load watcher refetches the new path.
      sharedItem.value = { ...it, path: to, name: to.split('/').pop() || to }
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
      doClose()
    } catch (e) {
      flash(errMessage(e) || t('common.preview.deleteError'), true)
    }
  }

  // ── derived view flags ───────────────────────────────────────────────────────
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
      default:
        return ''
    }
  })

  // Monaco shows for plain text and for markdown's raw view.
  const showCode = computed(() => {
    const it = item.value
    if (!it || statusMessage.value) return false
    return it.kind === 'text' || (it.kind === 'markdown' && view.value === 'raw')
  })

  const bodyClass = computed(() => {
    const it = item.value
    if (!it) return {}
    return {
      flush: !statusMessage.value && (it.kind === 'image' || it.kind === 'pdf' || showCode.value),
      mdrender: it.kind === 'markdown' && view.value === 'render' && !statusMessage.value,
    }
  })

  // The bar shows when there are view controls OR actionable workspace-file actions.
  const hasBar = computed(() => {
    const it = item.value
    if (!it || statusMessage.value) return false
    return ['image', 'markdown', 'text'].includes(it.kind) || hasWorkspaceFile.value
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

  // Reset per-item view + edit state and (re)load when the previewed item changes.
  watch(
    item,
    (it) => {
      view.value = 'render'
      editMode.value = false
      draft.value = ''
      resetView()
      loadSeq++
      loadStatus.value = 'idle'
      loadedText.value = null
      loadedSrc.value = null
      loadedLang.value = undefined
      truncated.value = false
      if (it && it.workspaceRoot && it.path && sc.available) void loadFromWorkspace(it)
    },
    { immediate: true },
  )

  function onKey(e: KeyboardEvent) {
    if (!item.value) return
    if (e.key === 'Escape') {
      if (rename.open) closeRename()
      else if (confirmReq.value) cancelConfirm()
      else close()
    }
  }

  return {
    // item + meta
    item,
    meta,
    statusMessage,
    truncated,
    hasWorkspaceFile,
    // body / view
    bodyClass,
    showCode,
    hasBar,
    view,
    segments,
    effectiveText,
    effectiveSrc,
    monacoLang,
    // image transform
    scale,
    imgStyle,
    rotate,
    flipH,
    flipV,
    zoomBy,
    resetView,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
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
    openInBrowser,
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
    // feedback + lifecycle
    actionMsg,
    actionErr,
    close,
    onKey,
  }
}

export type PreviewController = ReturnType<typeof usePreviewModal>
