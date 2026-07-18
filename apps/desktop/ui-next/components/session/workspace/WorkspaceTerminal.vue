<template>
  <div
    class="wsterm"
    :class="{ 'wsterm--dragging': isDragging, 'wsterm--resizing': isResizing }"
    :style="{ '--wsterm-bg': paneBg }"
  >
    <div v-if="errorMsg || !ready" class="empty" style="padding: 30px">
      <div class="et">{{ errorMsg ?? unavailableMsg }}</div>
    </div>

    <template v-else>
      <!-- Tab strip: one tab per shell group. A tab holds a split tree of panes; a
           fresh tab is a single leaf and behaves exactly as a plain terminal. Right-
           click (or double-click to rename) a tab for the actions menu. -->
      <div class="wsterm-tabs" role="tablist">
        <button
          v-for="(tab, i) in tabs"
          :key="tab.id"
          class="wsterm-tab"
          :class="{ active: tab.id === activeTabId }"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          :title="tabLabel(tab, i)"
          @click="setActive(tab.id)"
          @dblclick="renameTab(tab.id)"
          @contextmenu="menu.open($event, tab.id)"
        >
          <span class="wsterm-tab-label">{{ tabLabel(tab, i) }}</span>
          <span
            v-if="tabs.length > 1"
            class="wsterm-tab-close"
            role="button"
            :title="t('sessions.workspace.terminal.closeTab')"
            :aria-label="t('sessions.workspace.terminal.closeTab')"
            @click.stop="closeTab(tab.id)"
          >
            <X :size="12" />
          </span>
        </button>
        <button
          class="wsterm-tab-add"
          :title="t('sessions.workspace.terminal.newTab')"
          :aria-label="t('sessions.workspace.terminal.newTab')"
          @click="addTab(true)"
        >
          <Plus :size="13" />
        </button>
      </div>

      <!-- One layer per tab; only the active one is shown (hidden tabs keep their
           PTYs + buffers). Each layer renders the tab's split tree via the recursive
           WorkspaceTerminalNode. A single-leaf tab renders exactly one full-size box —
           identical to before the split feature. -->
      <div class="wsterm-stage">
        <div v-for="tab in tabs" v-show="tab.id === activeTabId" :key="tab.id" class="wsterm-panes">
          <WorkspaceTerminalNode :node="tab.layout" :tab-id="tab.id" />
        </div>
      </div>
    </template>

    <ContextMenu
      :open="!!menu.pos.value"
      :position="menu.pos.value ?? { x: 0, y: 0 }"
      :items="menuItems"
      @close="menu.close"
      @select="onMenuSelect"
    />
  </div>
</template>

