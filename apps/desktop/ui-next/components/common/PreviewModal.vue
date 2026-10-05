<template>
  <!-- Teleport to body: the modal is mounted deep in the transcript subtree but
       must render as a top-level full-window overlay (escapes any ancestor
       stacking context / overflow). Single instance, driven by `item` prop or the
       shared usePreview() store. -->
  <Teleport to="body">
    <!-- In a popout window the modal IS the window: no dim backdrop, and a click on the
         (edge-to-edge) surface must not close it — the OS chrome / header ✕ own that. -->
    <div
      v-if="shownItem"
      class="ovl on pvovl data-[state=open]:animate-in data-[state=open]:fade-in-0"
      :class="{ pvwin: windowMode }"
      data-state="open"
      @click.self="onOverlayClick"
    >
      <div
        class="pvcard"
        role="dialog"
        aria-modal="true"
        :aria-label="shownItem.name"
        :style="windowMode ? undefined : { maxWidth: modalMaxW }"
      >
        <div class="pvhead">
          <Button
            v-if="canGoBack"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.back')"
            :aria-label="t('common.back')"
            @click="goBack"
          >
            <Icon name="chev-left" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Icon
            :name="headIcon"
            class="shrink-0 text-muted-foreground"
            style="width: var(--icon-md); height: var(--icon-md)"
          />
          <span class="pvname" :title="absPath">{{ headerPath }}</span>
          <Button
            v-if="hasWorkspaceFile"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.copyPath')"
            :aria-label="t('common.preview.copyPath')"
            @click="copyPath"
          >
            <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Button
            v-if="hasWorkspaceFile"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.reveal')"
            :aria-label="t('common.preview.reveal')"
            @click="reveal"
          >
            <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <span v-if="meta" class="pvmeta">{{ meta }}</span>
          <span v-if="dirty" class="pvdirty" :title="t('common.preview.unsaved')">●</span>
          <span v-if="truncated" class="pvtrunc" :title="t('common.preview.truncated')">
            {{ t('common.preview.truncated') }}
          </span>
          <Badge variant="secondary" class="ml-1 shrink-0">{{ shownItem.kind }}</Badge>
          <span class="flex-1" />
          <!-- Render|Raw segmented control — the header slot the proto gives markdown.
               html shares it too (same `view` state, same two modes). -->
          <div
            v-if="shownItem.kind === 'markdown' || shownItem.kind === 'html'"
            class="flex shrink-0 rounded-md border border-border p-0.5"
          >
            <button
              v-for="v in ['render', 'raw'] as const"
              :key="v"
              type="button"
              :class="[
                'rounded px-2 py-0.5 text-xs capitalize transition-colors',
                view === v
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ]"
              @click="view = v"
            >
              {{ t(v === 'render' ? 'common.render' : 'common.raw') }}
            </button>
          </div>
          <Button
            v-if="canCopyContent"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.copy')"
            :aria-label="t('common.copy')"
            @click="copyTextContent"
          >
            <Icon
              :name="contentCopied ? 'check' : 'copy'"
              :class="{ 'text-success': contentCopied }"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </Button>
          <Button
            v-if="!windowMode"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.modalWidth', { w: modalWLabel })"
            :aria-label="t('common.preview.modalWidth', { w: modalWLabel })"
            @click="cycleModalW"
          >
            <StretchHorizontal :size="14" />
          </Button>
          <Button
            v-if="canOpenInWindow"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.openInWindow')"
            :aria-label="t('common.preview.openInWindow')"
            @click="openInWindow"
          >
            <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Button
            v-if="canMinimize"
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.preview.minimize')"
            :aria-label="t('common.preview.minimize')"
            @click="minimize"
          >
            <Icon name="minimize" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            class="shrink-0"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </Button>
        </div>

        <FindBar
          v-if="findOpen && shownItem.kind === 'markdown' && view === 'render'"
          v-model:query="findQuery"
          v-model:match-case="findMatchCase"
          :total="findMatches.length"
          :current="findMatches.length ? findCurrentIndex + 1 : 0"
          :focus-tick="findFocusTick"
          :placeholder="t('common.preview.find.placeholder')"
          @next="nextMatch"
          @prev="prevMatch"
          @close="closeFind"
        />

        <div class="pvbody" :class="[bodyClass, { nbbody: isNotebook }]">
          <!-- status placeholder: workspace file loading / failed / too big / binary.
               Loading shows a spinner; the other states keep the file icon. -->
          <div v-if="statusMessage" class="pvempty">
            <span v-if="loading" class="pvspin" />
            <Icon v-else :name="headIcon" style="width: 32px; height: 32px" />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">{{ statusMessage }}</div>
          </div>

          <!-- image: zoom / pan / rotate / flip. The viewport + <img> are measured by
               fitImage() (natural size vs frame), hence the refs. -->
          <div
            v-else-if="shownItem.kind === 'image' && effectiveSrc"
            ref="imgVp"
            class="pvimgvp bg-muted/30"
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
          >
            <!-- .pvimgcenter keeps the picture centered even when it's bigger than the frame
                 (see its CSS). @load: fit it to the frame once its box exists (onImageLoad). -->
            <div class="pvimgcenter">
              <img
                ref="imgEl"
                :src="effectiveSrc"
                class="pvimg"
                :style="imgStyle"
                :alt="shownItem.name"
                @load="onImageLoad"
              />
            </div>
          </div>

          <!-- pdf: native embedded viewer (Chromium). -->
          <iframe
            v-else-if="shownItem.kind === 'pdf' && effectiveSrc"
            :src="effectiveSrc"
            class="pvpdf"
            :title="shownItem.name"
          />

          <!-- video: native player. effectiveSrc streams via media:// (Range-backed,
               seekable) for workspace files, or an in-memory blob for drag-drops. -->
          <div
            v-else-if="shownItem.kind === 'video' && effectiveSrc && !mediaError"
            class="pvmediavp bg-black"
          >
            <video
              :src="effectiveSrc"
              class="pvvideo"
              controls
              preload="metadata"
              playsinline
              @error="onMediaError"
            />
          </div>

          <!-- audio: native player centered on a file card. -->
          <div
            v-else-if="shownItem.kind === 'audio' && effectiveSrc && !mediaError"
            class="pvaudiovp"
          >
            <Icon name="play" style="width: 32px; height: 32px" />
            <div class="pvename">{{ shownItem.name }}</div>
            <audio
              :src="effectiveSrc"
              class="pvaudioel"
              controls
              preload="metadata"
              @error="onMediaError"
            />
          </div>

          <!-- media unavailable: unsupported codec / decode error / no source →
               keep the toolbar (workspace files can still "open externally"). -->
          <div v-else-if="shownItem.kind === 'video' || shownItem.kind === 'audio'" class="pvempty">
            <Icon name="play" style="width: 32px; height: 32px" />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">{{ t('common.preview.mediaError') }}</div>
          </div>

          <!-- markdown rendered: outline (TOC) sidebar + scrollable content.
               TOC thu gọn được thành rail 34px — nút collapse nằm trên hàng label,
               rail giữ nút mở lại; bản thân aside đã "sticky" (không cuộn theo
               .mdscroll vì là sibling flex). -->
          <template v-else-if="shownItem.kind === 'markdown' && view === 'render'">
            <aside v-if="headings.length && !outlineCollapsed" class="mdoutline bg-muted/30">
              <div class="mdohead">
                <div class="mdolabel">{{ t('common.outline') }}</div>
                <button
                  class="mdotgl"
                  :title="t('common.preview.collapseOutline')"
                  :aria-label="t('common.preview.collapseOutline')"
                  @click="outlineCollapsed = true"
                >
                  <PanelLeftClose :size="14" />
                </button>
              </div>
              <a
                v-for="h in headings"
                :key="h.id"
                class="mdoitem"
                :class="{ on: h.id === activeHeading }"
                :style="{ paddingLeft: `${(h.level - 1) * 12 + 10}px` }"
                @click="goto(h.id)"
              >
                {{ h.text }}
              </a>
            </aside>
            <button
              v-else-if="headings.length"
              class="mdorail"
              :title="t('common.preview.expandOutline')"
              :aria-label="t('common.preview.expandOutline')"
              @click="outlineCollapsed = false"
            >
              <PanelLeftOpen :size="14" />
            </button>
            <div
              ref="mdScroll"
              class="mdscroll"
              @scroll="onScroll"
              @mouseup="onPvSelect"
              @mousedown="onPvMouseDown"
            >
              <div ref="mdBody" class="mdbody" :style="{ maxWidth: mdMaxWidth }" @click="onMdClick">
                <template v-for="(seg, i) in segments" :key="i">
                  <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                  <pre
                    v-else-if="seg.type === 'widget'"
                    class="mmdstream"
                  ><code>{{ seg.code }}</code></pre>
                  <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
                  <div v-else v-html="seg.html" />
                </template>
              </div>
            </div>
          </template>

          <!-- docx → parsed block model rendered as a reading column -->
          <OfficeDocView v-else-if="showOfficeDoc && officeDoc" :doc="officeDoc" />

          <!-- xlsx → sheet grid + sheet tabs (fills the body, owns its scroll).
               Wrapper pins a definite box for the grid's height:100% chain —
               same collapse .pvcode solves with absolute positioning. -->
          <div v-else-if="showOfficeSheet" class="pvsheet">
            <OfficeSheetView :office="office" />
          </div>

          <!-- office file that parsed to nothing readable (empty doc / empty sheet) -->
          <div v-else-if="officeEmpty" class="pvempty">
            <Icon :name="headIcon" style="width: 32px; height: 32px" />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">{{ t('common.preview.officeEmpty') }}</div>
          </div>

          <!-- .ipynb → parsed cell list (markdown / highlighted code / outputs).
               NotebookView owns its own windowing so a 500-cell notebook doesn't
               render at once. -->
          <NotebookView v-else-if="isNotebook" :source="effectiveText" :truncated="truncated" />

          <!-- html render → sandboxed, opaque-origin iframe (allow-scripts but NO
               allow-same-origin: the page's JS runs isolated, can't reach app:// or
               the parent). Relative/CDN assets won't resolve — "open in browser" is
               the full-fidelity path. `:key` re-creates the frame on reload. -->
          <iframe
            v-else-if="htmlRender"
            :key="htmlReloadKey"
            class="pvhtml"
            sandbox="allow-scripts allow-popups allow-forms allow-modals"
            :srcdoc="effectiveText"
            :title="shownItem.name"
          />

          <!-- text / markdown-raw / html-raw / code → Monaco viewer/editor (§9).
               Read-only unless edit mode is on (then `change`/`save` flow to the modal). -->
          <div v-else-if="showCode" class="pvcode">
            <MonacoViewer
              ref="monacoRef"
              :value="editorValue"
              :language="monacoLang"
              :read-only="editorReadOnly"
              @change="onEditorChange"
              @save="save"
            />
          </div>

          <!-- folder: lazy file tree of the dragged working directory. Clicking a
               file repoints this modal to that file. -->
          <div v-else-if="shownItem.kind === 'folder'" class="pvfolder">
            <SessionFileTree v-if="treeRootNodes.length" :nodes="treeRootNodes" :ctrl="treeCtrl" />
            <div v-else class="pvempty">
              <span v-if="treeLoading" class="pvspin" />
              <Icon v-else name="folder" style="width: 32px; height: 32px" />
              <div class="pvename">{{ shownItem.name }}</div>
              <div class="pvehint">
                {{ treeLoading ? t('sessions.preview.loading') : t('common.preview.folderEmpty') }}
              </div>
            </div>
          </div>

          <!-- image whose data could not be read, or a non-previewable file -->
          <div v-else class="pvempty">
            <Icon
              :name="shownItem.kind === 'image' ? 'clip' : 'rules'"
              style="width: 32px; height: 32px"
            />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">
              {{
                shownItem.kind === 'image'
                  ? t('common.preview.imageUnavailable')
                  : t('common.preview.empty')
              }}
            </div>
          </div>
        </div>

        <!-- highlight prose in a rendered markdown preview → floating action bar
             (Translate + Copy MD). Gated on the view that can actually produce a
             selection, so no state left over from a previous item can surface it over
             an image/video. -->
        <div
          v-if="pvSel && shownItem.kind === 'markdown' && view === 'render'"
          class="pvselbar"
          :style="{ left: `${pvSel.x}px`, top: `${pvSel.y}px` }"
          @mousedown.prevent
        >
          <!-- Quote chỉ hiện khi bên mở là một message của session (truyền `quote`
               hook) — preview file thường không có nút này. -->
          <button v-if="shownItem.quote" class="pvseltr" @click="onPvQuote">
            <Icon name="quote" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('sessions.quote.action') }}
          </button>
          <button class="pvseltr" @click="onPvTranslate">
            <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('translate.action') }}
          </button>
          <button class="pvseltr" @click="onPvCopyMarkdown">
            <Icon
              :name="pvMdCopied ? 'check' : 'copy'"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            {{ pvMdCopied ? t('common.copied') : t('common.copyMarkdown') }}
          </button>
        </div>

        <!-- Preview trích dẫn ở góc (2026-09-15): tập trích dẫn đã ghim từ fullscreen,
             để người đọc thấy mình đã gom gì mà không phải rời màn hình. Chỉ hiện khi
             bên mở là message của session (`quote` hook) VÀ đã có ít nhất một trích dẫn. -->
        <div v-if="shownItem.quote && quoteEntries.length" class="pvquotes">
          <div class="pvquotes-h">
            <Icon name="quote" style="width: var(--icon-xs); height: var(--icon-xs)" />
            <span>{{ t('common.preview.quotes', { n: quoteEntries.length }) }}</span>
          </div>
          <div class="pvquotes-list">
            <div v-for="(q, i) in quoteEntries" :key="i" class="pvquote">
              <span class="pvquote-x">{{ q.excerpt }}</span>
              <button class="pvquote-rm" :title="t('sessions.quote.remove')" @click="q.remove()">
                <Icon name="x" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </button>
            </div>
          </div>
        </div>

        <PreviewToolbar v-if="hasBar" :ctrl="ctrl" />

        <!-- rename / move dialog -->
        <div v-if="rename.open" class="pvov" @click.self="closeRename">
          <div class="pvdlg">
            <div class="pvdlgt">
              {{
                t(
                  rename.mode === 'move'
                    ? 'common.preview.moveTitle'
                    : 'common.preview.renameTitle',
                )
              }}
            </div>
            <Input
              ref="renameInput"
              v-model="rename.value"
              spellcheck="false"
              @keydown.enter="submitRename"
              @keydown.esc.stop="closeRename"
            />
            <div v-if="rename.error" class="pvdlgerr">{{ rename.error }}</div>
            <div class="pvdlgrow">
              <button class="pvbtn" @click="closeRename">{{ t('common.cancel') }}</button>
              <button class="pvbtn primary" @click="submitRename">{{ t('common.confirm') }}</button>
            </div>
          </div>
        </div>

        <!-- confirm (delete / discard unsaved edits) -->
        <div v-if="confirmReq" class="pvov" @click.self="cancelConfirm">
          <div class="pvdlg">
            <div class="pvdlgt">{{ t(confirmReq.titleKey) }}</div>
            <div class="pvdlgm">
              {{ t(confirmReq.messageKey, { name: shownItem?.name ?? '' }) }}
            </div>
            <div class="pvdlgrow">
              <button class="pvbtn" @click="cancelConfirm">{{ t('common.cancel') }}</button>
              <button
                class="pvbtn"
                :class="confirmReq.danger ? 'danger' : 'primary'"
                @click="runConfirm"
              >
                {{ t(confirmReq.confirmKey) }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

// Shared, reusable preview modal — centered dialog (proto chrome) with a floating
// control bar (PreviewToolbar) and file actions. Decoupled from any feature type; callers map
// their object (e.g. SessionAttachment) into a PreviewRef. Mount once, drive with a
// nullable `item` prop or the shared usePreview() store. All state + IPC live in
// usePreviewModal (page-controller); this SFC is the thin template + styles.
//   image    → zoom / pan / rotate / flip
//   pdf      → embedded (Chromium) PDF viewer
//   markdown → rendered (marked + mermaid) with a Render/Raw toggle + outline
//   text/code→ Monaco viewer/editor (theme picker · edit · save)
//   actions  → reveal / open-in-browser / copy-path / rename / move / delete / add-to-chat
</script>

<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen, StretchHorizontal } from 'lucide-vue-next'
import MermaidView from '~/components/common/MermaidView.vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import OfficeDocView from '~/components/common/OfficeDocView.vue'
import OfficeSheetView from '~/components/common/OfficeSheetView.vue'
import PreviewToolbar from '~/components/common/PreviewToolbar.vue'
import FindBar from '~/components/common/FindBar.vue'
import type { PreviewRef } from '~/composables/usePreview'
import { usePreviewModal } from '~/composables/usePreviewModal'
import { useCodeBlockControls } from '~/composables/useCodeBlockControls'
import { isInternalFileHref } from '~/utils/file-links'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { rawMarkdownForSelection } from '~/utils/selection-markdown'
import { loadMonaco } from '~/utils/monaco-loader'

