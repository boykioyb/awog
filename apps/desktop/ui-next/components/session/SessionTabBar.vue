<template>
  <!-- Strip tab project. Trong top bar `.top` nó hoà vào bar: KHÔNG nền, KHÔNG hairline
       riêng; nền strip là vùng kéo cửa sổ (app-shell.css), còn tab / nút / menu thì
       `no-drag` để click vẫn ăn.
       hook-ok: `.stabs` do app-shell.css đọc (`.top .stabs` = vùng kéo cửa sổ) -->
  <div class="stabs" :class="ROOT">
    <!-- Collapse / expand the session list column. Lives HERE, not in the list's own
         toolbar, because the strip stays visible when the list is hidden — a button
         inside the list could only ever collapse it. Hidden in compact mode, where the
         list is already an off-canvas drawer toggled from the top bar. List collapsed →
         the toggle reads as "on" (primary tint — a lit button explains the missing
         column better than looking like a broken layout). -->
    <Button
      v-if="!compact && !hideListToggle"
      variant="ghost"
      size="iconSm"
      :class="[STRIP_BTN, listCollapsed && 'bg-primary/10 text-primary']"
      :aria-label="listCollapsed ? t('sessions.list.expand') : t('sessions.list.collapse')"
      :title="listCollapsed ? t('sessions.list.expand') : t('sessions.list.collapse')"
      :aria-expanded="!listCollapsed"
      aria-controls="slistcol"
      @click.stop="toggleList"
    >
      <Icon name="dock-left" class="size-3.5" />
    </Button>
    <!-- Proto `<Separator class="mx-1 h-4">` giữa nút ẩn/hiện danh sách và làn tab. -->
    <Separator
      v-if="!compact && !hideListToggle"
      orientation="vertical"
      class="mx-1 h-4 flex-none"
    />
    <!-- Làn tab: proto TabsList `h-8` — làn 32px cho tab h-7 căn giữa. Không pan
         touch/pen gốc — kéo sắp xếp giữ cử chỉ ngang (cuộn chuột không ảnh hưởng). -->
    <div ref="tablistEl" :class="LANE" role="tablist" :aria-label="t('sessions.tabs.label')">
      <div
        v-for="(tab, i) in tabs"
        :key="tab.id"
        :class="tabClass(tab, i)"
        :style="{ '--stab-color': tab.color }"
        :title="tab.doneUnread && !tab.running ? t('sessions.tabs.doneUnread') : undefined"
        :data-tab-index="i"
        role="tab"
        :aria-selected="tab.active"
        :tabindex="tab.active ? 0 : -1"
        @pointerdown="onTabPointerDown($event, tab.id, i)"
        @keydown="onTabKeydown($event, tab.id, i)"
        @contextmenu.prevent="openTabCtx(tab.id, $event)"
      >
        <span
          class="relative size-2 flex-none rounded-full"
          :style="{ background: tab.color }"
          :role="tab.running ? 'img' : undefined"
          :aria-label="tab.running ? t('sessions.tabs.running') : undefined"
          :title="tab.running ? t('sessions.tabs.running') : undefined"
        />
        <span class="truncate" :class="tabNameClass(tab)">{{ tab.name }}</span>
        <!-- Running: a beam that chases the tab's border. Its own element, not a
             pseudo-element — ::before/::after on the tab are taken by the drag-reorder
             drop indicators. Sits on top of the running background tint. -->
        <span v-if="tab.running" class="stab-run" aria-hidden="true" />
        <!-- Đếm unread / cần chú ý — viên hổ phách, cùng nghĩa + dáng với badge phiên
             trên NavRail (.bdg.wait). Chỉ hiện khi > 0. -->
        <span
          v-if="tab.unread"
          class="grid h-4 min-w-4 place-items-center rounded-sm border border-warning/36 bg-warning/14 px-1 text-sm text-warning tabular-nums"
          :title="t('sessions.tabs.unread', { n: tab.unread })"
        >
          {{ tab.unread }}
        </span>
        <!-- × proto `ml-0.5 size-3.5`. Không nhảy layout: nút luôn tồn tại, chỉ hiện
             khi hover / tab đang mở (proto `opacity-0 group-hover:opacity-100`). -->
        <Button
          v-if="tab.closable"
          variant="ghost"
          size="iconSm"
          class="ml-0.5 size-3.5 rounded-sm text-muted-foreground transition-opacity group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 hover:bg-accent-foreground/10 hover:text-foreground motion-reduce:transition-none [&_svg]:size-2.5"
          :class="tab.active ? 'opacity-100' : 'opacity-0'"
          :aria-label="t('sessions.tabs.closeName', { name: tab.name })"
          :title="t('sessions.tabs.close')"
          @pointerdown.stop
          @click.stop="closeTab(tab.id)"
          @keydown.stop
        >
          <Icon name="x" />
        </Button>
      </div>
    </div>

    <Button
      variant="ghost"
      size="iconSm"
      :class="STRIP_BTN"
      :aria-label="t('sessions.tabs.addProject')"
      :title="t('sessions.tabs.addProject')"
      @click.stop="toggleAdd"
    >
      <Icon name="plus" class="size-3.5" />
    </Button>
    <Button
      v-if="tabs.length > 1"
      variant="ghost"
      size="iconSm"
      :class="STRIP_BTN"
      :aria-label="t('sessions.tabs.overflow')"
      :title="t('sessions.tabs.overflow')"
      @click.stop="toggleOverflow"
    >
      <Icon name="chev" class="size-3.5" />
    </Button>

    <!-- "+" project picker: projects not already open as a tab. A sticky search input
         filters by name (substring, case-insensitive); Enter opens the highlighted
         (first) match, Esc closes + clears. Menu tự dựng mang role=dialog +
         data-state=open để khớp OVERLAYS của trình duyệt nhúng. -->
    <div v-if="addMenu" role="dialog" data-state="open" :class="DROP" @click.stop>
      <!-- Ô tìm dính đỉnh menu (danh sách cuộn dưới nó): hạ cao 30px, bỏ bo/viền/ring
           của Input để đọc như một dòng sticky có hairline dưới. -->
      <Input
        ref="addSearchEl"
        v-model="addQuery"
        type="text"
        :placeholder="t('sessions.tabs.searchPlaceholder')"
        :aria-label="t('sessions.tabs.searchPlaceholder')"
        class="sticky top-0 z-1 h-7.5 min-h-0 w-full rounded-none border-0 border-b bg-popover px-2.5 py-1.25 text-sm shadow-none focus-visible:ring-0"
        @keydown.enter.prevent="pickFirstMatch"
        @keydown.esc.prevent="closeMenus"
      />
      <div class="py-0.5">
        <template v-if="filteredOpenable.length">
          <div
            v-for="p in filteredOpenable"
            :key="p.id"
            :class="ITEM"
            class="flex-col items-start gap-px"
            @click="pickProject(p.id)"
          >
            <span class="max-w-full truncate">{{ p.name }}</span>
            <!-- Dòng path phụ, chỉ hiện để phân biệt project trùng tên (OQ 1.a). -->
            <span v-if="p.dupePath" class="max-w-full truncate text-xs text-muted-foreground">
              {{ p.dupePath }}
            </span>
          </div>
        </template>
        <div v-else-if="openableProjects.length" class="px-3 py-2 text-muted-foreground">
          {{ t('sessions.tabs.noMatch') }}
        </div>
        <div v-else class="px-3 py-2 text-muted-foreground">
          {{ t('sessions.tabs.noProjects') }}
        </div>
      </div>
    </div>

    <!-- Overflow: jump to any open tab (when the strip scrolls). -->
    <div v-if="overflowMenu" role="dialog" data-state="open" :class="DROP" class="p-1" @click.stop>
      <div v-for="tab in tabs" :key="tab.id" :class="ITEM" @click="jumpTab(tab.id)">
        <span class="mr-0.5 size-2 flex-none rounded-full" :style="{ background: tab.color }" />
        {{ tab.name }}
        <Icon v-if="tab.active" name="check" class="ml-auto text-primary" />
      </div>
    </div>

    <div v-if="addMenu || overflowMenu" class="fixed inset-0 z-40" @click="closeMenus" />

    <!-- Right-click a tab → project-scoped actions (migrated from the old session
         list group header). Cùng khuôn menu với SessionList. -->
    <template v-if="pctx">
      <div
        class="fixed inset-0 z-60"
        @click="pctx = null"
        @contextmenu.prevent="pctx = null"
        @wheel="pctx = null"
      />
      <div
        ref="pctxMenuEl"
        role="dialog"
        data-state="open"
        class="fixed z-61 min-w-44.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md [-webkit-app-region:no-drag]"
        :style="pctxStyle"
      >
        <div :class="ITEM" @click="pNewSession">
          <Icon name="plus" />
          {{ t('sessions.pctx.newSession') }}
        </div>
        <!-- Tab management (VSCode-style) — closing tabs never deletes sessions. -->
        <template v-if="showCloseGroup">
          <Separator :class="SEP" />
          <div v-if="pctxClosable" :class="ITEM" @click="pClose">
            <Icon name="x" />
            {{ t('sessions.tabs.close') }}
          </div>
          <div v-if="othersCount" :class="ITEM" @click="pCloseOthers">
            <Icon name="x" />
            {{ t('sessions.tabs.closeOthers') }}
          </div>
          <div v-if="rightCount" :class="ITEM" @click="pCloseRight">
            <Icon name="x" />
            {{ t('sessions.tabs.closeRight') }}
          </div>
          <div v-if="showCloseAll" :class="ITEM" @click="pCloseAll">
            <Icon name="x" />
            {{ t('sessions.tabs.closeAll') }}
          </div>
        </template>
        <template v-if="pctxIsProject">
          <Separator :class="SEP" />
          <!-- Nhà mới của quick-view project (session-ui-refactor §3.4): chip project ở
               status bar đã bỏ vì nó là lần xuất hiện THỨ BA của cùng tên project
               (tab strip · header · status bar). Tab chính là nơi đúng cho nó. -->
          <div :class="ITEM" @click="pOpenProject">
            <Icon name="folder" />
            {{ t('sessions.pctx.openProject') }}
          </div>
          <div :class="ITEM" @click="pLlmDefaults">
            <Icon name="brain" />
            {{ t('sessions.pctx.llmDefaults') }}
          </div>
          <Separator :class="SEP" />
          <div class="px-2.5 pt-1 pb-1.5">
            <span class="mb-1.5 block text-xs text-muted-foreground">
              {{ t('sessions.pctx.color') }}
            </span>
            <div class="flex flex-wrap gap-1.75">
              <!-- Ô màu là dữ liệu (màu project), không phải màu theme. -->
              <span
                v-for="c in PROJECT_COLOR_PALETTE"
                :key="c.token"
                :class="[SWATCH, pctxColor === c.token && SWATCH_ON]"
                :style="{ background: c.token }"
                :title="c.label"
                @click="pSetColor(c.token)"
              />
              <!-- Custom color: a <label> wrapping a hidden native color input so
                   clicking the swatch opens the OS color picker anchored right here.
                   When a custom hex is active the swatch shows it; otherwise a
                   rainbow + palette glyph hints "pick your own". -->
              <label
                class="swatch-rainbow relative overflow-hidden text-foreground"
                :class="[SWATCH, pctxCustom && SWATCH_ON]"
                :style="pctxCustom ? { background: pctxColor } : undefined"
                :title="t('sessions.pctx.colorCustom')"
              >
                <Icon v-if="!pctxCustom" name="palette" class="size-3" />
                <!-- raw-ok: input color trong suốt phủ kín ô để mở bảng màu của OS ngay tại đây -->
                <input
                  type="color"
                  class="absolute inset-0 m-0 size-full cursor-pointer border-0 p-0 opacity-0"
                  :value="customColorValue"
                  @input="onCustomColorInput"
                />
              </label>
              <span
                class="bg-transparent"
                :class="[SWATCH, pctxColor === PROJECT_COLOR_DEFAULT && SWATCH_ON]"
                :title="t('sessions.pctx.colorClear')"
                @click="pSetColor(null)"
              >
                <Icon name="x" class="size-3" />
              </span>
            </div>
          </div>
        </template>
        <Separator :class="SEP" />
        <div :class="ITEM" @click="pSelectAll">
          <Icon name="check" />
          {{ t('sessions.pctx.selectAll', { n: pctxCount }) }}
        </div>
        <div :class="ITEM" @click="pDeselectAll">
          <Icon name="x" />
          {{ t('sessions.pctx.deselectAll') }}
        </div>
        <div v-if="pctxPath" :class="ITEM" @click="pOpenFinder">
          <Icon name="folder" />
          {{ t('sessions.pctx.openFinder') }}
        </div>
        <Separator :class="SEP" />
        <div
          :class="ITEM"
          class="text-destructive hover:bg-destructive/14 hover:text-destructive"
          @click="pDeleteAll"
        >
          <Icon name="trash" />
          {{ t('sessions.pctx.deleteAll', { n: pctxCount }) }}
        </div>
      </div>
    </template>

    <!-- Per-project "Session LLM defaults" — opened from the tab context menu. -->
    <ProjectLlmDefaultsModal
      :open="!!llmModalProject"
      :project="llmModalProject"
      @saved="llmModalProject = null"
      @cancel="llmModalProject = null"
    />
  </div>