<script setup lang="ts">
// Terminal tab (§5/§10) — real PTY via terminal.create/write/resize/kill, output
// streamed through sc.onEvent (terminal.data / terminal.exit). Multi-tab: each UI
// tab owns a split tree of independent panes; each pane is its own PTY + xterm
// instance + early-output buffer, all sharing one PTY grouping key. Switching tabs
// only hides/shows (never kills) — every PTY is killed on tab/pane close + unmount.
//
// A tab holds exactly ONE leaf by default → it renders + behaves identically to a
// plain single-terminal tab. Splitting (menu "Split right/down" or dragging a pane's
// grip onto another pane's edge) grows the tree; the recursive WorkspaceTerminalNode
// lays panes out as a resizable 2D grid. Dragging a pane onto a target's centre swaps
// the two.
//
// The linchpin: moving/splitting re-parents a pane's box in the DOM, but its xterm +
// PTY + (SSH) connection MUST survive. Each Pane keeps its xterm's element; on every
// layout mutation we re-attach that element to the pane's current box (never dispose
// on a move — disposal only on real close / unmount).
//
// SoC: this widget knows only a cwd + a grouping key, NOT sessions or projects.
// Two hosts use it: the session workspace panel (cwd = project root, key
// `ses:<id>`) and the app-wide GlobalTerminalHost (cwd = "~", key `global`). A third
// (SSH) supplies its own transport. Degrades to an empty state when the engine
// bridge / cwd is absent.
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import { Plus, X } from 'lucide-vue-next'
import { useTerminalAppearanceStore } from '~/stores/terminalAppearance'
import { useSidecar, type SidecarEvent, type UnlistenFn } from '~/composables/useSidecar'
import { useTerminalApi, type TerminalTransport } from '~/composables/useTerminalApi'
import { useContextMenu, type MenuItem } from '~/composables/useContextMenu'
import { useTextPrompt } from '~/composables/useTextPrompt'
import WorkspaceTerminalNode, {
  TERM_CTX,
  collectPaneIds,
  removeLeaf,
  splitLeaf,
  swapPanes,
  type DropZone,
  type LayoutNode,
  type LayoutSplit,
  type TerminalNodeCtx,
} from './WorkspaceTerminalNode.vue'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  // Absolute cwd for the PTY, or "~" (the sidecar expands it). null while a
  // host's root is still resolving → the empty state shows.
  root: string | null
  // True when the engine bridge is present AND a cwd is available — gates xterm
  // init + PTY spawn. Session panel: sc.available && project root resolved;
  // global dock: sc.available (cwd is always "~").
  ready: boolean
  // Opaque PTY grouping key for the sidecar (`ses:<id>` or `global`). All tabs
  // of one host share it; the sidecar still hands back a distinct terminalId.
  ptyKey: string
  // True when this is the visible host — drives deferred PTY spawn / refit (an
  // off-screen terminal has zero size).
  visible: boolean
  // Optional empty-state text when the engine bridge is absent. Defaults to the
  // session wording; the global dock passes its own (no "this session" phrasing).
  unavailableLabel?: string
  // Optional backend override. Absent → the local PTY (terminal.*) — unchanged
  // for the session panel + global dock. Provided (e.g. the SSH backend) → that
  // adapter drives create/write/resize/kill + which events to route on.
  transport?: TerminalTransport
}>()

// Report the ACTIVE pane's live backend id to the parent. The SSH co-pilot binds
// its ssh_terminal_run to exactly the shell the user is watching (not a store guess).
// Harmless for the session panel / global dock (they ignore it).
const emit = defineEmits<{ conn: [id: string | null] }>()

const { t } = useI18n()
const sc = useSidecar()
const api = useTerminalApi()
const { prompt } = useTextPrompt()

// The local-PTY backend (default). `create` maps the cwd + grouping key onto
// terminal.create and normalizes its `terminalId` to the transport's `id`.
const defaultTransport: TerminalTransport = {
  create: (cols, rows) =>
    api.create(props.root ?? '~', props.ptyKey, cols, rows).then((r) => ({ id: r.terminalId })),
  write: (id, data) => api.write(id, data),
  resize: (id, cols, rows) => api.resize(id, cols, rows),
  kill: (id) => api.kill(id),
  dataEvent: 'terminal.data',
  exitEvent: 'terminal.exit',
  idField: 'terminalId',
}
const activeTransport = computed<TerminalTransport>(() => props.transport ?? defaultTransport)
// The PTY backend needs a resolved cwd before spawning; a custom transport (SSH)
// carries its own target, so it may spawn as soon as it's visible + ready.
const canCreate = computed(() => (props.transport ? true : props.root != null))

const errorMsg = ref<string | null>(null)