// Backward-compatible alias: callers (e.g. SessionDetail) import `PreviewItem`.
export type PreviewItem = PreviewRef

// `item` is optional: the app-lifetime shell mount drives the modal purely from the
// shared usePreview() store (no prop); the legacy in-component mount can still pass one.
// `windowMode` is set by pages/preview.vue — the modal then fills a dedicated OS window
// (popout) instead of overlaying the app: no dim backdrop, no minimize (the OS window
// minimizes itself), no "open in window" action, and `close` closes that window.
const props = withDefaults(defineProps<{ item?: PreviewRef | null; windowMode?: boolean }>(), {
  item: null,
  windowMode: false,
})
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const ctrl = usePreviewModal(props, emit)

// Destructure stable ref/fn members so they unwrap in the template. The resolved
// item is aliased (`shownItem`) to avoid clashing with the `item` prop.
const {
  item: shownItem,
  meta,
  truncated,
  statusMessage,
  loading,
  bodyClass,
  headIcon,
  showCode,
  htmlRender,
  htmlReloadKey,
  hasBar,
  view,
  treeRootNodes,
  treeCtrl,
  treeLoading,
  segments,
  effectiveText,
  effectiveSrc,
  monacoLang,
  mediaError,
  onMediaError,
  office,
  showOfficeDoc,
  showOfficeSheet,
  officeEmpty,
  editorValue,
  editorReadOnly,
  onEditorChange,
  save,
  imgStyle,
  onImageLoad,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  dirty,
  rename,
  closeRename,
  submitRename,
  confirmReq,
  runConfirm,
  cancelConfirm,
  canMinimize,
  minimize,
  canOpenInWindow,
  openInWindow,
  close,
  canGoBack,
  goBack,
  onKey,
  copyPath,
  copyContent,
  reveal,
  openLink,
  hasWorkspaceFile,
  monacoRef,
} = ctrl