</template>

<script setup lang="ts">
// VSCode-style project tab strip for the Sessions screen. Each tab = an OPENED
// project ('' = the Default tab for unassigned sessions); selecting a tab filters
// the session list (store.tabSessions) and restores that tab's last-viewed session.
// Tab state + open/close/activate logic live in the sessions store; this component
// is presentation + the project context menu (migrated from the old list group
// header). SoC: state via the store, no IPC except open-in-Finder.
import type { Project } from '~/types'
import ProjectLlmDefaultsModal from '~/components/project/ProjectLlmDefaultsModal.vue'
import {
  isCustomColor,
  PROJECT_COLOR_DEFAULT,
  PROJECT_COLOR_PALETTE,
  useProjectColors,
} from '~/composables/useProjectColors'
import { placeMenu } from '~/utils/context-menu'
import { isBoardSession } from '~/composables/useSessionsData'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const { tabs, openableProjects, projectPath, setActiveTab, closeTab } = useSessionTabs()

// ── Class của strip (thay skin `.stab*` cũ) ──
// Không tự gắn flex-none/flex-1: chỗ đặt quyết định (top bar cần co trong flex-1 để
// không đẩy chuông + nút bên phải ra ngoài; trang /sessions cần flex-none).
const ROOT = 'relative flex h-full min-w-0 items-center gap-1 p-0'
// Làn tab cuộn ngang, ẩn thanh cuộn.
const LANE =
  'flex h-8 min-w-0 flex-1 touch-none items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
