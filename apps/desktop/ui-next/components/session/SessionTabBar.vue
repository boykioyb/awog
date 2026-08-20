<template>
  <div class="stabs">
    <div ref="tablistEl" class="stabs-scroll" role="tablist" :aria-label="t('sessions.tabs.label')">
      <div
        v-for="(tab, i) in tabs"
        :key="tab.id"
        class="stab"
        :class="{
          on: tab.active,
          running: tab.running,
          'done-unread': tab.doneUnread,
          dragging: dragId === tab.id,
          'drop-before': dropIndex === i,
          'drop-after': dropIndex === tabs.length && i === tabs.length - 1,
        }"
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
          class="stab-dot"
          :class="{ running: tab.running }"
          :style="{ background: tab.color, '--stab-dot': tab.color }"
          :role="tab.running ? 'img' : undefined"
          :aria-label="tab.running ? t('sessions.tabs.running') : undefined"
          :title="tab.running ? t('sessions.tabs.running') : undefined"
        />
        <span class="stab-nm">{{ tab.name }}</span>
        <!-- Running: a beam that chases the tab's border. Its own element, not a
             pseudo-element — ::before/::after on .stab are taken by the drag-reorder drop
             indicators. Sits on top of the running background tint. -->
        <span v-if="tab.running" class="stab-run" aria-hidden="true" />
        <span
          v-if="tab.unread"
          class="stab-unread"
          :title="t('sessions.tabs.unread', { n: tab.unread })"
        >
          {{ tab.unread }}
        </span>
        <button
          v-if="tab.closable"
          class="stab-x"
          :aria-label="t('sessions.tabs.closeName', { name: tab.name })"
          :title="t('sessions.tabs.close')"
          @pointerdown.stop
          @click.stop="closeTab(tab.id)"
          @keydown.stop
        >
          <Icon name="x" style="width: 12px; height: 12px" />
        </button>
      </div>
    </div>

    <button
      class="stab-btn"
      :aria-label="t('sessions.tabs.addProject')"
      :title="t('sessions.tabs.addProject')"
      @click.stop="toggleAdd"
    >
      <Icon name="plus" style="width: 14px; height: 14px" />
    </button>
    <button
      v-if="tabs.length > 1"
      class="stab-btn"
      :aria-label="t('sessions.tabs.overflow')"
      :title="t('sessions.tabs.overflow')"
      @click.stop="toggleOverflow"
    >
      <Icon name="chev" style="width: 14px; height: 14px" />
    </button>

    <!-- "+" project picker: projects not already open as a tab. A sticky search input
         filters by name (substring, case-insensitive); Enter opens the highlighted
         (first) match, Esc closes + clears. -->
    <div v-if="addMenu" class="smenu stabs-drop" @click.stop>
      <input
        ref="addSearchEl"
        v-model="addQuery"
        class="stabs-search"
        type="text"
        :placeholder="t('sessions.tabs.searchPlaceholder')"
        :aria-label="t('sessions.tabs.searchPlaceholder')"
        @keydown.enter.prevent="pickFirstMatch"
        @keydown.esc.prevent="closeMenus"
      />
      <div class="stabs-droplist">
        <template v-if="filteredOpenable.length">
          <div v-for="p in filteredOpenable" :key="p.id" class="mi" @click="pickProject(p.id)">
            <span class="stabs-nm">{{ p.name }}</span>
            <span v-if="p.dupePath" class="stabs-path">{{ p.dupePath }}</span>
          </div>
        </template>
        <div v-else-if="openableProjects.length" class="stabs-empty">
          {{ t('sessions.tabs.noMatch') }}
        </div>
        <div v-else class="stabs-empty">{{ t('sessions.tabs.noProjects') }}</div>
      </div>
    </div>

    <!-- Overflow: jump to any open tab (when the strip scrolls). -->
    <div v-if="overflowMenu" class="smenu stabs-drop" @click.stop>
      <div v-for="tab in tabs" :key="tab.id" class="mi" @click="jumpTab(tab.id)">
        <span
          class="stab-dot"
          :class="{ running: tab.running }"
          :style="{ background: tab.color, '--stab-dot': tab.color }"
        />
        {{ tab.name }}
        <Icon v-if="tab.active" name="check" class="ck" style="width: 13px; height: 13px" />
      </div>
    </div>

    <div
      v-if="addMenu || overflowMenu"
      style="position: fixed; inset: 0; z-index: 40"
      @click="closeMenus"
    />

    <!-- Right-click a tab → project-scoped actions (migrated from the old session
         list group header). Same `.smenu`/`.ctxmenu` chrome as SessionList. -->
    <template v-if="pctx">
      <div
        class="ctxbackdrop"
        @click="pctx = null"
        @contextmenu.prevent="pctx = null"
        @wheel="pctx = null"
      />
      <div ref="pctxMenuEl" class="smenu ctxmenu" :style="pctxStyle">
        <div class="mi" @click="pNewSession">
          <Icon name="plus" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.newSession') }}
        </div>
        <!-- Tab management (VSCode-style) — closing tabs never deletes sessions. -->
        <template v-if="showCloseGroup">
          <div class="ctxsep" />
          <div v-if="pctxClosable" class="mi" @click="pClose">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.close') }}
          </div>
          <div v-if="othersCount" class="mi" @click="pCloseOthers">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.closeOthers') }}
          </div>
          <div v-if="rightCount" class="mi" @click="pCloseRight">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.closeRight') }}
          </div>
          <div v-if="showCloseAll" class="mi" @click="pCloseAll">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.closeAll') }}
          </div>
        </template>
        <template v-if="pctxIsProject">
          <div class="ctxsep" />
          <div class="mi" @click="pLlmDefaults">
            <Icon name="brain" style="width: 13px; height: 13px" />
            {{ t('sessions.pctx.llmDefaults') }}
          </div>
          <div class="ctxsep" />
          <div class="ctxcolor">
            <span class="ctxcolorlbl">{{ t('sessions.pctx.color') }}</span>
            <div class="ctxsw">
              <span
                v-for="c in PROJECT_COLOR_PALETTE"
                :key="c.token"
                class="swatch"
                :class="{ on: pctxColor === c.token }"
                :style="{ background: c.token }"
                :title="c.label"
                @click="pSetColor(c.token)"
              />
              <!-- Custom color: a <label> wrapping a hidden native color input so
                   clicking the swatch opens the OS color picker anchored right here.
                   When a custom hex is active the swatch shows it; otherwise a
                   palette glyph hints "pick your own". -->
              <label
                class="swatch custom"
                :class="{ on: pctxCustom }"
                :style="pctxCustom ? { background: pctxColor } : undefined"
                :title="t('sessions.pctx.colorCustom')"
              >
                <Icon v-if="!pctxCustom" name="palette" style="width: 11px; height: 11px" />
                <input
                  type="color"
                  class="ctxcolorinput"
                  :value="customColorValue"
                  @input="onCustomColorInput"
                />
              </label>
              <span
                class="swatch clear"
                :class="{ on: pctxColor === PROJECT_COLOR_DEFAULT }"
                :title="t('sessions.pctx.colorClear')"
                @click="pSetColor(null)"
              >
                <Icon name="x" style="width: 11px; height: 11px" />
              </span>
            </div>
          </div>
        </template>
        <div class="ctxsep" />
        <div class="mi" @click="pSelectAll">
          <Icon name="check" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.selectAll', { n: pctxCount }) }}
        </div>
        <div class="mi" @click="pDeselectAll">
          <Icon name="x" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.deselectAll') }}
        </div>
        <div v-if="pctxPath" class="mi" @click="pOpenFinder">
          <Icon name="folder" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.openFinder') }}
        </div>
        <div class="ctxsep" />
        <div class="mi danger" @click="pDeleteAll">
          <Icon name="trash" style="width: 13px; height: 13px" />
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