// Backdrop click closes the overlay — but a popout has no backdrop to click past, so the
// same click there is just a click on the window's own surface.
function onOverlayClick() {
  if (!props.windowMode) close()
}
// Find-in-page (markdown-render). State lives in ctrl.find; destructure the refs so
// the template unwraps them (nested refs on a plain object don't auto-unwrap).
const {
  findOpen,
  query: findQuery,
  matchCase: findMatchCase,
  matches: findMatches,
  currentIndex: findCurrentIndex,
  focusTick: findFocusTick,
  nextMatch,
  prevMatch,
  closeFind,
} = ctrl.find
const { headings, activeHeading, goto, onScroll, mdMaxWidth } = ctrl.outline
// Unwrapped separately: `office` is a plain controller object, so its refs only
// unwrap in the template once bound as a top-level name.
const { doc: officeDoc } = ctrl.office

// Header shows the file's path (workspace-relative) instead of the bare name, so
// the user sees where the file lives. `absPath` is the absolute path — used for
// the tooltip and copied by the copy button (ctrl.copyPath). In-memory previews
// (no workspace file) fall back to the bare name with no copy button.
const headerPath = computed(() => {
  const it = shownItem.value
  if (!it) return ''
  return it.path || it.name
})
// .ipynb body: the cell list needs the full body width and its own left-aligned
// column, so it opts out of `.pvbody`'s centered prose layout. Local to the SFC —
// the controller's `bodyClass` covers the kinds it already knows about.
const isNotebook = computed(() => shownItem.value?.kind === 'notebook' && !statusMessage.value)