const unavailableMsg = computed(
  () =>
    props.unavailableLabel ??
    (sc.available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable')),
)

const tabTitle = (i: number): string => t('sessions.workspace.terminal.tabTitle', { n: i + 1 })
// A tab shows its custom label when renamed, else the positional default.
const tabLabel = (tab: TerminalTab, i: number): string => tab.label ?? tabTitle(i)

// Read CSS theme tokens off the live document so xterm matches the active theme.
const cssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// Terminal appearance (color preset + font). The 'system' preset (theme === null)
// keeps the CSS-var-derived palette below — byte-identical to the pre-feature look.
const appearance = useTerminalAppearanceStore()

// Background for the pane BOX so its padding reads as INTERNAL terminal padding (the
// dark bg fills under the padding, text inset from the edge) instead of a page-colour
// gutter. Matches the xterm background: a preset's hex, else live `var(--bg)` (system).
const paneBg = computed(() => appearance.theme?.background ?? 'var(--bg)')

// The xterm theme to apply: a concrete preset when one is chosen, else the live
// CSS-var theme (the exact object initPane used to build inline). System preset →
// this returns the app-theme colors → no visible change.
const resolveTheme = (): ITheme =>
  appearance.theme ?? {
    background: cssVar('--bg', '#0d0d0d'),
    foreground: cssVar('--text', '#e5e5e5'),
    cursor: cssVar('--accent', '#3b82f6'),
    selectionBackground: cssVar('--accent', '#3b82f6'),
    selectionForeground: cssVar('--accentText', '#ffffff'),
  }

// ── Per-pane state ────────────────────────────────────────────────────────────
// A Pane encapsulates one xterm + FitAddon + PTY id + the early-output buffer.
// Events that arrive between PTY spawn and us learning its terminalId are buffered
// per pane; otherwise the first burst (instant prompt) is lost and xterm starts
// parsing mid-escape-sequence → garbage. Kept off the reactive system (class +
// non-reactive map) — only the lightweight ids live in the reactive `tabs` list.
class Pane {
  readonly id: string

  readonly tabId: string

  el: HTMLElement | null = null

  term: Terminal | null = null

  fit: FitAddon | null = null

  terminalId: string | null = null

  resizeObserver: ResizeObserver | null = null

  creating = false

  pending: SidecarEvent[] = []

  constructor(id: string, tabId: string) {
    this.id = id
    this.tabId = tabId
  }
}

// Reactive view of the tab strip. `label` drives the tab title (null → positional
// default); `layout` is the split tree; `activePaneId` is the focus/copy target. The
// heavy Pane state lives in the non-reactive map keyed by paneId.
type TerminalTab = {
  id: string
  label: string | null
  layout: LayoutNode
  activePaneId: string | null
}

const tabs = ref<TerminalTab[]>([])
const activeTabId = ref<string | null>(null)
// Non-reactive lookup of the heavy per-pane state (xterm is large; never proxy it).
const panes = new Map<string, Pane>()
// Single shared sidecar event listener; routes by terminalId to the owning pane.
let unlisten: UnlistenFn | null = null
let seq = 0

const nextId = (prefix: string): string => `${prefix}${++seq}`

const tabById = (id: string): TerminalTab | undefined => tabs.value.find((tt) => tt.id === id)
const paneIdsOf = (tab: TerminalTab): string[] => collectPaneIds(tab.layout)
const activePaneOf = (tab: TerminalTab): Pane | undefined => {
  const id = tab.activePaneId ?? paneIdsOf(tab)[0]
  return id ? panes.get(id) : undefined
}
// Emit the active pane's live backend id (terminalId isn't reactive — panes live in
// a plain Map — so we push it imperatively on create / pane-switch / tab-switch / close).
const emitActiveConn = (): void => {
  const tab = activeTabId.value ? tabById(activeTabId.value) : undefined
  emit('conn', (tab && activePaneOf(tab)?.terminalId) ?? null)
}
// Run `fn` over each live Pane of a tab (in tree order).
const forEachPane = (tab: TerminalTab, fn: (pane: Pane) => void): void => {
  for (const id of paneIdsOf(tab)) {
    const pane = panes.get(id)
    if (pane) fn(pane)
  }
}

// ── Event routing ─────────────────────────────────────────────────────────────
const routeEvent = (pane: Pane, evt: SidecarEvent): void => {
  const tr = activeTransport.value
  const payload = evt.payload as Record<string, unknown>
  if (payload?.[tr.idField] !== pane.terminalId || !pane.term) return
  if (evt.type === tr.dataEvent && typeof payload.chunk === 'string') {
    pane.term.write(payload.chunk)
  } else if (evt.type === tr.exitEvent) {
    const code = typeof payload.exitCode === 'number' ? payload.exitCode : 0
    pane.term.write(`\r\n\x1b[90m[${t('sessions.workspace.terminal.exited')} ${code}]\x1b[0m\r\n`)
    pane.terminalId = null
  }
}

const onSidecarEvent = (evt: SidecarEvent): void => {
  const tr = activeTransport.value
  if (evt.type !== tr.dataEvent && evt.type !== tr.exitEvent) return
  const payload = evt.payload as Record<string, unknown>
  for (const pane of panes.values()) {
    if (!pane.terminalId) {
      // Not yet bound — buffer for whichever pane claims this id once it knows it.
      pane.pending.push(evt)
      continue
    }
    if (pane.terminalId === payload?.[tr.idField]) {
      routeEvent(pane, evt)
      return
    }
  }
}

// ── PTY lifecycle ─────────────────────────────────────────────────────────────
// Spawn the PTY at the pane's real fitted size. The shared data listener is already
// attached (see ensureListener) so no early output is dropped.
const createPty = async (pane: Pane, cols: number, rows: number): Promise<void> => {
  if (pane.terminalId || pane.creating || !pane.term || !canCreate.value) return
  const tr = activeTransport.value
  pane.creating = true
  try {
    const result = await tr.create(cols, rows)
    pane.terminalId = result.id
    emitActiveConn()
  } catch (err) {
    errorMsg.value =
      err instanceof Error ? err.message : t('sessions.workspace.terminal.unavailable')
    return
  } finally {
    pane.creating = false
  }

  const instance = pane.term
  instance.onData((data) => {
    if (pane.terminalId) tr.write(pane.terminalId, data).catch(() => undefined)
  })

  // Flush buffered early output that belongs to this PTY; drop the rest of the
  // buffer (events for other panes are buffered on their own pane).
  const buffered = pane.pending
  pane.pending = []
  buffered.forEach((evt) => routeEvent(pane, evt))
}

const syncSize = (pane: Pane): void => {
  const container = pane.el
  if (!pane.fit || !pane.term || !container) return
  if (container.clientWidth === 0 || container.clientHeight === 0) return
  try {
    pane.fit.fit()
  } catch {
    // container not measurable yet — ignore
  }
  const { cols, rows } = pane.term
  if (!pane.terminalId) {
    void createPty(pane, cols, rows)
  } else {
    activeTransport.value.resize(pane.terminalId, cols, rows).catch(() => undefined)
  }
}

// Attach the shared sidecar listener once, before any PTY can exist. Buffering in
// onSidecarEvent keeps early bursts until each pane learns its terminalId.
const ensureListener = async (): Promise<void> => {
  if (unlisten || !sc.available) return
  unlisten = await sc.onEvent(onSidecarEvent)
}

// Open xterm into the pane's container (once the DOM node + root are ready).
const initPane = async (pane: Pane): Promise<void> => {
  const container = pane.el
  if (!container || pane.term || !props.ready) return

  await ensureListener()

  const instance = new Terminal({
    fontSize: appearance.fontSize,
    fontFamily: appearance.fontFamily,
    cursorBlink: true,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    theme: resolveTheme(),
  })
  pane.fit = new FitAddon()
  instance.loadAddon(pane.fit)
  instance.open(container)
  pane.term = instance

  // Copy only: xterm doesn't copy its selection on its own, so bind Cmd+C (mac) /
  // Ctrl+Shift+C (win/linux) when there IS a selection; plain Ctrl+C stays SIGINT.
  // Paste is intentionally NOT handled here — xterm's built-in paste (the browser's
  // native `paste` event on Cmd+V / Ctrl+V) already writes the text through onData
  // once, with correct bracketed-paste wrapping. Handling paste again on keydown
  // would write it a second time → every paste duplicated.
  instance.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const wantsCopy =
      (e.metaKey && e.code === 'KeyC') || (e.ctrlKey && e.shiftKey && e.code === 'KeyC')
    if (wantsCopy && instance.hasSelection()) {
      navigator.clipboard.writeText(instance.getSelection()).catch(() => undefined)
      return false
    }
    return true
  })

  pane.resizeObserver = new ResizeObserver(() => {
    if (pane.tabId === activeTabId.value) syncSize(pane)
  })
  pane.resizeObserver.observe(container)
  syncSize(pane)
}

