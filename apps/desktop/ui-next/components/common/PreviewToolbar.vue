<template>
  <!-- collapsed → a small round icon docked in the corner, out of the content -->
  <button
    v-if="collapsed"
    class="pvbardock"
    :title="t('common.preview.showToolbar')"
    :aria-label="t('common.preview.showToolbar')"
    @click="collapsed = false"
  >
    <SlidersHorizontal :size="16" />
  </button>

  <div v-else ref="barRef" class="pvbar" :class="{ dragging }" :style="barStyle">
    <!-- drag handle: grab to reposition the bar so it never blocks content -->
    <button
      class="pvtb grip"
      :title="t('common.preview.dragMove')"
      :aria-label="t('common.preview.dragMove')"
      @pointerdown="startDrag"
    >
      <GripVertical :size="16" />
    </button>
    <span class="pvsep" />

    <!-- transient action feedback (copied / saved / error) -->
    <div v-if="actionMsg" class="pvmsg" :class="{ err: actionErr }">{{ actionMsg }}</div>

    <!-- image: gallery step (siblings in the same folder) / zoom / rotate / flip -->
    <template v-if="item?.kind === 'image'">
      <template v-if="canStepImages">
        <button
          class="pvtb"
          :title="t('common.preview.prevImage')"
          :aria-label="t('common.preview.prevImage')"
          @click="stepImage(-1)"
        >
          <ChevronLeft :size="16" />
        </button>
        <span class="pvz">{{ galleryLabel }}</span>
        <button
          class="pvtb"
          :title="t('common.preview.nextImage')"
          :aria-label="t('common.preview.nextImage')"
          @click="stepImage(1)"
        >
          <ChevronRight :size="16" />
        </button>
        <span class="pvsep" />
      </template>
      <button
        class="pvtb"
        :title="t('common.zoomOut')"
        :aria-label="t('common.zoomOut')"
        @click="zoomBy(-0.2)"
      >
        <ZoomOut :size="16" />
      </button>
      <span class="pvz">{{ Math.round(scale * 100) }}%</span>
      <button
        class="pvtb"
        :title="t('common.zoomIn')"
        :aria-label="t('common.zoomIn')"
        @click="zoomBy(0.2)"
      >
        <ZoomIn :size="16" />
      </button>
      <!-- fit ≠ 100%: the CSS already contains an oversized image at scale 1, so fit is
           what scales a SMALL image up to fill the frame (and re-centers either way). -->
      <button
        class="pvtb"
        :title="t('common.fit')"
        :aria-label="t('common.fit')"
        @click="fitImage()"
      >
        <Scan :size="16" />
      </button>
      <button
        class="pvtb"
        :title="t('common.zoomReset')"
        :aria-label="t('common.zoomReset')"
        @click="resetView()"
      >
        <Maximize2 :size="16" />
      </button>
      <span class="pvsep" />
      <button
        class="pvtb"
        :title="t('common.rotateLeft')"
        :aria-label="t('common.rotateLeft')"
        @click="rotate -= 90"
      >
        <RotateCcw :size="16" />
      </button>
      <button
        class="pvtb"
        :title="t('common.rotateRight')"
        :aria-label="t('common.rotateRight')"
        @click="rotate += 90"
      >
        <RotateCw :size="16" />
      </button>
      <span class="pvsep" />
      <button
        class="pvtb"
        :title="t('common.flipH')"
        :aria-label="t('common.flipH')"
        @click="flipH = !flipH"
      >
        <FlipHorizontal2 :size="16" />
      </button>
      <button
        class="pvtb"
        :title="t('common.flipV')"
        :aria-label="t('common.flipV')"
        @click="flipV = !flipV"
      >
        <FlipVertical2 :size="16" />
      </button>
    </template>

    <!-- markdown: render/raw + copy + reading width -->
    <template v-else-if="item?.kind === 'markdown'">
      <button
        class="pvtb"
        :class="{ on: view === 'render' }"
        :title="t('common.render')"
        @click="view = 'render'"
      >
        <Icon name="rules" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        class="pvtb"
        :class="{ on: view === 'raw' }"
        :title="t('common.raw')"
        @click="view = 'raw'"
      >
        <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <span class="pvsep" />
      <button class="pvtb" :title="t('common.copy')" @click="copyContent()">
        <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <template v-if="view === 'render'">
        <span class="pvsep" />
        <button
          class="pvtb"
          :title="t('common.widthNarrower')"
          :aria-label="t('common.widthNarrower')"
          @click="stepWidth(-1)"
        >
          <FoldHorizontal :size="16" />
        </button>
        <span class="pvz">{{ widthLabel }}</span>
        <button
          class="pvtb"
          :title="t('common.widthWider')"
          :aria-label="t('common.widthWider')"
          @click="stepWidth(1)"
        >
          <UnfoldHorizontal :size="16" />
        </button>
      </template>
    </template>

    <!-- html: render/raw toggle + copy (reload is shared, below) -->
    <template v-else-if="item?.kind === 'html'">
      <button
        class="pvtb"
        :class="{ on: view === 'render' }"
        :title="t('common.render')"
        @click="view = 'render'"
      >
        <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        class="pvtb"
        :class="{ on: view === 'raw' }"
        :title="t('common.raw')"
        @click="view = 'raw'"
      >
        <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <span class="pvsep" />
      <button class="pvtb" :title="t('common.copy')" @click="copyContent()">
        <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </template>

    <!-- text: copy -->
    <template v-else-if="item?.kind === 'text'">
      <button class="pvtb" :title="t('common.copy')" @click="copyContent()">
        <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </template>

    <!-- docx: copy the extracted text · xlsx: copy the active sheet as TSV -->
    <template v-else-if="item?.kind === 'doc' || item?.kind === 'sheet'">
      <button
        class="pvtb"
        :title="t(item.kind === 'sheet' ? 'common.preview.copySheet' : 'common.preview.copyText')"
        @click="copyContent()"
      >
        <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </template>

    <!-- theme picker — only when the Monaco viewer is showing (code / raw markdown) -->
    <template v-if="showCode">
      <span class="pvsep" />
      <div class="pvdd">
        <button class="pvtb wide" :title="t('common.preview.theme')" @click="toggle('theme')">
          <Icon name="palette" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span class="pvz auto">{{ currentThemeLabel }}</span>
        </button>
        <!-- right-aligned: the bar's home is the right corner, so a dropdown growing
             rightwards would be clipped by the card's edge. -->
        <div v-if="open === 'theme'" class="pvmenu up right" @click.stop>
          <template v-for="g in themeGroups" :key="g.key">
            <div v-if="g.items.length" class="pvmhd">{{ t(`common.preview.group.${g.key}`) }}</div>
            <button
              v-for="opt in g.items"
              :key="opt.id"
              class="pvmi"
              :class="{ on: current === opt.id }"
              @click="pickTheme(opt.id)"
            >
              <Icon
                v-if="current === opt.id"
                name="check"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              <span v-else class="pvmidot" />
              {{ opt.id === FOLLOW_APP ? t('common.preview.followApp') : opt.label }}
            </button>
          </template>
        </div>
      </div>
    </template>

    <!-- reload — every workspace preview: the file (or the folder's tree) can be rewritten
         on disk under the same path, and nothing else would make the modal look again. An
         in-memory attachment has no file to re-read, so canReload hides it there. -->
    <template v-if="canReload">
      <span class="pvsep" />
      <button
        class="pvtb"
        :title="t('common.reload')"
        :aria-label="t('common.reload')"
        @click="reload()"
      >
        <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </template>

    <!-- edit / save -->
    <template v-if="isEditableFile">
      <span class="pvsep" />
      <button v-if="!editMode" class="pvtb" :title="t('common.preview.edit')" @click="startEdit()">
        <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <template v-else>
        <button
          class="pvtb"
          :class="{ on: dirty }"
          :title="t('common.preview.save')"
          @click="save()"
        >
          <Icon name="save" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button class="pvtb" :title="t('common.cancel')" @click="cancelEdit()">
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </template>
    </template>

    <!-- actions menu (workspace-file ops + add-to-chat) -->
    <template v-if="hasWorkspaceFile || canAddToChat">
      <span class="pvsep" />
      <div class="pvdd">
        <button class="pvtb" :title="t('common.preview.actions')" @click="toggle('menu')">
          <Icon name="dots" style="width: var(--icon-md); height: var(--icon-md)" />
        </button>
        <div v-if="open === 'menu'" class="pvmenu up right" @click.stop>
          <button v-if="canAddToChat" class="pvmi" @click="run(addToChat)">
            <Icon name="clip" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('common.preview.addToChat') }}
          </button>
          <template v-if="hasWorkspaceFile">
            <div v-if="canAddToChat" class="pvmsep" />
            <button class="pvmi" @click="run(reveal)">
              <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.preview.reveal') }}
            </button>
            <button class="pvmi" @click="run(openInBrowser)">
              <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.preview.openBrowser') }}
            </button>
            <button class="pvmi" @click="run(copyPath)">
              <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.preview.copyPath') }}
            </button>
            <div class="pvmsep" />
            <button class="pvmi" @click="run(() => openRename('rename'))">
              <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.preview.rename') }}
            </button>
            <button class="pvmi" @click="run(() => openRename('move'))">
              <Icon name="move" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.preview.move') }}
            </button>
            <div class="pvmsep" />
            <button class="pvmi danger" @click="run(askDelete)">
              <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.delete') }}
            </button>
          </template>
        </div>
      </div>
    </template>

    <!-- collapse the whole bar to a corner icon (persisted) -->
    <span class="pvsep" />
    <button
      class="pvtb"
      :title="t('common.preview.hideToolbar')"
      :aria-label="t('common.preview.hideToolbar')"
      @click="collapse()"
    >
      <EyeOff :size="16" />
    </button>

    <!-- click-away backdrop for whichever dropdown is open -->
    <div v-if="open" class="pvddback" @click="open = null" />
  </div>