const absPath = computed(() => {
  const it = shownItem.value
  if (it && hasWorkspaceFile.value && it.workspaceRoot && it.path) {
    return `${it.workspaceRoot.replace(/[/\\]+$/, '')}/${it.path}`
  }
  return headerPath.value
})

// Nút copy content ở header (theo proto): chỉ hiện khi có text để copy — text/
// markdown/html/notebook qua effectiveText; docx/xlsx chiếu text từ model đã
// parse (copyContent của ctrl tự chọn nguồn đúng, kể cả TSV cho sheet).
const canCopyContent = computed(() => {
  const it = shownItem.value
  if (!it || statusMessage.value) return false
  if (it.kind === 'doc' || it.kind === 'sheet') return !!(office.doc.value || office.sheet.value)
  return !!effectiveText.value
})
// Độ rộng modal — header có nút cycle qua các preset (0 = tràn khung nhìn).
// Inline maxWidth trên .pvcard ghi đè CSS `max-width: 768px`; popout
// (windowMode) không áp vì card lúc đó chính là OS window.
const MODAL_W = [880, 1180, 0] as const
const modalWIdx = ref(1)
const modalWLabel = computed(() =>
  MODAL_W[modalWIdx.value] === 0 ? t('common.full') : `${MODAL_W[modalWIdx.value]}px`,
)
const modalMaxW = computed(() => {
  const w = MODAL_W[modalWIdx.value]
  return w === 0 ? 'calc(100vw - 40px)' : `min(${w}px, calc(100vw - 40px))`
})
function cycleModalW() {
  modalWIdx.value = (modalWIdx.value + 1) % MODAL_W.length
}