// Dispose one pane's xterm + PTY (no tree mutation — caller owns `tabs`/`panes`).
// Called ONLY on real close / unmount — NEVER during a split or move.
const disposePane = (pane: Pane): void => {
  pane.resizeObserver?.disconnect()
  pane.resizeObserver = null
  if (pane.terminalId) activeTransport.value.kill(pane.terminalId).catch(() => undefined)
  pane.terminalId = null
  pane.term?.dispose()
  pane.term = null
  pane.fit = null
  pane.el = null
}

// After every layout mutation (split / move / close), Vue may have recreated pane
// boxes. Re-attach each surviving xterm's element into its current box (never
// dispose) so the shell + connection live on, then refit the active tab's panes.
const reattachAll = (): void => {
  for (const pane of panes.values()) {
    if (!pane.term || !pane.el) continue
    const el = pane.term.element
    if (el && el.parentElement !== pane.el) pane.el.appendChild(el)
    if (pane.tabId === activeTabId.value) syncSize(pane)
  }
}

// Fit + focus every pane of a tab (called when it becomes visible/active).
const syncTab = (tabId: string): void => {
  const tab = tabById(tabId)
  if (!tab) return
  forEachPane(tab, syncSize)
  activePaneOf(tab)?.term?.focus()
}

// Init xterm for any not-yet-opened pane of a tab (used when ready flips true after
// mount; the :ref callback handles the normal path).
const initTabPanes = (tabId: string): void => {
  const tab = tabById(tabId)
  if (!tab) return
  forEachPane(tab, (pane) => {
    if (!pane.term) void initPane(pane)
  })
}