</template>

<script setup lang="ts">
// Floating control bar for the PreviewModal (extracted so the modal SFC stays
// thin). Presentational: it receives the modal's controller and drives it; the
// only state it owns is which dropdown (theme/actions) is open. The theme list is
// read straight from useMonacoTheme (module-level shared state).
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  FoldHorizontal,
  GripVertical,
  Maximize2,
  RotateCcw,
  RotateCw,
  Scan,
  SlidersHorizontal,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next'
import { FOLLOW_APP, useMonacoTheme } from '~/composables/useMonacoTheme'
import type { PreviewController } from '~/composables/usePreviewModal'

const props = defineProps<{ ctrl: PreviewController }>()

const { t } = useI18n()

// Destructure stable ref/fn members so they unwrap in the template (the controller
// object is created once in the parent, so its members are stable).
const {
  item,
  showCode,
  isEditableFile,
  editMode,
  dirty,
  hasWorkspaceFile,
  canAddToChat,
  view,
  scale,
  rotate,
  flipH,
  flipV,
  zoomBy,
  resetView,
  fitImage,
  canStepImages,
  galleryLabel,
  stepImage,
  copyContent,
  canReload,
  reload,
  startEdit,
  save,
  cancelEdit,
  reveal,
  openInBrowser,
  copyPath,
  addToChat,
  openRename,
  askDelete,
  actionMsg,
  actionErr,
} = props.ctrl
const { widthValue, stepWidth } = props.ctrl.outline

