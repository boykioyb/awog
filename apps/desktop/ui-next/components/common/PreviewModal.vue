<template>
  <!-- Teleport to body: the modal is mounted deep in the transcript subtree but
       must render as a top-level full-window overlay (escapes any ancestor
       stacking context / overflow). Single instance, driven by `item` prop or the
       shared usePreview() store. -->
  <Teleport to="body">
    <div v-if="item" class="ovl on pvovl" @click.self="close">
      <div class="pvcard">
        <div class="pvhead">
          <Icon
            :name="item.kind === 'image' ? 'clip' : 'rules'"
            style="width: 13px; height: 13px"
          />
          <span class="pvname">{{ item.name }}</span>
          <span v-if="meta" class="pvmeta">{{ meta }}</span>
          <span style="flex: 1" />
          <button class="pvx" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <div class="pvbody" :class="bodyClass">
          <!-- status placeholder: workspace file loading / failed / too big / binary -->
          <div v-if="statusMessage" class="pvempty">
            <Icon
              :name="item.kind === 'image' ? 'clip' : 'rules'"
              style="width: 40px; height: 40px"
            />
            <div class="pvename">{{ item.name }}</div>
            <div class="pvehint">{{ statusMessage }}</div>
          </div>

          <!-- image: zoom / pan / rotate / flip -->
          <div
            v-else-if="item.kind === 'image' && effectiveSrc"
            class="pvimgvp"
            @wheel="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
          >
            <img :src="effectiveSrc" class="pvimg" :style="imgStyle" :alt="item.name" />
          </div>

          <!-- pdf: native embedded viewer. NOTE: the Chromium embed renders the
               PDF but exposes no programmatic multi-page navigation API; pdf.js
               (a new dependency) would be required and is out of scope (no ADR). -->
          <iframe
            v-else-if="item.kind === 'pdf' && effectiveSrc"
            :src="effectiveSrc"
            class="pvpdf"
            :title="item.name"
          />

          <!-- markdown rendered: outline (TOC) sidebar + scrollable content -->
          <template v-else-if="item.kind === 'markdown' && view === 'render'">
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
            <div ref="mdScroll" class="mdscroll" @scroll="onScroll">
              <div class="mdbody" :style="{ maxWidth: mdMaxWidth }">
                <template v-for="(seg, i) in segments" :key="i">
                  <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                  <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
                  <div v-else v-html="seg.html" />
                </template>
              </div>
            </div>
          </template>

          <!-- text / markdown-raw / code → read-only Monaco viewer (§9):
               syntax highlight + line numbers. Markdown raw uses 'markdown'. -->
          <div v-else-if="showCode" class="pvcode">
            <MonacoViewer :value="effectiveText" :language="monacoLang" />
          </div>

          <!-- image with no data (seed mock) or non-previewable file -->
          <div v-else class="pvempty">
            <Icon
              :name="item.kind === 'image' ? 'clip' : 'rules'"
              style="width: 40px; height: 40px"
            />
            <div class="pvename">{{ item.name }}</div>
            <div class="pvehint">
              {{ item.kind === 'image' ? t('common.preview.mock') : t('common.preview.empty') }}
            </div>
          </div>
        </div>

        <!-- floating, horizontally-centered control bar (rich menu) -->
        <div v-if="hasBar" class="pvbar">
          <template v-if="item.kind === 'image'">
            <button class="pvtb" :title="t('common.zoomOut')" @click="zoomBy(-0.2)">−</button>
            <span class="pvz">{{ Math.round(scale * 100) }}%</span>
            <button class="pvtb" :title="t('common.zoomIn')" @click="zoomBy(0.2)">+</button>
            <button class="pvtb" :title="t('common.zoomReset')" @click="resetView">⤢</button>
            <span class="pvsep" />
            <button class="pvtb" :title="t('common.rotateLeft')" @click="rotate -= 90">⟲</button>
            <button class="pvtb" :title="t('common.rotateRight')" @click="rotate += 90">⟳</button>
            <span class="pvsep" />
            <button class="pvtb" :title="t('common.flipH')" @click="flipH = !flipH">⇆</button>
            <button class="pvtb" :title="t('common.flipV')" @click="flipV = !flipV">⇅</button>
          </template>
          <template v-else-if="item.kind === 'markdown'">
            <button
              class="pvtb"
              :class="{ on: view === 'render' }"
              :title="t('common.render')"
              @click="view = 'render'"
            >
              <Icon name="rules" style="width: 14px; height: 14px" />
            </button>
            <button
              class="pvtb"
              :class="{ on: view === 'raw' }"
              :title="t('common.raw')"
              @click="view = 'raw'"
            >
              <Icon name="commands" style="width: 14px; height: 14px" />
            </button>
            <span class="pvsep" />
            <button class="pvtb" :title="t('common.copy')" @click="copy">
              <Icon name="copy" style="width: 13px; height: 13px" />
            </button>
            <template v-if="view === 'render'">
              <span class="pvsep" />
              <button class="pvtb" :title="t('common.widthNarrower')" @click="stepWidth(-1)">
                ⇥⇤
              </button>
              <span class="pvz">{{ mdWidthLabel }}</span>
              <button class="pvtb" :title="t('common.widthWider')" @click="stepWidth(1)">⇤⇥</button>
            </template>
          </template>
          <template v-else-if="item.kind === 'text'">
            <button class="pvtb" :title="t('common.copy')" @click="copy">
              <Icon name="copy" style="width: 13px; height: 13px" />
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
// Shared, reusable preview modal — full-window viewer with a floating, centered
// control bar. Decoupled from any feature type; callers map their object (e.g.
// SessionAttachment) into a PreviewItem. Mount once, drive with a nullable `item`.
//   image    → zoom / pan / rotate / flip
//   pdf      → embedded (Chromium) PDF viewer
//   markdown → rendered (marked + mermaid) with a Render/Raw toggle
//   text     → read-only Monaco code viewer (§9)
//   file     → metadata card
</script>