// Nút ghost của strip (ẩn/hiện danh sách · + · ▾) — no-drag để click được trong top bar.
const STRIP_BTN = 'flex-none [-webkit-app-region:no-drag]'
// Menu thả dưới strip (chọn project / nhảy tab): neo absolute, trên thân trang.
const DROP =
  'absolute top-full right-2 z-50 max-h-[60vh] min-w-55 overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-md [-webkit-app-region:no-drag]'
const ITEM =
  'flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-3.5'
const SEP = 'mx-1.5 my-1 w-auto'
const SWATCH =
  'grid size-4.25 cursor-pointer place-items-center rounded-full text-muted-foreground ring-1 ring-border transition-transform hover:scale-112 motion-reduce:transition-none'
const SWATCH_ON = 'ring-2 ring-primary ring-offset-2 ring-offset-popover'

type StripTab = (typeof tabs.value)[number]

// Một tab: viên proto — h-7, bo md, chữ sm. Phẳng mặc định; tab đang mở = wash trung
// tính (idiom `data-[state=active]:bg-accent`), hover chỉ áp lên tab chưa mở.
// Hai trạng thái sống, nói bằng nền + viền như phần còn lại của app:
//   running     → nền nhuộm MÀU PROJECT + một tia chạy quanh viền (`.stab-run`) — nhìn
//                 qua cả strip là thấy project nào đang chạy nền. Tab đang mở giữ nền
//                 của nó, chỉ còn tia nói "đang chạy".
//   done-unread → viên hổ phách tĩnh: có kết quả trong lúc bạn ở chỗ khác (hổ phách là
//                 màu "cần mắt bạn" của app). Không áp lên tab đang mở.
// Đang kéo sắp xếp: tab nhấc lên mờ đi để vạch chèn (accent 2px trước/sau tab) đọc được.
function tabClass(tab: StripTab, i: number): unknown[] {
  return [
    'group/tab relative flex h-7 max-w-50 flex-none cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-sm select-none touch-none [-webkit-app-region:no-drag] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
    // Mỗi trạng thái tự đặt TRỌN màu viền + nền của nó (không để class gốc mang
    // border-transparent rồi nhánh sau đè): thẻ <div> không qua tailwind-merge, hai
    // utility cùng nhóm thì cái đứng sau trong CSS thắng chứ không phải cái điều kiện.
    tabState(tab),
    dragId.value === tab.id && 'opacity-40',
    dropIndex.value === i && DROP_BEFORE,
    dropIndex.value === tabs.value.length && i === tabs.value.length - 1 && DROP_AFTER,
  ]
}
function tabState(tab: StripTab): string {
  // Tab đang mở = accent-tint (luật "đang chọn" — cùng kiểu mục active của sidebar);
  // bg-accent trung tính gần trùng nền bg-sidebar của title bar nên không nhìn ra.
  if (tab.active) return 'border-selected-border bg-selected text-foreground'
  if (tab.running)
    return 'border-[color-mix(in_srgb,var(--stab-color,var(--primary))_30%,transparent)] bg-[color-mix(in_srgb,var(--stab-color,var(--primary))_11%,transparent)] text-muted-foreground hover:text-foreground'
  if (tab.doneUnread)
    return 'border-warning/34 bg-warning/12 text-muted-foreground hover:text-foreground'
  return 'border-transparent text-muted-foreground hover:bg-accent/55 hover:text-foreground'
}
const DROP_BEFORE =
  "before:absolute before:inset-y-1 before:-left-0.5 before:z-1 before:w-0.5 before:rounded-sm before:bg-primary before:content-['']"
