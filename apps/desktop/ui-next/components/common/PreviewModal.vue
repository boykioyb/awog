<template>
  <!-- Teleport to body: the modal is mounted deep in the transcript subtree but
       must render as a top-level full-window overlay (escapes any ancestor
       stacking context / overflow). Single instance, driven by `item` prop or the
       shared usePreview() store. -->
  <Teleport to="body">
    <div v-if="shownItem" class="ovl on pvovl" @click.self="close">
      <div class="pvcard">
        <div class="pvhead">
          <Icon :name="headIcon" style="width: 13px; height: 13px" />
          <span class="pvname" :title="absPath">{{ headerPath }}</span>
          <button
            v-if="hasWorkspaceFile"
            class="pvx pvcopy"
            :title="t('common.preview.copyPath')"
            @click="copyPath"
          >
            <Icon name="copy" style="width: 13px; height: 13px" />
          </button>
          <span v-if="dirty" class="pvdirty" :title="t('common.preview.unsaved')">●</span>
          <span v-if="meta" class="pvmeta">{{ meta }}</span>
          <span v-if="truncated" class="pvtrunc" :title="t('common.preview.truncated')">
            {{ t('common.preview.truncated') }}
          </span>
          <span style="flex: 1" />
          <button
            v-if="canMinimize"
            class="pvx"
            :title="t('common.preview.minimize')"
            @click="minimize"
          >
            <Icon name="minimize" style="width: 14px; height: 14px" />
          </button>
          <button class="pvx" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <div class="pvbody" :class="bodyClass">
          <!-- status placeholder: workspace file loading / failed / too big / binary.
               Loading shows a spinner; the other states keep the file icon. -->
          <div v-if="statusMessage" class="pvempty">
            <span v-if="loading" class="pvspin" />
            <Icon v-else :name="headIcon" style="width: 40px; height: 40px" />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">{{ statusMessage }}</div>
          </div>

          <!-- image: zoom / pan / rotate / flip -->
          <div
            v-else-if="shownItem.kind === 'image' && effectiveSrc"
            class="pvimgvp"
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
          >
            <img :src="effectiveSrc" class="pvimg" :style="imgStyle" :alt="shownItem.name" />
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
            class="pvmediavp"
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
            <Icon name="play" style="width: 40px; height: 40px" />
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
            <Icon name="play" style="width: 40px; height: 40px" />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">{{ t('common.preview.mediaError') }}</div>
          </div>

          <!-- markdown rendered: outline (TOC) sidebar + scrollable content -->
          <template v-else-if="shownItem.kind === 'markdown' && view === 'render'">
            <aside v-if="headings.length" class="mdoutline">
              <div class="mdolabel">{{ t('common.outline') }}</div>
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
            <div
              ref="mdScroll"
              class="mdscroll"
              @scroll="onScroll"
              @mouseup="onPvSelect"
              @mousedown="onPvMouseDown"
            >
              <div class="mdbody" :style="{ maxWidth: mdMaxWidth }">
                <template v-for="(seg, i) in segments" :key="i">
                  <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                  <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
                  <div v-else v-html="seg.html" />
                </template>
              </div>
            </div>
          </template>

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
              <Icon v-else name="folder" style="width: 40px; height: 40px" />
              <div class="pvename">{{ shownItem.name }}</div>
              <div class="pvehint">
                {{ treeLoading ? t('sessions.preview.loading') : t('common.preview.folderEmpty') }}
              </div>
            </div>
          </div>

          <!-- image with no data (seed mock) or non-previewable file -->
          <div v-else class="pvempty">
            <Icon
              :name="shownItem.kind === 'image' ? 'clip' : 'rules'"
              style="width: 40px; height: 40px"
            />
            <div class="pvename">{{ shownItem.name }}</div>
            <div class="pvehint">
              {{
                shownItem.kind === 'image' ? t('common.preview.mock') : t('common.preview.empty')
              }}
            </div>
          </div>
        </div>

        <!-- highlight prose in a rendered markdown preview → floating Translate button -->
        <button
          v-if="pvSel"
          class="pvseltr"
          :style="{ left: `${pvSel.x}px`, top: `${pvSel.y}px` }"
          @mousedown.prevent
          @click="onPvTranslate"
        >
          <Icon name="globe" style="width: 13px; height: 13px" />
          {{ t('translate.action') }}
        </button>

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
            <input
              ref="renameInput"
              v-model="rename.value"
              class="pvinput"
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
// Shared, reusable preview modal — full-window viewer with a floating control bar
// (PreviewToolbar) and file actions. Decoupled from any feature type; callers map
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
import MermaidView from '~/components/common/MermaidView.vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import PreviewToolbar from '~/components/common/PreviewToolbar.vue'
import type { PreviewRef } from '~/composables/usePreview'
import { usePreviewModal } from '~/composables/usePreviewModal'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { loadMonaco } from '~/utils/monaco-loader'