// ── Tab / pane actions ──────────────────────────────────────────────────────────
const addTab = (activate: boolean, label: string | null = null): string => {
  const tabId = nextId('t')
  const pane = new Pane(nextId('p'), tabId)
  panes.set(pane.id, pane)
  tabs.value.push({
    id: tabId,
    label,
    layout: { kind: 'leaf', paneId: pane.id },
    activePaneId: pane.id,
  })
  if (activate || !activeTabId.value) activeTabId.value = tabId
  // The container mounts on next tick; the :ref callback then drives init.
  return tabId
}

// Duplicate → a fresh independent tab (same transport → same host/cwd), carrying the
// source's custom label with a " copy" suffix (default-labelled tabs stay default).
const duplicateTab = (tabId: string): void => {
  const source = tabById(tabId)
  const label = source?.label
    ? t('sessions.workspace.terminal.duplicateLabel', { name: source.label })
    : null
  addTab(true, label)
}

// Split the tab's active leaf along `dir` (row = new pane to the right, col = below).
// The tree grows in place; the new pane inits + spawns via its :ref callback, the
// existing panes refit via reattachAll + their ResizeObserver.
const splitTab = (tabId: string, dir: 'row' | 'col'): void => {
  const tab = tabById(tabId)
  if (!tab) return
  const targetPaneId = tab.activePaneId ?? paneIdsOf(tab)[0]
  if (!targetPaneId) return
  const pane = new Pane(nextId('p'), tabId)
  panes.set(pane.id, pane)
  tab.layout = splitLeaf(tab.layout, targetPaneId, pane.id, dir, false)
  tab.activePaneId = pane.id
  nextTick(reattachAll)
}

const renameTab = async (tabId: string): Promise<void> => {
  const tab = tabById(tabId)
  if (!tab) return
  const i = tabs.value.indexOf(tab)
  const current = tab.label ?? tabTitle(i)
  const name = await prompt({
    title: t('sessions.workspace.terminal.renameTitle'),
    value: current,
  })
  if (name === null) return
  const trimmed = name.trim()
  tab.label = trimmed === '' ? null : trimmed
}

const setActive = (id: string): void => {
  if (id === activeTabId.value) return
  activeTabId.value = id
  emitActiveConn()
  nextTick(() => syncTab(id))
}

// Clicking a pane makes it the tab's active pane (focus target on tab switch +
// accent highlight when split). Harmless no-op for a single-pane tab.
const setActivePane = (tabId: string, paneId: string): void => {
  const tab = tabById(tabId)
  if (!tab || tab.activePaneId === paneId) return
  tab.activePaneId = paneId
  emitActiveConn()
}