const DROP_AFTER =
  "after:absolute after:inset-y-1 after:-right-0.5 after:z-1 after:w-0.5 after:rounded-sm after:bg-primary after:content-['']"
function tabNameClass(tab: StripTab): string {
  if (tab.doneUnread && !tab.active && !tab.running) return 'font-semibold text-warning'
  return tab.active ? 'font-semibold' : 'font-medium'
}
withDefaults(defineProps<{ hideListToggle?: boolean }>(), { hideListToggle: false })
const store = useSessionsStore()
const projectModal = useProjectModal()
const { compact } = useResponsiveShell()
const { collapsed: listCollapsed, toggle: toggleList } = useSessionListCollapse()
const projectsStore = useProjectsStore()
const { colorOf, setColor } = useProjectColors()
const sc = useSidecar()
const { confirm } = useConfirm()

// ── Keyboard nav (roving tabindex, desktop keyboard-first) ──────────────────────
// Active tab is the only tab in the page tab order; Enter/Space activates the
// focused tab and Arrow keys move (selection follows focus, like editor tabs).
const tablistEl = useTemplateRef<HTMLElement>('tablistEl')
function focusTab(i: number) {
  const els = tablistEl.value?.querySelectorAll<HTMLElement>('[role="tab"]')
  els?.[i]?.focus()
}
function onTabKeydown(e: KeyboardEvent, id: string, index: number) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    setActiveTab(id)
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    const n = tabs.value.length
    if (!n) return
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
    setActiveTab(tabs.value[next]!.id)
    nextTick(() => focusTab(next))
  }
}

