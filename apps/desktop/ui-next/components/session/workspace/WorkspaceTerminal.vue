<template>
  <div class="wsterm">
    <div v-if="errorMsg || !ready" class="empty" style="padding: 30px">
      <div class="et">{{ errorMsg ?? unavailableMsg }}</div>
    </div>

    <template v-else>
      <!-- Tab strip: one tab per independent PTY. -->
      <div class="wsterm-tabs" role="tablist">
        <button
          v-for="(tab, i) in tabs"
          :key="tab.id"
          class="wsterm-tab"
          :class="{ active: tab.id === activeTabId }"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          :title="tabTitle(i)"
          @click="setActive(tab.id)"
        >
          <span class="wsterm-tab-label">{{ tabTitle(i) }}</span>
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

      <!-- One xterm container per tab; only the active one is shown (hidden tabs
           keep their PTY + buffer). The ref callback wires each DOM node back to
           its tab so init can open xterm into the right element. -->
      <div class="wsterm-stage">
        <div
          v-for="tab in tabs"
          v-show="tab.id === activeTabId"
          :key="tab.id"
          :ref="(el) => setContainer(tab.id, el)"
          class="wsterm-box"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Terminal tab (§5/§10) — real PTY via terminal.create/write/resize/kill, output
// streamed through sc.onEvent (terminal.data / terminal.exit). Multi-tab: each UI
// tab owns its own independent PTY + xterm instance + early-output buffer, all
// sharing one PTY grouping key. Switching tabs only hides/shows (never kills) —
// every PTY is killed on tab close / component unmount.
//
// SoC: this widget knows only a cwd + a grouping key, NOT sessions or projects.
// Two hosts use it: the session workspace panel (cwd = project root, key
// `ses:<id>`) and the app-wide GlobalTerminalHost (cwd = "~", key `global`).
// Degrades to an empty state when the engine bridge / cwd is absent.
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Plus, X } from 'lucide-vue-next'
import { useSidecar, type SidecarEvent, type UnlistenFn } from '~/composables/useSidecar'
import { useTerminalApi } from '~/composables/useTerminalApi'
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
}>()

const { t } = useI18n()
const sc = useSidecar()
const api = useTerminalApi()

const errorMsg = ref<string | null>(null)