// Close just one pane of a split tab (kills its shell); closing the last pane closes
// the whole tab.
const closePane = (tabId: string, paneId: string): void => {
  const tab = tabById(tabId)
  if (!tab) return
  if (paneIdsOf(tab).length <= 1) {
    closeTab(tabId)
    return
  }
  const pane = panes.get(paneId)
  if (pane) disposePane(pane)
  panes.delete(paneId)
  tab.layout = removeLeaf(tab.layout, paneId)
  if (tab.activePaneId === paneId) {
    tab.activePaneId = paneIdsOf(tab)[0] ?? null
    emitActiveConn()
  }
  // Remaining panes grow back; re-attach + refit + refocus the active one.
  nextTick(() => {
    reattachAll()
    if (tab.id === activeTabId.value) activePaneOf(tab)?.term?.focus()
  })
}

// The tab's × closes the whole tab — kill + dispose every pane it owns.
const closeTab = (id: string): void => {
  const idx = tabs.value.findIndex((tt) => tt.id === id)
  const tab = idx >= 0 ? tabs.value[idx] : undefined
  if (tab) {
    for (const paneId of paneIdsOf(tab)) {
      const pane = panes.get(paneId)
      if (pane) disposePane(pane)
      panes.delete(paneId)
    }
  }
  if (idx >= 0) tabs.value.splice(idx, 1)
  if (activeTabId.value !== id) return
  // Activate the neighbour that slid into this slot (or the previous one).
  const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
  activeTabId.value = next?.id ?? null
  emitActiveConn()
  if (next) nextTick(() => syncTab(next.id))
}

// Wire the rendered DOM node back to its pane. On attach: adopt the node as the
// pane's box and RE-PARENT a surviving xterm into it (never re-init on a move); if
// the pane has no xterm yet, open one. On detach (el === null) we do nothing — a
// move re-mounts the box elsewhere (its attach updates pane.el) and reattachAll +
// explicit close/unmount own disposal, so we must NOT dispose here.
const setContainer = (id: string, el: unknown): void => {
  const pane = panes.get(id)
  if (!pane) return
  const node = el instanceof HTMLElement ? el : null
  if (!node) return
  pane.el = node
  if (pane.term) {
    const termEl = pane.term.element
    if (termEl && termEl.parentElement !== node) node.appendChild(termEl)
  } else if (props.ready) {
    void initPane(pane)
  }
}

// ── Drag-to-split / move ─────────────────────────────────────────────────────────
// Pointer-based (not HTML5 DnD) so the drop-zone overlay tracks the cursor exactly.
// Dragging starts on a pane's grip (never the terminal body). While dragging we
// hit-test the leaf under the cursor and compute an edge/centre zone; on release we
// split the target (edge) or swap the two panes (centre).
const drag = reactive<{
  paneId: string | null
  targetPaneId: string | null
  zone: DropZone | null
}>({ paneId: null, targetPaneId: null, zone: null })
const isDragging = computed(() => drag.paneId !== null)
const isResizing = ref(false)
// Teardown for the active window-level pointer listeners (drag or resize — only one
// at a time). Cleared on release + on unmount.
let pointerCleanup: (() => void) | null = null

// Which edge/centre of a box the cursor is over (thirds; nearest edge outside the
// centre third).
const zoneFor = (box: HTMLElement, x: number, y: number): DropZone => {
  const r = box.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return 'center'
  const fx = (x - r.left) / r.width
  const fy = (y - r.top) / r.height
  if (fx > 1 / 3 && fx < 2 / 3 && fy > 1 / 3 && fy < 2 / 3) return 'center'
  const dist = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy }
  const min = Math.min(dist.left, dist.right, dist.top, dist.bottom)
  if (min === dist.left) return 'left'
  if (min === dist.right) return 'right'
  if (min === dist.top) return 'top'
  return 'bottom'
}

const applyDrop = (tabId: string, sourceId: string, targetId: string, zone: DropZone): void => {
  const tab = tabById(tabId)
  if (!tab || sourceId === targetId) return
  if (zone === 'center') {
    swapPanes(tab.layout, sourceId, targetId)
  } else {
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
    const before = zone === 'left' || zone === 'top'
    // Pull the dragged leaf out first (collapsing its old split), then re-insert it
    // beside the target — the Pane (xterm + PTY) is untouched, only the tree moves.
    tab.layout = removeLeaf(tab.layout, sourceId)
    tab.layout = splitLeaf(tab.layout, targetId, sourceId, dir, before)
    tab.activePaneId = sourceId
  }
  nextTick(reattachAll)
}