// ── Drag-to-reorder tabs (native pointer, no dependency) ────────────────────────
// Mirrors the composer's `onResize` pattern: pointerdown → setPointerCapture →
// pointermove/up. A click (movement under DRAG_THRESHOLD) still just activates the
// tab; crossing the threshold begins a reorder drag with an insertion indicator and
// edge auto-scroll. Reorder mutates order only via the store action (SoC) — the
// component never touches `openProjectTabs` directly.
const DRAG_THRESHOLD = 5 // px of movement before a press becomes a drag (vs a click)
const EDGE_ZONE = 32 // px from a strip edge that triggers auto-scroll while dragging
const EDGE_SPEED = 12 // px per frame auto-scroll step
const dragId = ref<string | null>(null) // tab currently being dragged (null = none)
const dropIndex = ref<number | null>(null) // insertion slot (0..tabs.length) or null
let dragStartX = 0
let dragStarted = false
let dragPointerId = 0
let dragEl: HTMLElement | null = null
let edgeRaf = 0
let edgeDir = 0 // -1 scroll left, +1 scroll right, 0 none
let lastClientX = 0 // most recent pointer x (drives dropIndex while edge-scrolling)

function tabRects(): { index: number; left: number; right: number }[] {
  const els = tablistEl.value?.querySelectorAll<HTMLElement>('[role="tab"]')
  if (!els) return []
  return Array.from(els).map((el) => {
    const r = el.getBoundingClientRect()
    return { index: Number(el.dataset.tabIndex), left: r.left, right: r.right }
  })
}
// Insertion slot for a pointer x: before the first tab whose midpoint is past x, else
// at the end.
function computeDropIndex(clientX: number): number {
  const rects = tabRects()
  for (const r of rects) {
    if (clientX < (r.left + r.right) / 2) return r.index
  }
  return tabs.value.length
}
function stepEdgeScroll() {
  const el = tablistEl.value
  if (!el || edgeDir === 0) {
    edgeRaf = 0
    return
  }
  el.scrollLeft += edgeDir * EDGE_SPEED
  // Tabs slide under a stationary pointer while the strip scrolls, so the drop slot
  // changes even with no pointermove — recompute it against the last known x each
  // frame so the insertion indicator tracks the real drop position during scroll.
  if (dragStarted) dropIndex.value = computeDropIndex(lastClientX)
  edgeRaf = requestAnimationFrame(stepEdgeScroll)
}
function updateEdgeScroll(clientX: number) {
  const el = tablistEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const overflowing = el.scrollWidth > el.clientWidth + 1
  let dir = 0
  if (overflowing) {
    if (clientX < r.left + EDGE_ZONE) dir = -1
    else if (clientX > r.right - EDGE_ZONE) dir = 1
  }
  edgeDir = dir
  if (dir !== 0 && edgeRaf === 0) edgeRaf = requestAnimationFrame(stepEdgeScroll)
}
function stopEdgeScroll() {
  edgeDir = 0
  if (edgeRaf) cancelAnimationFrame(edgeRaf)
  edgeRaf = 0
}