// Mục lục của markdown render — thu gọn thành rail mỏng khi cần chỗ đọc.
const outlineCollapsed = ref(false)

const contentCopied = ref(false)
let contentCopiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyTextContent() {
  await Promise.resolve(copyContent())
  contentCopied.value = true
  if (contentCopiedTimer) clearTimeout(contentCopiedTimer)
  contentCopiedTimer = setTimeout(() => {
    contentCopied.value = false
  }, 1200)
}

// Intercept clicks on links inside the rendered markdown preview. An internal
// workspace/relative path would otherwise send the SPA router to a dead route
// (404 → "Go back home" nukes the session), so open it in THIS modal instead —
// matching how a file path opens from the transcript (SessionMarkdownHtml). External
// URLs (http(s)/mailto/tel) and in-page anchors (#…) keep their default behaviour.
function onMdClick(e: MouseEvent) {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a) return
  const href = (a.getAttribute('href') ?? '').trim()
  if (!isInternalFileHref(href)) return // external URL / #anchor → default handling
  e.preventDefault()
  openLink(href)
}

// Copy button on every code block of the rendered markdown — same control the transcript
// shows. v-html owns those nodes, so the buttons are (re)attached whenever the segments
// change (utils/code-block-controls is idempotent).
const mdBody = useTemplateRef<HTMLElement>('mdBody')
useCodeBlockControls(mdBody, () => segments.value)

// Focus the rename/move input when its dialog opens.
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')
watch(
  () => rename.open,
  (open) => {
    if (open) nextTick(() => renameInput.value?.focus())
  },
)

// Warm the (heavy) Monaco bundle in the background as soon as a code-capable file
// opens, so switching into the code / raw view doesn't pay the first-load cost.
watch(
  shownItem,
  (it) => {
    if (it && (it.kind === 'text' || it.kind === 'markdown' || it.kind === 'html'))
      void loadMonaco()
  },
  { immediate: true },
)

// Selection-to-translate on the rendered markdown prose (no project → app-default
// LLM). Only the `.mdbody` render surface participates; the raw/Monaco/HTML-iframe
// views have their own selection models and are out of scope.
const translate = useSelectionTranslate()
const pvSel = ref<{ text: string; x: number; y: number } | null>(null)

function resolvePvSelection(): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const el = node instanceof HTMLElement ? node : node.parentElement
  if (!el?.closest('.mdbody')) return null
  return { text, rect: range.getBoundingClientRect() }
}
function onPvSelect(e: MouseEvent) {
  if (e.button !== 0) return
  pvMdCopied.value = false
  const r = resolvePvSelection()
  pvSel.value = r ? { text: r.text, x: r.rect.left + r.rect.width / 2, y: r.rect.top - 8 } : null
}
function onPvMouseDown(e: MouseEvent) {
  if (e.button === 0) pvSel.value = null
}
// The trigger is STATE, not a live read of the selection, and this modal is an
// app-lifetime singleton — so a button left over from one item would float above
// the next one (a stale "Translate" over a video was the symptom). Drop it whenever
// the shown item changes and at every open/close boundary; the mousedown handler
// only fires inside the markdown scroller, so it can't cover closing from the
// header or stepping through a gallery.
const { openEpoch } = usePreview()
watch([shownItem, openEpoch], () => {
  pvSel.value = null
  pvMdCopied.value = false
})
function onPvTranslate() {
  const s = pvSel.value
  if (!s) return
  const sel = window.getSelection()
  const rect =
    sel && sel.rangeCount > 0
      ? sel.getRangeAt(0).getBoundingClientRect()
      : { left: s.x, top: s.y, bottom: s.y, width: 0 }
  translate.open(s.text, rect)
  pvSel.value = null
}

// Copy MD → the RAW markdown behind the highlighted prose (utils/selection-markdown maps
// the rendered selection back onto the file's source text), so a copied excerpt keeps its
// headings/fences/tables instead of arriving flattened. The bar stays up showing "Copied";
// it clears on the next click/selection or when the shown item changes.
const pvMdCopied = ref(false)
let pvMdCopiedTimer: ReturnType<typeof setTimeout> | null = null
async function onPvCopyMarkdown() {
  const s = pvSel.value
  if (!s) return
  const md = rawMarkdownForSelection([effectiveText.value], s.text) ?? s.text
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    return // clipboard denied — leave the bar up so the user can copy manually
  }
  pvMdCopied.value = true
  if (pvMdCopiedTimer) clearTimeout(pvMdCopiedTimer)
  pvMdCopiedTimer = setTimeout(() => {
    pvMdCopied.value = false
  }, 1400)
}