const endDrag = (): void => {
  pointerCleanup?.()
  pointerCleanup = null
  drag.paneId = null
  drag.targetPaneId = null
  drag.zone = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

const onGripDown = (tabId: string, paneId: string, e: PointerEvent): void => {
  e.preventDefault()
  const tab = tabById(tabId)
  if (tab) tab.activePaneId = paneId
  drag.paneId = paneId
  drag.targetPaneId = null
  drag.zone = null
  document.body.style.cursor = 'grabbing'
  document.body.style.userSelect = 'none'

  const onMove = (ev: PointerEvent): void => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    const box = el instanceof HTMLElement ? el.closest<HTMLElement>('.wsterm-box') : null
    const overId = box?.dataset.paneId ?? null
    if (!box || !overId || overId === drag.paneId) {
      drag.targetPaneId = null
      drag.zone = null
      return
    }
    drag.targetPaneId = overId
    drag.zone = zoneFor(box, ev.clientX, ev.clientY)
  }
  const onUp = (): void => {
    const src = drag.paneId
    const tgt = drag.targetPaneId
    const zone = drag.zone
    endDrag()
    if (src && tgt && zone) applyDrop(tabId, src, tgt, zone)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  pointerCleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
}

// ── Splitter resize ──────────────────────────────────────────────────────────────
// Drag the divider between children[index-1] and children[index], shifting % between
// the two neighbours (basis stays 0; only the flex-grow weights move). Clamp each to
// a minimum so a pane can't vanish.
const MIN_PANE_PCT = 8
const onSplitterDown = (node: LayoutSplit, index: number, e: PointerEvent): void => {
  e.preventDefault()
  const splitter = e.currentTarget
  const container = splitter instanceof HTMLElement ? splitter.parentElement : null
  if (!container) return
  const horiz = node.dir === 'row'
  const total = horiz ? container.clientWidth : container.clientHeight
  if (total <= 0) return
  const start = horiz ? e.clientX : e.clientY
  const a = index - 1
  const b = index
  const sa = node.sizes[a] ?? 0
  const sb = node.sizes[b] ?? 0
  isResizing.value = true
  document.body.style.cursor = horiz ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'

  const onMove = (ev: PointerEvent): void => {
    const pos = horiz ? ev.clientX : ev.clientY
    let delta = ((pos - start) / total) * 100
    if (sa + delta < MIN_PANE_PCT) delta = MIN_PANE_PCT - sa
    if (sb - delta < MIN_PANE_PCT) delta = sb - MIN_PANE_PCT
    node.sizes[a] = sa + delta
    node.sizes[b] = sb - delta
  }
  const onUp = (): void => {
    pointerCleanup?.()
    pointerCleanup = null
    isResizing.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  pointerCleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
}

// Context injected into every recursive node so it can render + interact without
// prop-drilling through each split level.
const nodeCtx: TerminalNodeCtx = {
  paneCount: (tabId) => {
    const tab = tabById(tabId)
    return tab ? paneIdsOf(tab).length : 0
  },
  activePaneId: (tabId) => tabById(tabId)?.activePaneId ?? null,
  setContainer,
  setActivePane,
  closePane,
  onGripDown,
  onSplitterDown,
  dragTargetZone: (paneId) => (drag.paneId && drag.targetPaneId === paneId ? drag.zone : null),
  isDragSource: (paneId) => drag.paneId === paneId,
}
provide(TERM_CTX, nodeCtx)

// ── Context menu ────────────────────────────────────────────────────────────────
const menu = useContextMenu<string>()
const menuItems = computed<MenuItem[]>(() => [
  { id: 'rename', label: t('sessions.workspace.terminal.rename'), icon: 'edit' },
  { id: 'duplicate', label: t('sessions.workspace.terminal.duplicate'), icon: 'copy' },
  { id: 'split-right', label: t('sessions.workspace.terminal.splitRight'), icon: 'dock-right' },
  { id: 'split-down', label: t('sessions.workspace.terminal.splitDown'), icon: 'dock-bottom' },
])
const onMenuSelect = (id: string): void => {
  const tabId = menu.target.value
  if (!tabId) return
  if (id === 'rename') void renameTab(tabId)
  else if (id === 'duplicate') duplicateTab(tabId)
  else if (id === 'split-right') splitTab(tabId, 'row')
  else if (id === 'split-down') splitTab(tabId, 'col')
}

// ── Wiring ────────────────────────────────────────────────────────────────────
// Live-apply terminal appearance to every open pane. Fires only when the user
// changes preset / size / font (the default 'system'/13/mono values are stable →
// this stays dormant → no change by default). Font metrics change → refit.
watch([() => appearance.theme, () => appearance.fontSize, () => appearance.fontFamily], () => {
  const nextTheme = resolveTheme()
  for (const pane of panes.values()) {
    if (!pane.term) continue
    pane.term.options.theme = nextTheme
    pane.term.options.fontSize = appearance.fontSize
    pane.term.options.fontFamily = appearance.fontFamily
  }
  nextTick(() => {
    for (const pane of panes.values()) if (pane.term) syncSize(pane)
  })
})

watch(
  () => props.visible,
  (v) => {
    if (!v || !activeTabId.value) return
    syncTab(activeTabId.value)
  },
)

// The root may resolve after mount — init the active tab's panes once it's ready + visible.
watch([() => props.ready, () => props.visible], () => {
  if (!props.ready || !props.visible) return
  if (!tabs.value.length) addTab(true)
  if (activeTabId.value) initTabPanes(activeTabId.value)
})

onMounted(() => {
  if (!tabs.value.length) addTab(true)
  if (props.visible && props.ready && activeTabId.value) initTabPanes(activeTabId.value)
})

onBeforeUnmount(() => {
  pointerCleanup?.()
  pointerCleanup = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (unlisten) unlisten()
  unlisten = null
  // Kill every PTY + dispose every xterm (close ALL panes on unmount).
  for (const pane of panes.values()) disposePane(pane)
  panes.clear()
})
</script>

<style scoped>
.wsterm {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}
.wsterm-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 4px 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
}
.wsterm-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 5px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--textDim);
  font-size: 1em;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.wsterm-tab:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wsterm-tab.active {
  background: var(--bgActive);
  color: var(--text);
}
.wsterm-tab-label {
  display: inline-block;
}
.wsterm-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--textDim);
}
.wsterm-tab-close:hover {
  background: var(--dangerBg, var(--bgHover));
  color: var(--danger, var(--text));
}
.wsterm-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  flex: 0 0 auto;
  margin-left: 2px;
  border: none;
  background: transparent;
  color: var(--textDim);
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.wsterm-tab-add:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wsterm-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
/* Per-tab layer: fills the stage; its single child is the tab's split-tree root
   (a lone leaf box for a single-pane tab — identical to before the split feature). */