const { t } = useI18n()
const { tabs, openableProjects, projectPath, setActiveTab, closeTab } = useSessionTabs()
const store = useSessionsStore()
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
// Native <input type="color"> only accepts `#rrggbb`; seed it with the current
// custom hex, else a neutral start so the OS picker opens somewhere sensible.
const customColorValue = computed(() => (pctxCustom.value ? pctxColor.value : '#888888'))
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
  store.sessions
    .filter((s) => s.project === id)
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
  const ids = store.sessions.filter((s) => s.project === id).map((s) => s.id)
  if (!ids.length) return
  const ok = await confirm({
    title: t('sessions.delete.manyTitle', { n: ids.length }),
    description: t('sessions.delete.many', { n: ids.length }),
  })
  if (ok) store.bulkRemove(ids)
}
</script>

<style scoped>
.stabs {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex: 0 0 auto;
  padding: 0 8px;
  min-height: 38px;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
}
.stabs-scroll {
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  /* No native touch/pen pan on the strip — the reorder drag owns the horizontal
     gesture (mirrors .stab). Wheel scroll is unaffected. */
  touch-action: none;
}
.stabs-scroll::-webkit-scrollbar {
  display: none;
}
/* One tab: flat by default, accent underline + brighter text when active. */
.stab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  max-width: 200px;
  padding: 0 9px;
  cursor: pointer;
  color: var(--textDim);
  border-bottom: 2px solid transparent;
  user-select: none;
  touch-action: none;
}
/* Hover only on inactive tabs — the active tab keeps its accent tint (no gray
   fill swap on hover). */