const unavailableMsg = computed(
  () =>
    props.unavailableLabel ??
    (sc.available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable')),
)

const tabTitle = (i: number): string => t('sessions.workspace.terminal.tabTitle', { n: i + 1 })

// Read CSS theme tokens off the live document so xterm matches the active theme.
const cssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// ── Per-tab state ─────────────────────────────────────────────────────────────
// Each tab encapsulates one xterm + FitAddon + PTY id + the early-output buffer.
// Events that arrive between PTY spawn and us learning its terminalId are buffered
// per tab; otherwise the first burst (instant prompt) is lost and xterm starts
// parsing mid-escape-sequence → garbage. Kept off the reactive system (class +
// non-reactive maps) — only `id` lives in the reactive `tabs` list.
class TerminalTab {
  readonly id: string

  el: HTMLElement | null = null

  term: Terminal | null = null

  fit: FitAddon | null = null

  terminalId: string | null = null

  resizeObserver: ResizeObserver | null = null

  creating = false

  pending: SidecarEvent[] = []

  constructor(id: string) {
    this.id = id
  }
}

type TabRef = { id: string }

const tabs = ref<TabRef[]>([])
const activeTabId = ref<string | null>(null)
// Non-reactive lookup of the heavy per-tab state (xterm is large; never proxy it).
const instances = new Map<string, TerminalTab>()
// Single shared sidecar event listener; routes by terminalId to the owning tab.
let unlisten: UnlistenFn | null = null
let seq = 0

const newId = (): string => `t${++seq}`

// ── Event routing ─────────────────────────────────────────────────────────────
const routeEvent = (tab: TerminalTab, evt: SidecarEvent): void => {
  const payload = evt.payload as { terminalId?: string; chunk?: string; exitCode?: number }
  if (payload?.terminalId !== tab.terminalId || !tab.term) return
  if (evt.type === 'terminal.data' && typeof payload.chunk === 'string') {
    tab.term.write(payload.chunk)
  } else if (evt.type === 'terminal.exit') {
    tab.term.write(
      `\r\n\x1b[90m[${t('sessions.workspace.terminal.exited')} ${payload.exitCode ?? 0}]\x1b[0m\r\n`,
    )
    tab.terminalId = null
  }
}

const onSidecarEvent = (evt: SidecarEvent): void => {
  if (evt.type !== 'terminal.data' && evt.type !== 'terminal.exit') return
  const payload = evt.payload as { terminalId?: string }
  for (const tab of instances.values()) {
    if (!tab.terminalId) {
      // Not yet bound — buffer for whichever tab claims this id once it knows it.
      tab.pending.push(evt)
      continue
    }
    if (tab.terminalId === payload?.terminalId) {
      routeEvent(tab, evt)
      return
    }
  }
}

// ── PTY lifecycle ─────────────────────────────────────────────────────────────
// Spawn the PTY at the terminal's real fitted size. The shared data listener is
// already attached (see ensureListener) so no early output is dropped.
const createPty = async (tab: TerminalTab, cols: number, rows: number): Promise<void> => {
  if (tab.terminalId || tab.creating || !tab.term || !props.root) return
  const cwd = props.root
  tab.creating = true
  try {
    const result = await api.create(cwd, props.ptyKey, cols, rows)
    tab.terminalId = result.terminalId
  } catch (err) {
    errorMsg.value =
      err instanceof Error ? err.message : t('sessions.workspace.terminal.unavailable')
    return
  } finally {
    tab.creating = false
  }

  const instance = tab.term
  instance.onData((data) => {
    if (tab.terminalId) api.write(tab.terminalId, data).catch(() => undefined)
  })

  // Flush buffered early output that belongs to this PTY; drop the rest of the
  // buffer (events for other tabs are buffered on their own tab).
  const buffered = tab.pending
  tab.pending = []
  buffered.forEach((evt) => routeEvent(tab, evt))
}

const syncSize = (tab: TerminalTab): void => {
  const container = tab.el
  if (!tab.fit || !tab.term || !container) return
  if (container.clientWidth === 0 || container.clientHeight === 0) return
  try {
    tab.fit.fit()
  } catch {
    // container not measurable yet — ignore
  }
  const { cols, rows } = tab.term
  if (!tab.terminalId) {
    void createPty(tab, cols, rows)
  } else {
    api.resize(tab.terminalId, cols, rows).catch(() => undefined)
  }
}

// Attach the shared sidecar listener once, before any PTY can exist. Buffering in
// onSidecarEvent keeps early bursts until each tab learns its terminalId.
const ensureListener = async (): Promise<void> => {
  if (unlisten || !sc.available) return
  unlisten = await sc.onEvent(onSidecarEvent)
}

// Open xterm into the tab's container (once the DOM node + root are ready).
const initTab = async (tab: TerminalTab): Promise<void> => {
  const container = tab.el
  if (!container || tab.term || !props.ready) return

  await ensureListener()

  const instance = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    theme: {
      background: cssVar('--bg', '#0d0d0d'),
      foreground: cssVar('--text', '#e5e5e5'),
      cursor: cssVar('--accent', '#3b82f6'),
      selectionBackground: cssVar('--accent', '#3b82f6'),
      selectionForeground: cssVar('--accentText', '#ffffff'),
    },
  })
  tab.fit = new FitAddon()
  instance.loadAddon(tab.fit)
  instance.open(container)
  tab.term = instance

  // Copy/paste: xterm doesn't bind these by default. Cmd+C/V (mac) +
  // Ctrl+Shift+C/V (win/linux); plain Ctrl+C stays SIGINT.
  instance.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const wantsCopy =
      (e.metaKey && e.code === 'KeyC') || (e.ctrlKey && e.shiftKey && e.code === 'KeyC')
    if (wantsCopy && instance.hasSelection()) {
      navigator.clipboard.writeText(instance.getSelection()).catch(() => undefined)
      return false
    }
    const wantsPaste =
      (e.metaKey && e.code === 'KeyV') || (e.ctrlKey && e.shiftKey && e.code === 'KeyV')
    if (wantsPaste) {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (tab.terminalId && text) api.write(tab.terminalId, text).catch(() => undefined)
        })
        .catch(() => undefined)
      return false
    }
    return true
  })

  tab.resizeObserver = new ResizeObserver(() => {
    if (tab.id === activeTabId.value) syncSize(tab)
  })
  tab.resizeObserver.observe(container)
  syncSize(tab)
}