.wsterm-panes {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Breathing-room gutter for the terminal(s). Lives HERE, not on `.wsterm-box`,
     because FitAddon measures the box's padding-inclusive clientHeight and would
     consume box padding (→ extra clipped row). Panes isn't measured, so this is a
     true gap. Painted with the terminal bg so it reads as internal padding. */
  padding: 6px 10px 12px;
  background: var(--wsterm-bg, var(--bg));
}
/* While a pane is being dragged or a splitter resized, suppress selection across the
   whole widget (the grabbing/resize cursor itself is set on <body>). */
.wsterm--dragging,
.wsterm--resizing {
  user-select: none;
}
</style>

<style>
/* Slim, subtle scrollbar for the xterm viewport. xterm renders its own DOM (not in
   Vue's scoped tree), so this is a plain global block. A translucent neutral thumb
   reads on both dark + light terminal themes — the app's global bar is colored with
   app tokens (light-gray in light mode) which looks wrong on the terminal's own,
   independently-themed background. */
.xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: rgba(140, 140, 140, 0.35) transparent;
}
.xterm-viewport::-webkit-scrollbar {
  width: 9px;
}
.xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}
.xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(140, 140, 140, 0.32);
  border-radius: 99px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(140, 140, 140, 0.55);
  background-clip: padding-box;
}
</style>