.stab:hover:not(.on) {
  background: var(--bgHover);
  color: var(--text);
}
/* Active tab: accent-tint fill (NOT a gray surface) + accent underline + brighter
   text, so it reads clearly as the open project. */
.stab.on {
  color: var(--text);
  background: var(--accentDim);
  border-bottom-color: var(--accent);
}
/* Keyboard focus ring (a11y) — never removed; the click :hover/:active states are
   separate. Inset so it reads inside the strip's bottom border. */
.stab:focus-visible,
.stab-btn:focus-visible,
.stab-x:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 6px;
}
/* The lifted tab during a drag-reorder: dimmed so the insertion indicator reads. */
.stab.dragging {
  opacity: 0.4;
}
/* Insertion indicator — a thin accent bar at the drop slot (before / after a tab). */
.stab.drop-before::before,
.stab.drop-after::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 2px;
  background: var(--accent);
  z-index: 1;
}
.stab.drop-before::before {
  left: -2px;
}
.stab.drop-after::after {
  right: -2px;
}
.stab-dot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 99px;
  flex: 0 0 auto;
}
/* ── Tab status: running beam + state tints ──────────────────────────────────
   Two live states, both expressed the way the rest of the app expresses state —
   background + border — rather than an extra decorative rule:

     running     → the tab's background takes a wash of the PROJECT's own colour and a
                   beam chases its border. A project working in the background is then
                   obvious from across the strip, and the colour says WHICH project.
     done-unread → a static amber chip: a result landed while you were elsewhere. Amber
                   is already this app's "needs your eyes" colour (the unread badge
                   beside it, .bdg.wait, .acard.hot), so no sixth hue is introduced.

   The beam is a conic gradient on a rotating child, with the middle masked out so only
   a 2px ring paints. Rotation (a transform) drives it — NOT an animated custom
   property — so it needs no @property registration and only the compositor works. */
.stab-run {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 2px;
  overflow: hidden;
  pointer-events: none;
  /* Knock out the centre: full box minus content-box leaves the padding ring. */
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
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
    var(--stab-color, var(--accent)) 84%,
    transparent 100%
  );
  animation: stab-run-spin 1.5s linear infinite;
}
@keyframes stab-run-spin {
  to {
    rotate: 360deg;
  }
}
/* Running background wash, in the project's colour. Skipped on the ACTIVE tab, which
   keeps its own accent fill — the beam alone carries "running" there. */
.stab.running:not(.on) {
  background: color-mix(in srgb, var(--stab-color, var(--accent)) 11%, transparent);
  border-color: color-mix(in srgb, var(--stab-color, var(--accent)) 30%, transparent);
}
/* "A result is waiting" — whole-chip amber, so it reads without hunting for a badge.
   Gated off the active tab: you are looking at it, so nothing there is unread. */