<script setup lang="ts">
import MermaidView from '~/components/common/MermaidView.vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
export type PreviewItem = {
  name: string
  kind: 'image' | 'pdf' | 'markdown' | 'text' | 'file'
  src?: string // object URL for images / pdf
  text?: string // source for markdown / text
  size?: number
  mime?: string
  // Monaco language hint for the code viewer (§9). Best-effort; absent = inferred
  // from the file extension.
  language?: string
  // ── Workspace-file reference (§7 "preview from real workspace") ─────────────
  // When set AND the engine bridge is available, the modal lazily reads the file
  // from disk (fs.readFile / fs.readFileBase64, gated by assertInsideWorkspace)
  // instead of relying on in-memory `src`/`text`. Degrades gracefully otherwise.
  workspaceRoot?: string
  path?: string
}

// Sidecar fs.* result shapes (mirrors apps/desktop/sidecar/src/types/shared.ts —
// FsFileContent / FsFileBase64). Declared locally so this file owns no cross-app
// import; kept in sync by hand (small, stable surface).
type FsFileContent = {
  path: string
  content: string
  language?: string
  truncated: boolean
  isBinary: boolean
}
type FsFileBase64 = {
  path: string
  base64: string
  mimeType: string
  size: number
  truncated: boolean
}

// The modal is mounted ONCE high in the tree but can also be driven by the shared
// usePreview() store so a chip deep in the transcript can open it (§7). The local
// `item` prop (composer flow) takes priority; otherwise we fall back to the store.
const props = defineProps<{ item: PreviewItem | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { renderMarkdown } = useMarkdown()
const sc = useSidecar()
const { current: sharedItem, close: closeShared } = usePreview()

// Effective item: explicit prop wins, shared store is the fallback. Everything
// below reads `item` (computed) instead of `props.item`.
const item = computed<PreviewItem | null>(() => props.item ?? sharedItem.value)

function close() {
  // Clear whichever source drove this open: emit for the prop flow, and always
  // clear the shared store so a chip-opened preview closes too.
  closeShared()
  emit('close')
}

// Image transform — zoom/pan shared, rotate/flip local to the viewer.
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

// ── Workspace-file loading (§7) ──────────────────────────────────────────────
// When the effective item points at a real workspace file and the engine bridge
// is available, lazily read it from disk. Text/markdown/code via fs.readFile
// (utf8), images/pdf via fs.readFileBase64 (→ data: URL). Falls back silently to
// the in-memory src/text when there is no path / not in Electron.
type LoadStatus = 'idle' | 'loading' | 'error' | 'tooLarge' | 'binary'
const loadStatus = ref<LoadStatus>('idle')
const loadedText = ref<string | null>(null)
const loadedSrc = ref<string | null>(null)
const loadedLang = ref<string | undefined>(undefined)
let loadSeq = 0

const isBinaryKind = (k: PreviewItem['kind']) => k === 'image' || k === 'pdf'

async function loadFromWorkspace(it: PreviewItem) {
  const seq = ++loadSeq
  loadStatus.value = 'loading'
  loadedText.value = null
  loadedSrc.value = null
  loadedLang.value = undefined
  try {
    if (isBinaryKind(it.kind)) {
      const res = await sc.request<FsFileBase64>('fs.readFileBase64', {
        workspaceRoot: it.workspaceRoot,
        path: it.path,
      })
      if (seq !== loadSeq) return // a newer load superseded this one
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
      })
      if (seq !== loadSeq) return
      if (res.isBinary) {
        loadStatus.value = 'binary'
        return
      }
      // A truncated text read still renders (a partial code/markdown file is
      // useful, unlike a half-PDF) — show what we got.
      loadedText.value = res.content
      loadedLang.value = res.language
      loadStatus.value = 'idle'
    }
  } catch {
    if (seq !== loadSeq) return
    loadStatus.value = 'error'
  }
}