// Backward-compatible alias: callers (e.g. SessionDetail) import `PreviewItem`.
export type PreviewItem = PreviewRef

// `item` is optional: the app-lifetime shell mount drives the modal purely from the
// shared usePreview() store (no prop); the legacy in-component mount can still pass one.
const props = withDefaults(defineProps<{ item?: PreviewRef | null }>(), { item: null })
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
  editorValue,
  editorReadOnly,
  onEditorChange,
  save,
  imgStyle,
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
  close,
  onKey,
  copyPath,
  hasWorkspaceFile,
} = ctrl
const { headings, activeHeading, goto, onScroll, mdMaxWidth } = ctrl.outline

// Header shows the file's path (workspace-relative) instead of the bare name, so
// the user sees where the file lives. `absPath` is the absolute path — used for
// the tooltip and copied by the copy button (ctrl.copyPath). In-memory previews
// (no workspace file) fall back to the bare name with no copy button.
const headerPath = computed(() => {
  const it = shownItem.value
  if (!it) return ''
  return it.path || it.name
})
const absPath = computed(() => {
  const it = shownItem.value
  if (it && hasWorkspaceFile.value && it.workspaceRoot && it.path) {
    return `${it.workspaceRoot.replace(/[/\\]+$/, '')}/${it.path}`
  }
  return headerPath.value
})

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
  const r = resolvePvSelection()
  pvSel.value = r ? { text: r.text, x: r.rect.left + r.rect.width / 2, y: r.rect.top - 8 } : null
}
function onPvMouseDown(e: MouseEvent) {
  if (e.button === 0) pvSel.value = null
}
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
/* Full-window viewer: the scrim fills the window and the card stretches edge-to-edge. */
.pvovl {
  align-items: stretch;
  padding: 0;
  cursor: default;
}
.pvcard {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bgEl);
  overflow: hidden;
}
.pvhead {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.pvname {
  font-family: var(--code);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.pvcopy {
  flex: none;
}
.pvdirty {
  color: var(--amber);
  font-size: 12px;
  line-height: 1;
  flex: 0 0 auto;
}
.pvmeta {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  flex: 0 0 auto;
}
.pvtrunc {
  font-size: 12px;
  line-height: 1;
  color: var(--amber);
  background: var(--bgActive);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 7px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.pvx {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 6px;
  color: var(--textDim);
  cursor: pointer;
}
.pvx:hover {
  background: var(--bgHover);
  color: var(--text);
}
.pvbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26px 22px 86px;
}
.pvbody.flush {
  padding: 0;
  overflow: hidden;
}
.pvbody.mdrender {
  flex-direction: row;
  align-items: stretch;
  padding: 0;
  overflow: hidden;
}
/* Folder tree: fill the body, left-aligned, tree manages its own scroll. */
.pvbody.tree {
  align-items: stretch;
  padding: 0;
  overflow: hidden;
}
.pvfolder {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 14px 12px;
}
.mdoutline {
  flex: 0 0 240px;
  overflow-y: auto;
  padding: 14px 8px;
  border-right: 1px solid var(--border);
  background: var(--bgSubtle);
}
.mdolabel {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  padding: 0 8px 8px;
}
.mdoitem {
  display: block;
  padding: 5px 10px;
  border-radius: 6px;
  color: var(--textDim);
  font-size: 0.9231rem;
  line-height: 1.35;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mdoitem:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mdoitem.on {
  background: var(--bgActive);
  color: var(--accent);
}
.mdscroll {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26px 22px 86px;
}
/* Floating Translate button next to a text selection in the rendered markdown
   (anchored to viewport coords; sits above the preview card, under the shared
   translation popover teleported to body). */
.pvseltr {
  position: fixed;
  z-index: 120;
  transform: translate(-50%, -100%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  color: var(--text);
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.pvseltr:hover {
  border-color: var(--accentBorder);
  color: var(--accent);
}
.pvimgvp {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: grid;
  place-items: center;
  cursor: grab;
  touch-action: none;
  background: repeating-conic-gradient(var(--bgSubtle) 0% 25%, transparent 0% 50%) 50% / 22px 22px;
}
.pvimgvp:active {
  cursor: grabbing;
}
.pvimg {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
}
.pvpdf {
  width: 100%;
  height: 100%;
  border: 0;
}
/* Video — fills the body (flush), letterboxed on a black canvas. The player is
   sized to the container (100% × 100%) with object-fit:contain rather than
   max-width/height so it can't overflow the viewport (which would push the native
   control bar below the fold). display:block avoids the inline baseline gap. */
.pvmediavp {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
.pvvideo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
/* Audio — centered file card in the (non-flush) body. */
.pvaudiovp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  margin: auto 0;
  padding: 40px 20px;
  color: var(--textDim);
}
.pvaudioel {
  width: min(460px, 80vw);
}
/* HTML render — sandboxed iframe fills the body; white canvas (browser default) so
   a page without its own background stays readable in dark mode. */
.pvhtml {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}
/* Monaco viewer fills the body edge-to-edge (body padding reset via `flush`). */
.pvcode {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.pvempty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  margin: auto 0;
  padding: 40px 20px;
  color: var(--textDim);
}
.pvename {
  font-family: var(--code);
  color: var(--text);
}
.pvehint {
  color: var(--textFaint);
}
/* Loading spinner (content fetch / folder tree load) inside the empty placeholder. */
.pvspin {
  width: 26px;
  height: 26px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
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
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}
.pvdlgt {
  font-weight: 600;
  color: var(--text);
}
.pvdlgm {
  color: var(--textDim);
  line-height: 1.5;
}
.pvdlgerr {
  color: var(--danger);
  font-size: 0.9231rem;
}
.pvinput {
  width: 100%;
  padding: 9px 11px;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--code);
  outline: none;
}
.pvinput:focus {
  border-color: var(--accent);
}
.pvdlgrow {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.pvbtn {
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
}
.pvbtn:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.pvbtn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
.pvbtn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--bg);
}

/* ── rendered markdown prose (v-html content → :deep) ─────────────────── */
.mdbody {
  width: 100%;
  max-width: 880px;
  line-height: 1.7;
  color: var(--text);
}
.mdbody :deep(h1),
.mdbody :deep(h2),
.mdbody :deep(h3) {
  font-weight: 700;
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
  color: var(--accent);
  text-decoration: underline;
}
.mdbody :deep(code) {
  font-family: var(--code);
  font-size: 0.9em;
  background: var(--bgActive);
  padding: 1px 5px;
  border-radius: 4px;
}
.mdbody :deep(pre) {
  background: var(--bgSubtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  line-height: 1.6;
}
.mdbody :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.8846rem;
}
.mdbody :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--textMuted);
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
  background: var(--bgActive);
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