.stab.done-unread:not(.on):not(.running) {
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  border-color: color-mix(in srgb, var(--amber) 34%, transparent);
}
.stab.done-unread:not(.on):not(.running) .stab-nm {
  color: var(--amber);
  font-weight: 600;
}
@media (prefers-reduced-motion: reduce) {
  /* Keep a full ring so "running" is still stated, just without the chase. */
  .stab-run::after {
    animation: none;
    background: var(--stab-color, var(--accent));
    opacity: 0.55;
  }
}

.stab-nm {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.stab.on .stab-nm {
  font-weight: 600;
}
/* Unread / attention count — amber pill, same semantic + look as the NavRail
   sessions badge (.bdg.wait). Only rendered when > 0. */
.stab-unread {
  display: grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 5px;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  background: var(--amberDim);
  color: var(--amber);
  border: 1px solid var(--amberBorder);
}
.stab-x {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 5px;
  color: var(--textFaint);
  opacity: 0;
  transition: opacity 0.12s;
}
.stab:hover .stab-x,
.stab.on .stab-x {
  opacity: 1;
}
.stab-x:hover {
  color: var(--text);
  background: var(--bgActive);
}
/* "+" / overflow buttons sit flush at the right of the strip. */
.stab-btn {
  display: grid;
  place-items: center;
  width: 28px;
  flex: 0 0 auto;
  align-self: center;
  height: 28px;
  border: 0;
  border-radius: 7px;
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
}
.stab-btn:hover {
  color: var(--text);
  background: var(--bgHover);
}
/* Dropdowns under the strip (add picker / overflow). Mirrors SessionList's inline
   `.smenu` dropdowns: absolutely placed, above the page body. */
.stabs-drop {
  position: absolute;
  top: 100%;
  right: 8px;
  z-index: 50;
  min-width: 220px;
  max-height: 60vh;
  overflow-y: auto;
}
.stabs-drop .stab-dot {
  margin-right: 2px;
}
/* Sticky search field pinned to the top of the "+" picker (list scrolls under it). */
.stabs-search {
  position: sticky;
  top: 0;
  z-index: 1;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
  color: var(--text);
  outline: none;
}
.stabs-search::placeholder {
  color: var(--textFaint);
}
.stabs-droplist {
  padding: 2px 0;
}
.stabs-droplist .mi {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}
.stabs-nm {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* Secondary path line, only shown to disambiguate same-named projects (OQ 1.a). */
.stabs-path {
  color: var(--textFaint);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.stabs-empty {
  padding: 8px 12px;
  color: var(--textFaint);
}
/* Context menu chrome (copied from SessionList — the project actions moved here). */
.ctxbackdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.ctxmenu {
  position: fixed;
  z-index: 61;
  min-width: 178px;
}
.ctxsep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
.ctxcolor {
  padding: 4px 10px 6px;
}
.ctxcolorlbl {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--textDim);
}
.ctxsw {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.ctxsw .swatch {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 99px;
  cursor: pointer;
  color: var(--textDim);
  box-shadow: 0 0 0 1px var(--border);
  transition:
    transform 0.1s,
    box-shadow 0.1s;
}
.ctxsw .swatch:hover {
  transform: scale(1.12);
}
.ctxsw .swatch.on {
  box-shadow:
    0 0 0 2px var(--bgPanel),
    0 0 0 4px var(--accent);
}
.ctxsw .swatch.clear {
  background: transparent;
}
/* Custom-color swatch: a rainbow hint when no custom hex is picked, else it wears
   the chosen color (background set inline). Relative so the native input overlays it. */
.ctxsw .swatch.custom {
  position: relative;
  overflow: hidden;
  color: var(--text);
  background: conic-gradient(
    from 0deg,
    #f87171,
    #fbbf24,
    #34d399,
    #60a5fa,
    #a78bfa,
    #f472b6,
    #f87171
  );
}
/* The native color input fills the swatch, fully transparent — clicking the swatch
   opens the OS picker anchored here. */
.ctxsw .swatch.custom .ctxcolorinput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.ctxmenu .mi.danger {
  color: var(--danger);
}
.ctxmenu .mi.danger:hover {
  background: var(--dangerDim, color-mix(in srgb, var(--danger) 14%, transparent));
}
@media (prefers-reduced-motion: reduce) {
  .stab-x,
  .ctxsw .swatch {
    transition: none;
  }
}
</style>