// Effective content: prefer freshly-loaded workspace data, fall back to the
// item's in-memory fields (drag-dropped files / mock data).
const effectiveText = computed(() => loadedText.value ?? item.value?.text ?? '')
const effectiveSrc = computed(() => loadedSrc.value ?? item.value?.src ?? '')
const effectiveLang = computed(() => item.value?.language ?? loadedLang.value)

// Monaco language for the code viewer. Markdown shown raw → 'markdown'; plain text
// / code → the inferred/explicit language, else best-effort from the file name.
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
const langFromName = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_LANG[ext] ?? ''
}
const monacoLang = computed(() => {
  const it = item.value
  if (!it) return ''
  if (it.kind === 'markdown') return 'markdown'
  return effectiveLang.value ?? langFromName(it.name)
})

// The Monaco code viewer renders for plain text and for markdown's raw view.
const showCode = computed(() => {
  const it = item.value
  if (!it || statusMessage.value) return false
  return it.kind === 'text' || (it.kind === 'markdown' && view.value === 'raw')
})

// Body layout: flush (no padding, full bleed) for image/pdf and the code viewer;
// `mdrender` (row layout with the outline) only for the rendered markdown view.
const bodyClass = computed(() => {
  const it = item.value
  if (!it) return {}
  return {
    flush: !statusMessage.value && (it.kind === 'image' || it.kind === 'pdf' || showCode.value),
    mdrender: it.kind === 'markdown' && view.value === 'render' && !statusMessage.value,
  }
})

// Markdown render vs raw source.
const view = ref<'render' | 'raw'>('render')
const segments = computed(() =>
  item.value?.kind === 'markdown' ? renderMarkdown(effectiveText.value) : [],
)

// Reading-column width presets for rendered markdown (px; 0 = full width). Lets the
// user widen/narrow the main content; preference persists across previewed files.
const MD_WIDTHS = [720, 880, 1100, 1400, 0]
const mdWidthIdx = ref(1)
const mdMaxWidth = computed(() => {
  const w = MD_WIDTHS[mdWidthIdx.value] ?? 880
  return w === 0 ? '100%' : `${w}px`
})
const mdWidthLabel = computed(() => {
  const w = MD_WIDTHS[mdWidthIdx.value] ?? 880
  return w === 0 ? t('common.full') : String(w)
})
function stepWidth(d: number) {
  mdWidthIdx.value = Math.min(MD_WIDTHS.length - 1, Math.max(0, mdWidthIdx.value + d))
}

// Outline (table of contents) for rendered markdown — built from the DOM headings
// after each render, so it stays in sync without touching the renderer. Clicking
// scrolls; scrolling highlights the current section.
type Heading = { id: string; text: string; level: number }
const headings = ref<Heading[]>([])
const activeHeading = ref('')
const mdScroll = useTemplateRef<HTMLElement>('mdScroll')