const { themes, current, setTheme } = useMonacoTheme()

const open = ref<'theme' | 'menu' | null>(null)
function toggle(which: 'theme' | 'menu') {
  open.value = open.value === which ? null : which
}
// Run a menu action then close the dropdown.
function run(fn: () => void) {
  open.value = null
  fn()
}
function pickTheme(id: string) {
  void setTheme(id)
  open.value = null
}

const widthLabel = computed(() =>
  widthValue.value === 0 ? t('common.full') : String(widthValue.value),
)
const currentThemeLabel = computed(() => {
  if (current.value === FOLLOW_APP) return t('common.preview.followApp')
  return themes.find((o) => o.id === current.value)?.label ?? current.value
})
const themeGroups = [
  { key: 'app', items: themes.filter((o) => o.group === 'app') },
  { key: 'dark', items: themes.filter((o) => o.group === 'dark') },
  { key: 'light', items: themes.filter((o) => o.group === 'light') },
]

// ── Dock: draggable position + collapse-to-corner-icon ──────────────────────
// The bar HOME is the bottom-right corner — the same corner the collapsed icon sits in,
// so hide/show happens in place and the bar never lands over the reading column.
//
// Dragging the grip moves it, but the offset is stored against the RIGHT/BOTTOM edges
// (not left/top) and only for the file currently open: it resets to the corner on the
// next file and on the next app start. Previously the dragged left/top position was
// persisted in localStorage forever, so every preview re-opened with the bar wherever it
// had once been dropped — floating mid-content with nothing to anchor it, which is the
// "it flies around" behaviour. Only `collapsed` is a real preference and stays persisted.
const DOCK_KEY = 'awog.pv.toolbarDock'
// Gap from the container edges — the corner home and the clamp margin while dragging.
const EDGE = 18
const MARGIN = 8
const barRef = useTemplateRef<HTMLElement>('barRef')
const collapsed = ref(false)
// Offset from the container's right/bottom edges; null → the CSS corner home.
const pos = ref<{ right: number; bottom: number } | null>(null)
const dragging = ref(false)