function onTabPointerDown(e: PointerEvent, id: string, index: number) {
  // Only left button starts an interaction; right-click is the context menu.
  if (e.button !== 0) return
  // Capture the pointer on the tab element IMMEDIATELY (mirrors onWpResize/onResize):
  // this guarantees every subsequent pointermove/up is routed to `dragEl` even while the
  // press is still under the drag threshold. Attaching listeners to `window` before
  // capture (the old model) dropped pre-threshold moves in Electron/Chromium, so the
  // drag branch never armed. The px threshold only distinguishes a click from a drag —
  // it never gates whether we capture.
  dragEl = e.currentTarget as HTMLElement
  dragStartX = e.clientX
  dragStarted = false
  dragPointerId = e.pointerId
  dragEl.setPointerCapture(dragPointerId)
  const move = (ev: PointerEvent) => {
    lastClientX = ev.clientX
    if (!dragStarted) {
      if (tabs.value.length < 2) return // nothing to reorder with a single tab
      if (Math.abs(ev.clientX - dragStartX) < DRAG_THRESHOLD) return
      // Crossed the threshold → this press is a drag: close any open menu, mark lifted.
      dragStarted = true
      closeMenus()
      pctx.value = null
      dragId.value = id
    }
    dropIndex.value = computeDropIndex(ev.clientX)
    updateEdgeScroll(ev.clientX)
  }
  const cleanup = () => {
    dragEl?.removeEventListener('pointermove', move)
    dragEl?.removeEventListener('pointerup', up)
    dragEl?.removeEventListener('pointercancel', up)
    if (dragEl?.hasPointerCapture(dragPointerId)) dragEl.releasePointerCapture(dragPointerId)
    stopEdgeScroll()
    dragId.value = null
    dropIndex.value = null
    dragEl = null
  }
  const up = (ev: PointerEvent) => {
    if (!dragStarted) {
      // A press that never crossed the threshold → a plain click: activate the tab
      // (preserves the previous @click behavior; the drag never armed).
      setActiveTab(id)
    } else {
      const to = computeDropIndex(ev.clientX)
      // The drop slot counts positions in the CURRENT order; dropping just after the
      // dragged tab's own slot is a no-op, so map it to the from index.
      const target = to > index ? to - 1 : to
      store.reorderTabs(id, target)
    }
    cleanup()
  }
  dragEl.addEventListener('pointermove', move)
  dragEl.addEventListener('pointerup', up)
  dragEl.addEventListener('pointercancel', up)
}
onBeforeUnmount(stopEdgeScroll)

// ── "+" picker + overflow dropdowns ─────────────────────────────────────────────
const addMenu = ref(false)
const overflowMenu = ref(false)
// Transient search query for the "+" picker (reset every open — not sticky, matching
// SessionList's transient filter). The highlighted item is always the first match.
const addQuery = ref('')
const addSearchEl = useTemplateRef<HTMLInputElement>('addSearchEl')