// Quote → ghim đoạn bôi đen thành một trích dẫn qua hook mà bên mở truyền vào
// (SessionMessageItem). Modal không biết gì về session; nó chỉ gọi `add` rồi bỏ
// selection. Panel preview ở góc (`quoteEntries`) hiện ngay khoản vừa thêm — đó
// chính là phản hồi, nên không cần cờ "đã thêm" riêng.
function onPvQuote() {
  const s = pvSel.value
  const hook = shownItem.value?.quote
  if (!s || !hook) return
  hook.add(s.text)
  pvSel.value = null
}

// Tập trích dẫn để vẽ ở góc. `list()` đọc thẳng nguồn reactive (session.followups)
// nên computed này tự chạy lại khi thêm/xoá trích dẫn.
const quoteEntries = computed(() => shownItem.value?.quote?.list() ?? [])

// Let the shared translation popover consume ESC first (it closes itself); only
// then does ESC close the preview. Preview mounts before the popover, so this
// guard runs before the popover's own ESC handler on the common case.
function onKeyGuarded(e: KeyboardEvent) {
  if (e.key === 'Escape' && translate.active.value) return
  onKey(e)
}
onMounted(() => window.addEventListener('keydown', onKeyGuarded))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyGuarded))
</script>

<style scoped>
/* Proto chrome: centered dialog card over the shared `.ovl` scrim (p-6), not an
   edge-to-edge sheet. The scrim keeps its global look (all modals share it; the
   cute theme re-tints `.ovl` itself). */
.pvovl {
  /* `.ovl` mặc định z-100 — quá THẤP cho vùng "trên-modal": preview có thể mở
     TỪ trong board item (`.wsed-ovl` 160), peek full (`.apeek.full` 400) hay
     lượt-fullscreen (`.ftovl` 470) — dưới chúng thì modal bị đè chìm. Thang
     teleported: ftovl 470 < pvovl 480 < select-popover 490 < lbox 540 < menu
     570 < confirm 580. */
  align-items: center;
  padding: 24px;
  cursor: default;
  z-index: 480;
  /* Modal phủ từ y=0 nên header đè lên dải kéo cửa sổ `.top` (`-webkit-app-region:
     drag`). Vùng kéo tính ở tầng compositor bất kể z-index, nên mousedown lên nút
     sẽ khởi động kéo cửa sổ và nuốt @click (Copy path / Reveal / Close không bấm
     được). Modal không bao giờ cần làm tay kéo → carve toàn overlay thành no-drag. */
  -webkit-app-region: no-drag;
}
/* Popout window (pages/preview.vue): the modal IS the whole window, so drop `.ovl`'s dim
   backdrop — there is nothing behind it to dim, and the wash only muddies the content. */
.pvovl.pvwin {
  align-items: stretch;
  padding: 0;
  background: var(--background);
}
/* Card — the proto dialog shell: max-w-3xl · max-h-85vh · rounded-xl · border ·
   shadow-2xl. Auto-height: shrink-wraps short content; the 85vh cap + .pvbody's
   shrink/scroll take over past it. */