const barStyle = computed(() =>
  pos.value
    ? {
        right: `${pos.value.right}px`,
        bottom: `${pos.value.bottom}px`,
        left: 'auto',
        top: 'auto',
        transform: 'none',
      }
    : {},
)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Box the bar is positioned inside (`.pvcard`, its offsetParent) — pointer coordinates
// are viewport-based, so they're converted through this rect.
function containerRect(): DOMRect {
  const parent = barRef.value?.offsetParent
  if (parent instanceof HTMLElement) return parent.getBoundingClientRect()
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight)
}

function persist() {
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify({ collapsed: collapsed.value }))
  } catch {
    // ignore quota / denied storage — dock state is a non-critical preference
  }
}

function collapse() {
  collapsed.value = true
  open.value = null
}
watch(collapsed, persist)

function startDrag(ev: PointerEvent) {
  ev.preventDefault()
  open.value = null
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  dragging.value = true
  const box = containerRect()
  const rect = barRef.value?.getBoundingClientRect()
  // Where the bar sits right now, expressed the way it will be written back.
  const startRight = rect ? box.right - rect.right : EDGE
  const startBottom = rect ? box.bottom - rect.bottom : EDGE
  const maxRight = Math.max(MARGIN, box.width - (rect?.width ?? 0) - MARGIN)
  const maxBottom = Math.max(MARGIN, box.height - (rect?.height ?? 0) - MARGIN)
  const startX = ev.clientX
  const startY = ev.clientY
  const onMove = (e: PointerEvent) => {
    // Dragging right/down DECREASES the right/bottom offsets — hence the minus.
    pos.value = {
      right: clamp(startRight - (e.clientX - startX), MARGIN, maxRight),
      bottom: clamp(startBottom - (e.clientY - startY), MARGIN, maxBottom),
    }
  }
  const onUp = () => {
    dragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

// A new file starts from the corner home again — a position dragged for one document
// carries no meaning for the next one (and is what made the bar feel misplaced).
watch(
  () => item.value?.path ?? item.value?.name ?? '',
  () => {
    pos.value = null
  },
)

// A shrinking window (or the popout being resized) must not push a dragged bar out of
// view: re-clamp against the container, keeping the offsets it already has.
function clampToContainer() {
  if (!pos.value) return
  const box = containerRect()
  const rect = barRef.value?.getBoundingClientRect()
  pos.value = {
    right: clamp(
      pos.value.right,
      MARGIN,
      Math.max(MARGIN, box.width - (rect?.width ?? 0) - MARGIN),
    ),
    bottom: clamp(
      pos.value.bottom,
      MARGIN,
      Math.max(MARGIN, box.height - (rect?.height ?? 0) - MARGIN),
    ),
  }
}

onMounted(() => {
  window.addEventListener('resize', clampToContainer)
  try {
    const raw = localStorage.getItem(DOCK_KEY)
    if (!raw) return
    // Only `collapsed` is restored. A legacy `pos` (absolute left/top from an older
    // build) is deliberately ignored so the bar comes back to its corner home.
    const saved = JSON.parse(raw) as { collapsed?: boolean }
    collapsed.value = !!saved.collapsed
  } catch {
    // ignore malformed persisted state — fall back to the default docking
  }
})
onBeforeUnmount(() => window.removeEventListener('resize', clampToContainer))
</script>

<style scoped>
/* Floating control bar — horizontally centered near the bottom of the window. */
.pvbar {
  position: absolute;
  /* Corner home — same corner as the collapsed icon (.pvbardock), so hide/show happens in
     place, and clear of the centered reading column + a video's own centered controls. */
  right: 18px;
  bottom: 18px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  user-select: none;
}
/* drag handle + active drag cursor */
.pvtb.grip {
  cursor: grab;
  touch-action: none;
}
.pvbar.dragging {
  cursor: grabbing;
}
.pvbar.dragging .pvtb.grip {
  cursor: grabbing;
}
/* collapsed: small round icon docked bottom-right, out of the reading column */
.pvbardock {
  position: absolute;
  bottom: 18px;
  right: 18px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: var(--textDim);
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.pvbardock:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* Icon button — sized to match the workspace-panel buttons (.wpib, 28px) so the
   preview controls read as the same family as the rest of the app's chrome. */
.pvtb {
  display: grid;
  grid-auto-flow: column;
  place-items: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  padding: 0 7px;
  border-radius: var(--r-sm);
  color: var(--textDim);
  cursor: pointer;
  font-size: 1em;
  line-height: 1;
}
.pvtb.wide {
  padding: 0 10px;
}
.pvtb:hover {
  background: var(--bgHover);
  color: var(--text);
}
.pvtb.on {
  background: var(--accent);
  color: var(--bg);
}
.pvz {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
  min-width: 40px;
  text-align: center;
}
.pvz.auto {
  min-width: 0;
  color: inherit;
}
.pvsep {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 3px;
}

/* dropdown (theme picker / actions) */
.pvdd {
  position: relative;
  display: flex;
}
.pvmenu {
  position: absolute;
  z-index: 7;
  min-width: 188px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 5px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
}
.pvmenu.up {
  bottom: calc(100% + 8px);
}
.pvmenu.right {
  right: 0;
}
.pvmhd {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
  padding: 6px 8px 3px;
}
.pvmi {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border-radius: var(--r-xs);
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  text-align: left;
}
.pvmi:hover {
  background: var(--bgHover);
}
.pvmi.on {
  color: var(--accent);
}
.pvmi.danger {
  color: var(--danger);
}
.pvmi.danger:hover {
  background: var(--dangerBg);
}
.pvmidot {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
}
.pvmsep {
  height: 1px;
  background: var(--border);
  margin: 4px 2px;
}
.pvddback {
  position: fixed;
  inset: 0;
  z-index: 6;
  cursor: default;
}

/* transient action feedback pill, floating above the bar */
.pvmsg {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 5px 11px;
  border-radius: var(--r-sm);
  font-size: 12px;
  line-height: 18px;
  background: var(--bgActive);
  color: var(--text);
  border: 1px solid var(--border);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
}
.pvmsg.err {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