// Openable projects filtered by the search query (substring, case-insensitive). Names
// that collide within the filtered set get a secondary path line to tell them apart
// (OQ 1.a); the Default entry ('') matches on its localized label.
const filteredOpenable = computed<{ id: string; name: string; dupePath?: string }[]>(() => {
  const q = addQuery.value.trim().toLowerCase()
  const matched = q
    ? openableProjects.value.filter((p) => p.name.toLowerCase().includes(q))
    : openableProjects.value.slice()
  const nameCounts = new Map<string, number>()
  for (const p of matched) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1)
  return matched.map((p) => {
    if (p.id !== '' && (nameCounts.get(p.name) ?? 0) > 1) {
      return { ...p, dupePath: projectPath(p.id) ?? undefined }
    }
    return { id: p.id, name: p.name }
  })
})

function toggleAdd() {
  addMenu.value = !addMenu.value
  overflowMenu.value = false
  if (addMenu.value) {
    addQuery.value = ''
    nextTick(() => addSearchEl.value?.focus())
  }
}
function toggleOverflow() {
  overflowMenu.value = !overflowMenu.value
  addMenu.value = false
}
function closeMenus() {
  addMenu.value = false
  overflowMenu.value = false
  addQuery.value = ''
}
function pickProject(id: string) {
  setActiveTab(id)
  addMenu.value = false
  addQuery.value = ''
}
// Enter in the search input → open the highlighted (first) filtered match; no-op when
// the filter yields nothing.
function pickFirstMatch() {
  const first = filteredOpenable.value[0]
  if (first) pickProject(first.id)
}
function jumpTab(id: string) {
  setActiveTab(id)
  overflowMenu.value = false
}

// ── Tab context menu (project-scoped actions) ────────────────────────────────────
const pctx = ref<{ x: number; y: number; id: string } | null>(null)
const pctxMenuEl = useTemplateRef<HTMLElement>('pctxMenuEl')
const pctxStyle = ref<Record<string, string>>({})

function pOpenProject() {
  const id = pctx.value?.id
  pctx.value = null
  if (id) projectModal.open(id)
}

function openTabCtx(id: string, e: MouseEvent) {
  const { clientX: x, clientY: y } = e
  pctx.value = { x, y, id }
  pctxStyle.value = { left: `${x}px`, top: `${y}px` }
  nextTick(() => {
    pctxStyle.value = placeMenu(pctxMenuEl.value, x, y)
  })
}

// Color / LLM-defaults / open-Finder only make sense for a real project tab (the
// Default tab '' carries no project id / on-disk path).
const pctxIsProject = computed(() => !!pctx.value && pctx.value.id !== '')
const pctxColor = computed(() => (pctx.value?.id ? colorOf(pctx.value.id) : PROJECT_COLOR_DEFAULT))
// True when the active project's dot uses a user-picked hex (not a palette token).
const pctxCustom = computed(() => isCustomColor(pctxColor.value))
// Native color input only accepts `#rrggbb`; seed it with the current
// custom hex, else a neutral start so the OS picker opens somewhere sensible.
const customColorValue = computed(() => (pctxCustom.value ? pctxColor.value : '#888888')) // hex-ok: giá trị mặc định cho ô chọn màu gốc (chỉ nhận dạng rrggbb)
const pctxPath = computed<string | null>(() => (pctx.value?.id ? projectPath(pctx.value.id) : null))
const pctxCount = computed(() =>
  pctx.value ? store.sessions.filter((s) => s.project === pctx.value!.id).length : 0,
)

// Tab-close visibility gates (VSCode-style). The Default tab ('') is never closable;
// "Close all" stays available from it so it can close the remaining project tabs.
const pctxClosable = computed(() => !!pctx.value && pctx.value.id !== '')
const othersCount = computed(() =>
  pctx.value ? store.openProjectTabs.filter((p) => p !== '' && p !== pctx.value!.id).length : 0,
)
const rightCount = computed(() => {
  if (!pctx.value) return 0
  const i = store.openProjectTabs.indexOf(pctx.value.id)
  return i < 0 ? 0 : store.openProjectTabs.slice(i + 1).filter((p) => p !== '').length
})
const totalClosable = computed(() => store.openProjectTabs.filter((p) => p !== '').length)
const showCloseAll = computed(
  () => totalClosable.value > 1 || (totalClosable.value === 1 && !pctxClosable.value),
)
const showCloseGroup = computed(
  () => pctxClosable.value || othersCount.value > 0 || rightCount.value > 0 || showCloseAll.value,
)
function pClose() {
  const id = pctx.value?.id
  pctx.value = null
  if (id) closeTab(id)
}
function pCloseOthers() {
  const id = pctx.value?.id
  pctx.value = null
  if (id != null) store.closeOtherTabs(id)
}
function pCloseRight() {
  const id = pctx.value?.id
  pctx.value = null
  if (id != null) store.closeTabsToRight(id)
}
function pCloseAll() {
  pctx.value = null
  store.closeAllTabs()
}

