<template>
  <!-- collapsed → a small round icon docked in the corner, out of the content. Cùng góc
       với nhà của thanh nên ẩn/hiện xảy ra tại chỗ. -->
  <Button
    v-if="collapsed"
    variant="outline"
    size="iconMd"
    class="absolute right-4.5 bottom-4.5 z-5 rounded-full bg-popover text-muted-foreground shadow-md [&_svg]:size-3.5"
    :title="t('common.preview.showToolbar')"
    :aria-label="t('common.preview.showToolbar')"
    @click="collapsed = false"
  >
    <SlidersHorizontal />
  </Button>

  <!-- Thanh điều khiển nổi — nhà ở góc phải-dưới của card (kéo được), tránh cột đọc ở
       giữa và control giữa của video. -->
  <div
    v-else
    ref="barRef"
    class="absolute right-4.5 bottom-4.5 z-5 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1 shadow-md select-none"
    :class="{ 'cursor-grabbing': dragging }"
    :style="barStyle"
  >
    <!-- drag handle: grab to reposition the bar so it never blocks content -->
    <Button
      variant="ghost"
      size="iconSm"
      class="touch-none"
      :class="[TB, dragging ? 'cursor-grabbing' : 'cursor-grab']"
      :title="t('common.preview.dragMove')"
      :aria-label="t('common.preview.dragMove')"
      @pointerdown="startDrag"
    >
      <GripVertical />
    </Button>
    <Separator orientation="vertical" :class="SEP" />

    <!-- transient action feedback (copied / saved / error), nổi phía trên thanh -->
    <div
      v-if="actionMsg"
      class="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md border bg-popover px-3 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md"
      :class="{ 'border-destructive/40 text-destructive': actionErr }"
    >
      {{ actionMsg }}
    </div>

    <!-- image: gallery step (siblings in the same folder) / zoom / rotate / flip -->
    <template v-if="item?.kind === 'image'">
      <template v-if="canStepImages">
        <Button
          variant="ghost"
          size="iconSm"
          :class="TB"
          :title="t('common.preview.prevImage')"
          :aria-label="t('common.preview.prevImage')"
          @click="stepImage(-1)"
        >
          <ChevronLeft />
        </Button>
        <span :class="LABEL">{{ galleryLabel }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          :class="TB"
          :title="t('common.preview.nextImage')"
          :aria-label="t('common.preview.nextImage')"
          @click="stepImage(1)"
        >
          <ChevronRight />
        </Button>
        <Separator orientation="vertical" :class="SEP" />
      </template>
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.zoomOut')"
        :aria-label="t('common.zoomOut')"
        @click="zoomBy(-0.2)"
      >
        <ZoomOut />
      </Button>
      <span :class="LABEL">{{ Math.round(scale * 100) }}%</span>
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.zoomIn')"
        :aria-label="t('common.zoomIn')"
        @click="zoomBy(0.2)"
      >
        <ZoomIn />
      </Button>
      <!-- fit ≠ 100%: the CSS already contains an oversized image at scale 1, so fit is
           what scales a SMALL image up to fill the frame (and re-centers either way). -->
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.fit')"
        :aria-label="t('common.fit')"
        @click="fitImage()"
      >
        <Scan />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.zoomReset')"
        :aria-label="t('common.zoomReset')"
        @click="resetView()"
      >
        <Maximize2 />
      </Button>
      <Separator orientation="vertical" :class="SEP" />
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.rotateLeft')"
        :aria-label="t('common.rotateLeft')"
        @click="rotate -= 90"
      >
        <RotateCcw />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.rotateRight')"
        :aria-label="t('common.rotateRight')"
        @click="rotate += 90"
      >
        <RotateCw />
      </Button>
      <Separator orientation="vertical" :class="SEP" />
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.flipH')"
        :aria-label="t('common.flipH')"
        @click="flipH = !flipH"
      >
        <FlipHorizontal2 />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.flipV')"
        :aria-label="t('common.flipV')"
        @click="flipV = !flipV"
      >
        <FlipVertical2 />
      </Button>
    </template>

    <!-- markdown: reading-width stepper only — render/raw lives in the header's
         segmented control and copy in the header copy button (proto layout). -->
    <template v-else-if="item?.kind === 'markdown'">
      <template v-if="view === 'render'">
        <Button
          variant="ghost"
          size="iconSm"
          :class="TB"
          :title="t('common.widthNarrower')"
          :aria-label="t('common.widthNarrower')"
          @click="stepWidth(-1)"
        >
          <FoldHorizontal />
        </Button>
        <span :class="LABEL">{{ widthLabel }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          :class="TB"
          :title="t('common.widthWider')"
          :aria-label="t('common.widthWider')"
          @click="stepWidth(1)"
        >
          <UnfoldHorizontal />
        </Button>
      </template>
    </template>

    <!-- theme picker — only when the Monaco viewer is showing (code / raw markdown).
         Menu mở LÊN + căn phải: nhà của thanh là góc phải, menu mọc sang phải sẽ bị mép
         card cắt. z-490: nổi trên PreviewModal (`.pvovl` 480). -->
    <template v-if="showCode">
      <Separator orientation="vertical" :class="SEP" />
      <DropdownMenu
        :open="open === 'theme'"
        @update:open="(v: boolean) => (open = v ? 'theme' : null)"
      >
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="xs"
            :class="[TB, 'w-auto gap-1 px-2 font-normal']"
            :title="t('common.preview.theme')"
          >
            <Icon name="palette" />
            <span class="text-xs tabular-nums">{{ currentThemeLabel }}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" :class="MENU">
          <template v-for="(g, gi) in themeGroups" :key="g.key">
            <template v-if="g.items.length">
              <DropdownMenuSeparator v-if="gi > 0" />
              <DropdownMenuLabel>{{ t(`common.preview.group.${g.key}`) }}</DropdownMenuLabel>
            </template>
            <DropdownMenuItem
              v-for="opt in g.items"
              :key="opt.id"
              :class="{ 'text-primary': current === opt.id }"
              @select="pickTheme(opt.id)"
            >
              <Icon v-if="current === opt.id" name="check" class="text-primary!" />
              <span v-else class="size-4 flex-none" />
              {{ opt.id === FOLLOW_APP ? t('common.preview.followApp') : opt.label }}
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <!-- reload — every workspace preview: the file (or the folder's tree) can be rewritten
         on disk under the same path, and nothing else would make the modal look again. An
         in-memory attachment has no file to re-read, so canReload hides it there. -->
    <template v-if="canReload">
      <Separator orientation="vertical" :class="SEP" />
      <Button
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.reload')"
        :aria-label="t('common.reload')"
        @click="reload()"
      >
        <Icon name="refresh" />
      </Button>
    </template>

    <!-- edit / save -->
    <template v-if="isEditableFile">
      <Separator orientation="vertical" :class="SEP" />
      <Button
        v-if="!editMode"
        variant="ghost"
        size="iconSm"
        :class="TB"
        :title="t('common.preview.edit')"
        @click="startEdit()"
      >
        <Icon name="edit" />
      </Button>
      <template v-else>
        <Button
          variant="ghost"
          size="iconSm"
          :class="[TB, { 'bg-accent text-accent-foreground': dirty }]"
          :title="t('common.preview.save')"
          @click="save()"
        >
          <Icon name="save" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          :class="TB"
          :title="t('common.cancel')"
          @click="cancelEdit()"
        >
          <Icon name="x" />
        </Button>
      </template>
    </template>

    <!-- actions menu (workspace-file ops + add-to-chat) -->
    <template v-if="hasWorkspaceFile || canAddToChat">
      <Separator orientation="vertical" :class="SEP" />
      <DropdownMenu
        :open="open === 'menu'"
        @update:open="(v: boolean) => (open = v ? 'menu' : null)"
      >
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="iconSm" :class="TB" :title="t('common.preview.actions')">
            <Icon name="dots" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" :class="MENU">
          <DropdownMenuItem v-if="canAddToChat" @select="run(addToChat)">
            <Icon name="clip" />
            {{ t('common.preview.addToChat') }}
          </DropdownMenuItem>
          <template v-if="hasWorkspaceFile">
            <DropdownMenuSeparator v-if="canAddToChat" />
            <DropdownMenuItem @select="run(reveal)">
              <Icon name="folder" />
              {{ t('common.preview.reveal') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canMutateFile" @select="run(openInBrowser)">
              <Icon name="globe" />
              {{ t('common.preview.openBrowser') }}
            </DropdownMenuItem>
            <DropdownMenuItem @select="run(copyPath)">
              <Icon name="copy" />
              {{ t('common.preview.copyPath') }}
            </DropdownMenuItem>
            <template v-if="canMutateFile">
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="run(() => openRename('rename'))">
                <Icon name="edit" />
                {{ t('common.preview.rename') }}
              </DropdownMenuItem>
              <DropdownMenuItem @select="run(() => openRename('move'))">
                <Icon name="move" />
                {{ t('common.preview.move') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:text-destructive"
                @select="run(askDelete)"
              >
                <Icon name="trash" />
                {{ t('common.delete') }}
              </DropdownMenuItem>
            </template>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </template>

    <!-- collapse the whole bar to a corner icon (persisted) -->
    <Separator orientation="vertical" :class="SEP" />
    <Button
      variant="ghost"
      size="iconSm"
      :class="TB"
      :title="t('common.preview.hideToolbar')"
      :aria-label="t('common.preview.hideToolbar')"
      @click="collapse()"
    >
      <EyeOff />
    </Button>
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
  canMutateFile,
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

// Class dùng chung: nút icon ghost (h-7, glyph 14px), nhãn số, vạch ngăn, menu nổi.
const TB = 'text-muted-foreground'
const LABEL = 'min-w-10 text-center text-xs text-muted-foreground tabular-nums'
const SEP = 'mx-0.5 h-4'
const MENU = 'z-490 max-h-[60vh] min-w-47 overflow-y-auto'

// Dropdown nào đang mở — kéo thanh / thu gọn thì đóng luôn.
const open = ref<'theme' | 'menu' | null>(null)
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