.pvcard {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 768px;
  max-height: 85vh;
  background: var(--background);
  color: var(--foreground);
  border: 1px solid var(--border);
  border-radius: var(--r-card); /* rounded-xl */
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
/* In a popout the card is again the window itself — chrome (radius/border/shadow)
   belongs to the OS frame, not the content. */
.pvwin .pvcard {
  max-width: none;
  max-height: none;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
/* Header — proto: flex items-center gap-2 px-3 py-2, hairline under. */
.pvhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--foreground);
  flex: 0 0 auto;
}
.pvname {
  /* mono-ok: workspace-relative file path being previewed */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.pvdirty {
  color: var(--warning);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  flex: 0 0 auto;
}
/* Proto meta: mono xs muted, truncates when the header runs out of room. */
.pvmeta {
  /* mono-ok: "size · mime" meta */
  font-family: var(--code);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}
.pvtrunc {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--warning);
  background: rgb(from var(--warning) r g b / 0.12);
  border: 1px solid rgb(from var(--warning) r g b / 0.3);
  border-radius: var(--r-xs); /* rounded-sm */
  padding: 2px 7px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.pvbody {
  /* flex-basis auto (not flex:1's 0%): the auto-sized card sizes itself from this
     content, so short content gives a short card; past the 85vh cap it shrinks
     again and scrolls internally. */
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* p-5 + clearance under the floating PreviewToolbar so it never covers the
     content's end. */
  padding: 20px 20px 80px;
  /* Positioning parent for the image viewport (see .pvimgvp) — it needs a definite box to
     be absolutely sized against. */
  position: relative;
}
.pvbody.flush {
  padding: 0;
  overflow: hidden;
  /* Full-bleed viewers (image/pdf/iframe/Monaco/sheet) contribute no intrinsic
     height — without a floor the shrink-wrap card would collapse to the header. */
  min-height: 60vh;
}
/* Popout: the card fills the window already — a vh floor would clip the viewer in
   a short window instead of shrinking with it. */
.pvwin .pvbody.flush {
  min-height: 0;
}
.pvbody.mdrender {
  flex-direction: row;
  align-items: stretch;
  padding: 0;
  overflow: hidden;
}
/* Notebook: full-width, left-aligned column that scrolls with the body (NotebookView
   centers its own reading measure). */
.pvbody.nbbody {
  align-items: stretch;
  padding: 20px 20px 80px;
}
/* Folder tree: fill the body, left-aligned, tree manages its own scroll. */
.pvbody.tree {
  align-items: stretch;
  padding: 0;
  overflow: hidden;
}
.pvfolder {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 12px;
}
.mdoutline {
  flex: 0 0 240px;
  overflow-y: auto;
  padding: 14px 8px;
  border-right: 1px solid var(--border);
  /* bg-muted/30 per the proto surface — alpha comes from the class on the aside,
     so the var keeps working under every theme. */
}
/* Label row carries the collapse toggle — label flexes, toggle is a 24px ghost
   icon button hugging the aside's right edge. */
.mdohead {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 8px;
}
.mdolabel {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted-foreground);
  padding: 0 4px;
}
.mdotgl {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.mdotgl:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
/* Collapsed rail — slim strip down the body's left edge; the whole strip is the
   expand button (a 24px target alone would be fiddly). */
.mdorail {
  flex: 0 0 34px;
  align-self: stretch;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.mdorail:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.mdoitem {
  display: block;
  padding: 5px 10px;
  border-radius: var(--r-xs); /* rounded-sm */
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mdoitem:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.mdoitem.on {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.mdscroll {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 20px 80px;
}
/* Floating action bar (Translate + Copy MD) next to a text selection in the rendered
   markdown (anchored to viewport coords; sits above the preview card, under the shared
   translation popover teleported to body). */
.pvselbar {
  position: fixed;
  z-index: 120;
  transform: translate(-50%, -100%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pvseltr {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  color: var(--popover-foreground);
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--r-sm); /* rounded-md */
  box-shadow: var(--shadow-md);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.pvseltr:hover {
  border-color: var(--ring);
  color: var(--primary);
}
/* Panel preview trích dẫn ở góc dưới-phải của card (position: relative). Neo trong
   card chứ không fixed để nó ở cùng lớp với nội dung modal và không đè lên UI khác
   của app. Trần chiều cao + cuộn để một tập trích dẫn dài không phủ kín màn đọc. */
.pvquotes {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 110;
  width: 300px;
  max-width: calc(100% - 28px);
  max-height: 45%;
  display: flex;
  flex-direction: column;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius); /* rounded-lg */
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
.pvquotes-h {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 11px;
  border-bottom: 1px solid var(--border);
  color: var(--muted-foreground);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.pvquotes-list {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pvquote {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--r-sm); /* rounded-md */
  background: var(--muted);
  border-left: 2px solid var(--ring);
}
.pvquote-x {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--foreground);
  /* Kẹp 3 dòng: một trích dẫn dài vẫn gọn trong thẻ, không kéo panel dài ra. */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pvquote-rm {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: var(--r-xs); /* rounded-sm */
  color: var(--muted-foreground);
  cursor: pointer;
}
.pvquote-rm:hover {
  background: rgb(from var(--destructive) r g b / 0.1);
  color: var(--destructive);
}
/* Image viewport — a fixed frame (absolute inset 0 of the body) that clips whatever the
   image does. It deliberately does NOT try to size the image: the previous attempts
   (`max-height: 100%` inside a grid) never worked, because a percentage max-height needs a
   DEFINITE area and neither a percentage-height flex item nor an `auto` grid row is one — the
   row grew to the image's natural height, so nothing was constrained AND `place-items: center`
   had nothing to center (the item filled the row), which is why a tall image sat pinned at the
   bottom of the frame. The image is now sized only by zoom (JS), never by CSS. */
.pvimgvp {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  /* Surface comes from `bg-muted/30` on the element (proto image surface). */
}
.pvimgvp:active {
  cursor: grabbing;
}
/* Centering that survives an oversized image: the wrapper is placed at the frame's centre
   and shifted back by half of ITS OWN size, so its centre coincides with the frame's centre
   whatever the image measures. Grid/flex centering can't be trusted here — an item bigger
   than a scroll container gets "safe" aligned to the start instead. Since the image's own
   scale is applied about its centre, the picture stays centred at every zoom level. */
.pvimgcenter {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  line-height: 0; /* design-token-ok: line-height: 0 removes the inline strut around the <img>. */
}
/* Natural size — so 100% means 1:1 pixels. Everything else (fit on open, zoom, pan, rotate,
   flip) rides on the transform in `imgStyle`. */
.pvimg {
  display: block;
  max-width: none;
  max-height: none;
  transform-origin: center center;
}
.pvpdf {
  position: absolute;
  inset: 0;
  /* <iframe> is a replaced element: the UA stylesheet gives it width:300px ×
     height:150px, so `inset:0` alone is over-constrained and the frame keeps
     its intrinsic size anchored top-left. Explicit 100% × 100% wins. */
  width: 100%;
  height: 100%;
  border: 0;
}
/* Video — letterboxed on a black canvas filling the body (flush). Old code sized
   the player 100% × 100% + object-fit:contain, but height:100% is unreliable
   here: .pvbody is shrink-wrap (flex-basis auto), so
   the percentage resolved to `auto` and the <video> fell back to its INTRINSIC
   size — a 1080p clip stood ~1080px tall inside an 85vh card and its native
   control bar sat below the overflow-hidden fold. The proto rule instead caps
   the ELEMENT at 62vh; max-width/max-height preserve the aspect ratio, and the
   controls always land inside the card. */
.pvmediavp {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  /* Letterbox canvas: `bg-black` on the element (proto video surface). */
}
.pvvideo {
  display: block;
  max-width: 100%;
  max-height: 62vh; /* proto max-h-[62vh] */
}
/* Audio — centered file card in the (non-flush) body. */
.pvaudiovp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: auto 0;
  padding: 56px 20px;
  color: var(--muted-foreground);
}
.pvaudioel {
  width: min(460px, 80vw);
}
/* HTML render — sandboxed iframe fills the body; white canvas (browser default) so
   a page without its own background stays readable in dark mode. */
.pvhtml {
  position: absolute;
  inset: 0;
  /* Same replaced-element trap as .pvpdf — without explicit size the frame
     renders at its UA default 300×150 instead of filling the body. */
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
/* Monaco viewer fills the body edge-to-edge (body padding reset via `flush`).
   Absolute like .pvimgvp: the shrink-wrap card leaves .pvbody's used height
   INdefinite, so a `height: 100%` chain collapses to 0 — the editor then mounts
   into a 0×0 host (and even the loading/error overlays get clipped by the body's
   overflow:hidden, which is why a failed code preview reads as a blank card). */
.pvcode {
  position: absolute;
  inset: 0;
}
/* Sheet grid — same definite-box need as .pvcode (its .osv root is height:100%). */
.pvsheet {
  position: absolute;
  inset: 0;
}
/* Opaque/status card — proto: centered column, gap-3, py-14, muted text. */
.pvempty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: auto 0;
  padding: 56px 20px;
  color: var(--muted-foreground);
}
.pvename {
  /* mono-ok: file name */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--foreground);
}
.pvehint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--muted-foreground);
}
/* Loading spinner (content fetch / folder tree load) inside the empty placeholder. */
.pvspin {
  width: 26px;
  height: 26px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: pv-spin 0.8s linear infinite;
}
@keyframes pv-spin {
  to {
    transform: rotate(360deg);
  }
}

/* rename / confirm dialogs (centered card over the scrim) */
.pvov {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
}
.pvdlg {
  width: min(440px, 90%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius); /* rounded-lg */
  box-shadow: var(--shadow-lg);
}
.pvdlgt {
  font-weight: 600;
  color: var(--foreground);
}
.pvdlgm {
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.pvdlgerr {
  color: var(--destructive);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.pvinput {
  width: 100%;
  padding: 9px 11px;
  border-radius: var(--r-sm); /* rounded-md */
  background: var(--background);
  border: 1px solid var(--input);
  color: var(--foreground);
  /* mono-ok: rename input — a file name */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}
.pvinput:focus-visible {
  border-color: var(--input);
  box-shadow: 0 0 0 1px var(--ring);
}
.pvdlgrow {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.pvbtn {
  font-weight: 500;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  padding: 7px 14px;
  border-radius: var(--r-sm); /* rounded-md */
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  background: transparent;
  cursor: pointer;
}
.pvbtn:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.pvbtn.primary {
  background: var(--primary);
  border-color: transparent;
  color: var(--primary-foreground);
}
.pvbtn.danger {
  background: var(--destructive);
  border-color: transparent;
  color: var(--destructive-foreground);
}

/* ── rendered markdown prose (v-html content → :deep) ─────────────────── */
.mdbody {
  width: 100%;
  max-width: 880px;
  line-height: var(--lh-prose);
  color: var(--foreground);
}
.mdbody :deep(h1),
.mdbody :deep(h2),
.mdbody :deep(h3) {
  font-weight: 700;
  /* design-token-ok: heading font-size is em-relative (ADR 0079 leaves `em` alone), so
     no single whole-pixel leading exists for the whole h1…h6 group. */
  line-height: 1.3;
  margin: 1.1em 0 0.5em;
}
.mdbody :deep(h1) {
  font-size: 1.6em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}
.mdbody :deep(h2) {
  font-size: 1.35em;
}
.mdbody :deep(h3) {
  font-size: 1.15em;
}
.mdbody :deep(p),
.mdbody :deep(ul),
.mdbody :deep(ol),
.mdbody :deep(blockquote),
.mdbody :deep(table) {
  margin: 0.6em 0;
}
.mdbody :deep(ul),
.mdbody :deep(ol) {
  padding-left: 1.5em;
}
/* Tailwind Preflight resets list-style to none — restore markers for prose lists. */
.mdbody :deep(ul) {
  list-style: disc;
}
.mdbody :deep(ol) {
  list-style: decimal;
}
.mdbody :deep(li) {
  margin: 0.2em 0;
}
.mdbody :deep(a) {
  color: var(--primary);
  text-decoration: underline;
}
.mdbody :deep(code) {
  /* mono-ok: inline code in the markdown render */
  font-family: var(--code);
  font-size: 0.9em;
  background: var(--muted);
  padding: 1px 5px;
  border-radius: var(--r-xs); /* rounded-sm */
}
.mdbody :deep(pre) {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--r-sm); /* rounded-md */
  padding: 12px 14px;
  overflow-x: auto;
  line-height: var(--lh-sm);
}
.mdbody :deep(pre code) {
  background: none;
  padding: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.mdbody :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--muted-foreground);
}
.mdbody :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.mdbody :deep(th),
.mdbody :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
}
.mdbody :deep(th) {
  background: var(--muted);
}
.mdbody :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 1.2em 0;
}
.mdbody :deep(img) {
  max-width: 100%;
}
/* Code token colors come from Shiki inline styles (ADR 0055). */
</style>
