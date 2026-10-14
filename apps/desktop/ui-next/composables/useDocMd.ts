import { computed, onMounted, ref, useTemplateRef } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { useMarkdown } from '~/composables/useMarkdown'
import { useMarkdownOutline } from '~/composables/useMarkdownOutline'
import { useSidecar } from '~/composables/useSidecar'
import { useToast } from '~/composables/useToast'
import { formatBytes } from '~/utils/format-bytes'
import { rawMarkdownForSelection } from '~/utils/selection-markdown'
import type { MonacoEditorHandle } from '~/components/editor/types'

// Page-controller của DocMd.vue — doc 'md': vbar (path + metadata + seg
// Preview/Edit), mặc định Preview (useMarkdown + SessionMarkdownHtml), Edit là
// Monaco chung một file state với DocFile nên ● dirty và ⌘S giống nhau.
export function useDocMd(doc: WorkbenchDoc) {
  const { t } = useI18n()
  const wbDocs = useWorkbenchDocs()
  const translate = useSelectionTranslate()
  const { renderMarkdown } = useMarkdown()
  const sc = useSidecar()
  const toast = useToast()
  const st = wbDocs.fileStateOf(doc)
  const rel = computed(() => wbDocs.relPathOf(doc))
  const mode = ref<'preview' | 'edit'>('preview')
  const modeOptions = computed(() => [
    { id: 'preview' as const, label: t('workbench.md.preview') },
    { id: 'edit' as const, label: t('workbench.md.edit') },
  ])

  // Số dòng theo nội dung ĐANG SỬA (kể cả unsaved) — byteSize không có cho text.
  const sizeLabel = computed(() => {
    if (st.status !== 'ok') return ''
    if (st.byteSize > 0) return formatBytes(st.byteSize)
    const lines = st.content === '' ? 0 : st.content.split('\n').length
    return t('workbench.file.lines', { n: lines })
  })

  const segments = computed(() => (st.status === 'ok' ? renderMarkdown(st.content) : []))

  // TOC + reading-width — port nguyên useMarkdownOutline từ PreviewModal
  // (rebuildDep = segments để heading collect sau khi render xong; click scroll,
  // scroll highlight active). Width stepper đổi max-width của cột đọc.
  const outlineCollapsed = ref(false)
  const { headings, activeHeading, goto, onScroll, mdMaxWidth, widthValue, stepWidth } =
    useMarkdownOutline(segments)
  const widthLabel = computed(() =>
    widthValue.value === 0 ? t('common.full') : String(widthValue.value),
  )
  const mdBody = useTemplateRef<HTMLElement>('mdBody')

  const edRef = useTemplateRef<MonacoEditorHandle>('edRef')
  let ready = false

  onMounted(() => {
    void wbDocs.ensureFile(doc).then(() => {
      if (ready && st.status === 'ok') {
        edRef.value?.openFile(doc.id, st.content, st.language ?? 'markdown')
      }
    })
  })

  function onReady() {
    ready = true
    if (st.status === 'ok') {
      edRef.value?.openFile(doc.id, st.content, st.language ?? 'markdown')
    }
  }

  // Nạp lại từ đĩa xong: preview tự render lại từ st.content; model Monaco thì
  // phải đẩy tay (setValue không phát change ⇒ không bật lại cờ dirty).
  function onReloaded() {
    edRef.value?.setValue(doc.id, st.content)
  }

  // ── Selection action bar (Copy / Copy MD / Translate) ─────────────────────
  // Selection phải nằm trong vùng preview ([data-mdview] của doc này) — ngoài
  // ra (vbar, doc khác) thì bỏ qua. Trả null khi không có gì để hành động.
  const sel = ref<{ text: string; x: number; y: number } | null>(null)
  const copied = ref<'text' | 'md' | 'path' | 'content' | 'raw' | null>(null)
  let copiedTimer: number | undefined

  function resolveSelection(): { text: string; rect: DOMRect } | null {
    const s = window.getSelection()
    const text = s?.toString().trim() ?? ''
    if (!s || s.rangeCount === 0 || !text) return null
    const range = s.getRangeAt(0)
    const node = range.commonAncestorContainer
    const el = node instanceof HTMLElement ? node : node.parentElement
    if (!el?.closest('[data-mdview]')) return null
    return { text, rect: range.getBoundingClientRect() }
  }

  // mouseup trái: bar neo vào giữa-đỉnh selection. Chuột phải cũng bắn mouseup
  // (button=2) sau contextmenu — bỏ qua để bar không nhảy về đỉnh sau khi đã
  // neo theo con trỏ.
  function onSelMouseUp(e: MouseEvent) {
    if (e.button !== 0) return
    const q = resolveSelection()
    if (!q) {
      sel.value = null
      return
    }
    copied.value = null
    sel.value = { text: q.text, x: q.rect.left + q.rect.width / 2, y: q.rect.top - 8 }
  }

  // Chuột phải: bar tại con trỏ; chỉ preventDefault khi có selection trong
  // preview — ngoài ra giữ menu mặc định của platform.
  function onSelContextMenu(e: MouseEvent) {
    const q = resolveSelection()
    if (!q) return
    e.preventDefault()
    copied.value = null
    sel.value = { text: q.text, x: e.clientX, y: e.clientY }
  }

  async function copyWithFeedback(
    kind: 'text' | 'md' | 'path' | 'content' | 'raw',
    payload: string,
  ) {
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      const el = document.createElement('textarea')
      el.value = payload
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      el.remove()
    }
    copied.value = kind
    clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copied.value = null), 1500)
  }

  function onCopyText() {
    if (!sel.value) return
    void copyWithFeedback('text', sel.value.text)
  }

  // Copy MD → raw markdown đứng sau đoạn bôi đen (map ngược từ rendered text về
  // st.content), fallback text trần khi không định vị được.
  function onCopyMarkdown() {
    if (!sel.value) return
    const md = rawMarkdownForSelection([st.content], sel.value.text) ?? sel.value.text
    void copyWithFeedback('md', md)
  }

  function onTranslate() {
    const q = sel.value
    if (!q) return
    const s = window.getSelection()
    const rect =
      s && s.rangeCount > 0
        ? s.getRangeAt(0).getBoundingClientRect()
        : { left: q.x, top: q.y, bottom: q.y, width: 0 }
    translate.open(q.text, rect, wbDocs.project.value?.id ?? '')
    sel.value = null
  }

  // ── vbar actions (port PreviewModal header) ─────────────────────────────────
  // Reveal/copy-path đi qua `sc` + `rootFor` (workspace root) — IPC main process
  // validate lại root/path, không tin renderer.
  function onReveal() {
    const r = wbDocs.rootFor(doc)
    if (!r) return
    void sc.revealPath(r, wbDocs.relPathOf(doc)).catch((e: unknown) => {
      toast.add({
        title: t('common.preview.revealError'),
        description: e instanceof Error ? e.message : String(e),
        color: 'error',
      })
    })
  }

  function onCopyPath() {
    const abs = wbDocs.absPathOf(doc)
    if (!abs) return
    void copyWithFeedback('path', abs)
  }

  // "Copy content" = text đang render (innerText của cột đọc); "copy raw" = file
  // .md nguồn. Phân biệt rõ để markdown paste vào chat/email không mang ký hiệu.
  function onCopyContent() {
    const text = mdBody.value?.innerText ?? ''
    if (text) void copyWithFeedback('content', text)
  }

  function onCopyRaw() {
    if (st.status === 'ok' && st.content) void copyWithFeedback('raw', st.content)
  }

  return {
    t,
    wbDocs,
    st,
    rel,
    mode,
    modeOptions,
    onReloaded,
    sizeLabel,
    segments,
    outlineCollapsed,
    headings,
    activeHeading,
    goto,
    onScroll,
    mdMaxWidth,
    widthLabel,
    stepWidth,
    mdBody,
    edRef,
    onReady,
    sel,
    copied,
    onSelMouseUp,
    onSelContextMenu,
    onCopyText,
    onCopyMarkdown,
    onTranslate,
    onReveal,
    onCopyPath,
    onCopyContent,
    onCopyRaw,
  }
}