// Dispose one tab's xterm + PTY (no list mutation — caller owns `tabs`).
const disposeTab = (tab: TerminalTab): void => {
  tab.resizeObserver?.disconnect()
  tab.resizeObserver = null
  if (tab.terminalId) api.kill(tab.terminalId).catch(() => undefined)
  tab.terminalId = null
  tab.term?.dispose()
  tab.term = null
  tab.fit = null
  tab.el = null
}

// ── Tab actions ───────────────────────────────────────────────────────────────
const addTab = (activate: boolean): string => {
  const id = newId()
  instances.set(id, new TerminalTab(id))
  tabs.value.push({ id })
  if (activate || !activeTabId.value) activeTabId.value = id
  // The container mounts on next tick; the :ref callback then drives init.
  return id
}

const setActive = (id: string): void => {
  if (id === activeTabId.value) return
  activeTabId.value = id
  nextTick(() => {
    const tab = instances.get(id)
    if (tab) {
      syncSize(tab)
      tab.term?.focus()
    }
  })
}

const closeTab = (id: string): void => {
  const idx = tabs.value.findIndex((tt) => tt.id === id)
  const tab = instances.get(id)
  if (tab) disposeTab(tab)
  instances.delete(id)
  if (idx >= 0) tabs.value.splice(idx, 1)
  if (activeTabId.value !== id) return
  // Activate the neighbour that slid into this slot (or the previous one).
  const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
  activeTabId.value = next?.id ?? null
  if (next) {
    nextTick(() => {
      const nextTab = instances.get(next.id)
      if (nextTab) {
        syncSize(nextTab)
        nextTab.term?.focus()
      }
    })
  }
}

// Wire the rendered DOM node back to its tab and lazily init xterm into it. The
// template ref hands an `Element | ComponentPublicInstance | null`; narrow at the
// boundary rather than casting in the template.
const setContainer = (id: string, el: unknown): void => {
  const tab = instances.get(id)
  if (!tab) return
  const node = el instanceof HTMLElement ? el : null
  if (node && tab.el !== node) {
    tab.el = node
    if (props.ready) void initTab(tab)
  } else if (!node) {
    tab.el = null
  }
}

// ── Wiring ────────────────────────────────────────────────────────────────────
watch(
  () => props.visible,
  (v) => {
    if (!v || !activeTabId.value) return
    const tab = instances.get(activeTabId.value)
    if (tab) {
      syncSize(tab)
      tab.term?.focus()
    }
  },
)

// The root may resolve after mount — init the active tab once it's ready + visible.
watch([() => props.ready, () => props.visible], () => {
  if (!props.ready || !props.visible) return
  if (!tabs.value.length) addTab(true)
  const tab = activeTabId.value ? instances.get(activeTabId.value) : undefined
  if (tab && !tab.term) void initTab(tab)
})

onMounted(() => {
  if (!tabs.value.length) addTab(true)
  if (props.visible && props.ready) {
    const tab = activeTabId.value ? instances.get(activeTabId.value) : undefined
    if (tab) void initTab(tab)
  }
})

onBeforeUnmount(() => {
  if (unlisten) unlisten()
  unlisten = null
  // Kill every PTY + dispose every xterm (close ALL on unmount).
  for (const tab of instances.values()) disposeTab(tab)
  instances.clear()
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
.wsterm-box {
  position: absolute;
  inset: 0;
  overflow: hidden;
  padding: 4px;
}
</style>