function pSetColor(token: string | null) {
  if (pctx.value?.id) setColor(pctx.value.id, token)
}
// Native color picker → store the raw hex (fires live as the user drags in the
// OS picker, so the dot updates immediately). The menu stays open throughout.
function onCustomColorInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  if (pctx.value?.id) setColor(pctx.value.id, value)
}
function pNewSession() {
  const id = pctx.value?.id
  pctx.value = null
  store.create(id || undefined)
}
const llmModalProject = ref<Project | null>(null)
function pLlmDefaults() {
  const id = pctx.value?.id
  pctx.value = null
  if (id) llmModalProject.value = projectsStore.projectById(id) ?? null
}
function pSelectAll() {
  const id = pctx.value?.id
  pctx.value = null
  if (id == null) return
  store.setSelectMode(true)
  // Chỉ chọn các phiên đang HIỆN trong list — phiên "của board" (teamId /
  // origin:'board') bị ẩn nên thao tác hàng loạt cũng bỏ qua chúng.
  store.sessions
    .filter((s) => s.project === id && !isBoardSession(s))
    .forEach((s) => {
      if (!store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
}
function pDeselectAll() {
  const id = pctx.value?.id
  pctx.value = null
  if (id == null) return
  store.sessions
    .filter((s) => s.project === id)
    .forEach((s) => {
      if (store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
}
function pOpenFinder() {
  const path = pctxPath.value
  pctx.value = null
  if (path && sc.available) sc.openPath(path, '.').catch(() => undefined)
}
async function pDeleteAll() {
  const id = pctx.value?.id
  pctx.value = null
  if (id == null) return
  // Xoá hàng loạt theo project bỏ qua phiên "của board" — xoá member của run
  // để assigneeSessionId của board item dangle. Chúng ẩn khỏi list nên thao
  // tác trên list cũng không chạm tới chúng.
  const ids = store.sessions.filter((s) => s.project === id && !isBoardSession(s)).map((s) => s.id)
  if (!ids.length) return
  const ok = await confirm({
    title: t('sessions.delete.manyTitle', { n: ids.length }),
    description: t('sessions.delete.many', { n: ids.length }),
  })
  if (ok) store.bulkRemove(ids)
}
</script>

<style scoped>
/* style-ok: tia "đang chạy" quét quanh viền tab — conic-gradient trên một con xoay,
   khoét ruột bằng mask-composite chỉ để lại vòng 2px (Tailwind không diễn đạt mask
   composite), cộng keyframe xoay riêng; và nền cầu vồng của ô "màu tuỳ chọn".
   Xoay bằng transform (không animate custom property) nên không cần @property và
   chỉ compositor làm việc. */
.stab-run {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 2px;
  overflow: hidden;
  pointer-events: none;
  /* Knock out the centre: full box minus content-box leaves the padding ring. */
  -webkit-mask:
    linear-gradient(black 0 0) content-box,
    linear-gradient(black 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(black 0 0) content-box,
    linear-gradient(black 0 0);
  mask-composite: exclude;
}
.stab-run::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 260%;
  aspect-ratio: 1;
  translate: -50% -50%;
  background: conic-gradient(
    from 0deg,
    transparent 0 66%,
    var(--stab-color, var(--primary)) 84%,
    transparent 100%
  );
  animation: stab-run-spin 1.5s linear infinite;
}
@keyframes stab-run-spin {
  to {
    rotate: 360deg;
  }
}
@media (prefers-reduced-motion: reduce) {
  /* Keep a full ring so "running" is still stated, just without the chase. */
  .stab-run::after {
    animation: none;
    background: var(--stab-color, var(--primary));
    opacity: 0.55;
  }
}
/* Ô "chọn màu riêng": gợi ý cầu vồng khi chưa có màu tuỳ chọn (có rồi thì nền inline
   mang màu đó đè lên). Đây là hình minh hoạ "bất kỳ màu nào", không phải màu theme. */
.swatch-rainbow {
  background: conic-gradient(
    from 0deg,
    rgb(248 113 113),
    rgb(251 191 36),
    rgb(52 211 153),
    rgb(96 165 250),
    rgb(167 139 250),
    rgb(244 114 182),
    rgb(248 113 113)
  );
}
</style>