const ID_BAD = /[^\p{L}\p{N}\s-]/gu
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(ID_BAD, '').replace(/\s+/g, '-') || 'section'
}
function collectHeadings() {
  const root = mdScroll.value
  if (!root) {
    headings.value = []
    return
  }
  const seen = new Set<string>()
  headings.value = Array.from(root.querySelectorAll('h1, h2, h3')).map((el) => {
    let id = slugify(el.textContent || '')
    while (seen.has(id)) id = `${id}-1`
    seen.add(id)
    el.id = id
    return { id, text: el.textContent || '', level: Number(el.tagName[1]) }
  })
  activeHeading.value = headings.value[0]?.id ?? ''
}
function goto(id: string) {
  const el = mdScroll.value?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeHeading.value = id
}
function onScroll() {
  const root = mdScroll.value
  if (!root) return
  const top = root.scrollTop + 16
  let cur = headings.value[0]?.id ?? ''
  for (const h of headings.value) {
    const el = root.querySelector(`#${CSS.escape(h.id)}`) as HTMLElement | null
    if (el && el.offsetTop <= top) cur = h.id
    else break
  }
  activeHeading.value = cur
}

// Rebuild the outline after the rendered markdown lands in the DOM.
watch([segments, view, item], () => nextTick(collectHeadings))
onMounted(() => nextTick(collectHeadings))

// Reset per-item view state whenever the previewed item changes, and (re)load
// workspace content when the new item references a real file.
watch(
  item,
  (it) => {
    view.value = 'render'
    resetView()
    loadSeq++ // invalidate any in-flight load for the previous item
    loadStatus.value = 'idle'
    loadedText.value = null
    loadedSrc.value = null
    loadedLang.value = undefined
    if (it && it.workspaceRoot && it.path && sc.available) void loadFromWorkspace(it)
  },
  { immediate: true },
)

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

// Whether the file content is currently unavailable (loading / failed / too big /
// binary) so the body shows a status placeholder instead of an empty viewer.
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

// The floating bar shows only for kinds that have controls (and only once content
// is actually viewable — hide it during load / on failure).
const hasBar = computed(
  () =>
    item.value != null &&
    !statusMessage.value &&
    ['image', 'markdown', 'text'].includes(item.value.kind),
)

async function copy() {
  if (effectiveText.value) await navigator.clipboard.writeText(effectiveText.value)
}

function onKey(e: KeyboardEvent) {
  if (item.value && e.key === 'Escape') close()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
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
.pvmeta {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
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
/* Monaco code viewer fills the body edge-to-edge (the body padding is reset to 0
   for this kind via the `flush` modifier toggled in `bodyClass`). */
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

/* Floating control bar — horizontally centered near the bottom of the window. */
.pvbar {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 9px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
}
.pvtb {
  display: grid;
  place-items: center;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 7px;
  color: var(--textDim);
  cursor: pointer;
  font-size: 1em;
  line-height: 1;
}
.pvtb:hover {
  background: var(--bgHover);
  color: var(--text);
}
.pvz {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  min-width: 40px;
  text-align: center;
}
.pvsep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 3px;
}
.pvtb.on {
  background: var(--accent);
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
.mdbody :deep(pre.hljs) {
  background: var(--bgSubtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  line-height: 1.6;
}
.mdbody :deep(pre.hljs code) {
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
/* highlight.js tokens (theme-token palette; mirrors prototype .t-* colors) */
.mdbody :deep(.hljs-keyword),
.mdbody :deep(.hljs-built_in) {
  color: var(--violet);
}
.mdbody :deep(.hljs-string),
.mdbody :deep(.hljs-attr) {
  color: var(--add);
}
.mdbody :deep(.hljs-comment) {
  color: var(--textFaint);
  font-style: italic;
}
.mdbody :deep(.hljs-number),
.mdbody :deep(.hljs-literal) {
  color: var(--amber);
}
.mdbody :deep(.hljs-title),
.mdbody :deep(.hljs-title.function_),
.mdbody :deep(.hljs-section) {
  color: var(--blue);
}
</style>
