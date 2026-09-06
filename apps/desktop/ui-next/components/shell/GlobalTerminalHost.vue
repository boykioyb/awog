<template>
  <!-- App-wide terminal dock. Lives in the layout flex column ABOVE the status
       bar, so when open it pushes the page up (a real panel, not an overlay).
       `v-show` (display:none when closed) removes it from the flex flow entirely
       while keeping the inner terminal mounted so its PTY + scrollback survive a
       close → reopen. When collapsed the dock shrinks to just this header (the
       body is hidden but its PTYs live on — an in-place "roll-up" minimize). -->
  <section
    v-show="isOpen"
    ref="rootEl"
    class="gterm"
    :class="{ 'gterm--collapsed': collapsed }"
    :style="dockStyle"
    :aria-hidden="!isOpen"
  >
    <!-- Top-edge resize handle: drag up to grow the dock. Hidden while collapsed
         (nothing to resize). -->
    <div
      v-if="!collapsed"
      class="gterm-rsz"
      role="separator"
      aria-orientation="horizontal"
      :title="t('terminalGlobal.resize')"
      @pointerdown="onResize"
    />

    <!-- Clicking a collapsed header bar rolls the dock back open. -->
    <header class="gterm-head" :class="{ 'gterm-head--clickable': collapsed }" @click="onHeadClick">
      <span class="gterm-dot" :class="`gterm-dot--${dotState}`" :title="dotTitle" />
      <span class="gterm-title">
        <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('terminalGlobal.title') }}
      </span>
      <span class="gterm-cwd" :title="cwdTitle">{{ cwdLabel }}</span>
      <button
        class="gterm-btn gterm-btn--lead"
        :class="{ 'gterm-btn--on': snippetsOpen }"
        :title="t('terminalSnippet.toggle')"
        :aria-label="t('terminalSnippet.toggle')"
        @click.stop="onToggleSnippets"
      >
        <ScrollText :size="14" />
      </button>
      <button
        class="gterm-btn"
        :title="collapsed ? t('terminalGlobal.expand') : t('terminalGlobal.collapse')"
        :aria-label="collapsed ? t('terminalGlobal.expand') : t('terminalGlobal.collapse')"
        @click.stop="toggleCollapse"
      >
        <component :is="collapsed ? ChevronUp : ChevronDown" :size="14" />
      </button>
      <button
        class="gterm-btn"
        :title="t('terminalGlobal.close')"
        :aria-label="t('terminalGlobal.close')"
        @click.stop="close"
      >
        <X :size="14" />
      </button>
    </header>

    <div v-show="!collapsed" class="gterm-body">
      <div class="gterm-main">
        <!-- One WorkspaceTerminal instance PER open project tab, ALL mounted at once
             and toggled with v-show — only the active tab's is shown; the rest stay
             mounted-but-hidden so their tab set + live PTYs survive a switch away and
             back (v-show never unmounts). Closing a project tab drops its instance
             (killing its PTYs). Each instance's `root` follows the cwd it was last
             active with; new tabs spawn there while already-open tabs keep their cwd. -->
        <WorkspaceTerminal
          v-for="key in mountedKeys"
          v-show="key === projectKey"
          :key="key"
          :ref="(el) => setTermRef(key, el)"
          :root="rootByKey[key] ?? '~'"
          :ready="sc.available"
          :pty-key="`global:${key}`"
          :visible="key === projectKey && isOpen && !collapsed"
          :new-tab-menu="newTabMenu"
          :unavailable-label="t('terminalGlobal.unavailable')"
          @conn="onConn(key, $event)"
        />
      </div>

      <!-- Project-scoped snippets rail (current project + the shared Global tier).
           Run writes into the active tab via that tab's own transport. -->
      <TerminalSnippetsRail
        v-if="snippetsOpen"
        :project="currentProject"
        :project-label="currentProjectLabel"
        :can-run="!!activeConnId"
        @run="onRunSnippet"
        @close="setSnippetsOpen(false)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
// Global terminal dock — single app-lifetime mount in the default layout. The status
// bar's always-visible Terminal button toggles it via useGlobalTerminal. OPEN/CLOSE is
// PER PROJECT (useGlobalTerminal.openByKey, keyed by the open tab): opening it in
// project A and closing it in B is remembered independently — return to A → shown open;
// stay on B → shown closed.
// Its cwd + tab set FOLLOW the OPEN PROJECT TAB (sessions.activeTab): each open
// project gets its OWN WorkspaceTerminal instance, all mounted at once and toggled
// by v-show (see `mountedKeys` — NOT <KeepAlive>, whose v-if child would unmount +
// kill PTYs on switch), so switching tabs restores the exact terminals you left and
// closing a project tab disposes its terminal. Falls back to a single "home" terminal
// (cwd "~") for the Default tab. The heavy PTY + xterm logic is reused from the
// (session-agnostic) WorkspaceTerminal.
import { ChevronDown, ChevronUp, ScrollText, X } from 'lucide-vue-next'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'
import { useSidecar } from '~/composables/useSidecar'
import { useSshApi } from '~/composables/useSshApi'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useSshStore } from '~/stores/ssh'
import type { TerminalTabKind, TerminalTransport } from '~/composables/useTerminalApi'

const { t } = useI18n()

const sc = useSidecar()
const {
  isOpen,
  setActiveKey,
  height,
  collapsed,
  snippetsOpen,
  close,
  toggleCollapse,
  setCollapsed,
  toggleSnippets,
  setSnippetsOpen,
  setHeight,
} = useGlobalTerminal()

// Left inset published by the page that owns a leading rail (the Sessions list), so the
// dock lines up with the DETAIL column instead of running under that rail. 0 on every
// other page. Height only applies while expanded — collapsed the header IS the dock.
const { inset, setDockHeight } = useDockMetrics()
const rootEl = useTemplateRef<HTMLElement>('rootEl')
const dockStyle = computed(() => ({
  marginLeft: `${inset.value}px`,
  ...(collapsed.value ? {} : { height: `${height.value}px` }),
}))

// Publish the dock's REAL height (measured, not derived from `height` — the header has
// its own height when collapsed, and each theme pads it differently). The column beneath
// reserves exactly this much, so the composer never hides behind the panel. Closed →
// `v-show` sets display:none, offsetHeight is 0, which is precisely the value we want.
// OUTER height: the space to reserve is the box PLUS its vertical margins, because a
// theme may float the panel off the window edge (the Cute theme insets it by 10px). Using
// offsetHeight alone left the composer clipped by exactly that margin. Closed → display
// is none, offsetHeight is 0, and the margins must not be counted either.
function measure(el: HTMLElement): number {
  if (!el.offsetHeight) return 0
  const cs = getComputedStyle(el)
  return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0)
}
onMounted(() => {
  const el = rootEl.value
  if (!el) return
  const ro = new ResizeObserver(() => setDockHeight(measure(el)))
  ro.observe(el)
  setDockHeight(measure(el))
  onBeforeUnmount(() => ro.disconnect())
})
// `v-show` toggling display does not resize the element, so ResizeObserver stays silent on
// open/close — mirror those transitions explicitly.
watch([isOpen, collapsed], () => {
  void nextTick(() => setDockHeight(rootEl.value ? measure(rootEl.value) : 0))
})

// Live backend id of the active tab's active pane (null → no shell to run into).
const activeConnId = ref<string | null>(null)

// One WorkspaceTerminal instance per project, mounted simultaneously and toggled
// with v-show (NOT <KeepAlive> — a `v-if` child defeats its caching, unmounting the
// instance on project switch → PTYs killed → the shell "renews" on return). A hidden
// v-show'd instance is never unmounted, so its tabs + live PTYs survive untouched.
// `mountedKeys` holds one key per project the dock has shown; it is bounded by the
// OPEN project tabs — closing a tab drops that project's terminal (see the prune
// watch below). No arbitrary cap: "open tab" is the meaningful, self-limiting bound.
const mountedKeys = ref<string[]>([])
// Last-resolved cwd per key (drives `root` for each instance; the active key's entry
// tracks the live termRoot, so new tabs spawn in the right project).
const rootByKey = reactive<Record<string, string>>({})
// Exposed { runText } of each mounted instance, keyed by project — so a snippet runs
// against the ACTIVE project's terminal. Non-reactive (function-ref bookkeeping).
const termRefs = new Map<string, { runText: (text: string) => void }>()
function setTermRef(key: string, el: unknown): void {
  if (el) termRefs.set(key, el as { runText: (text: string) => void })
  else termRefs.delete(key)
}
// Only the active project's terminal reports its live conn (hidden ones are ignored).
function onConn(key: string, id: string | null): void {
  if (key === projectKey.value) activeConnId.value = id
}

// Header status dot — read-only derivation from state this component already
// tracks, no new IPC/store: 'off' when the engine bridge is absent (sc.available),
// else 'live' when the visible project's active pane has reported a real backend
// id via onConn (a spawned PTY), else 'idle' (dock open/mounted but nothing
// connected yet, e.g. still spawning).
const dotState = computed<'live' | 'idle' | 'off'>(() => {
  if (!sc.available) return 'off'
  return activeConnId.value ? 'live' : 'idle'
})
const dotTitle = computed(() => t(`terminalGlobal.status.${dotState.value}`))

// Expand the roll-up when the collapsed header bar is clicked (buttons stop
// propagation, so only the bar itself triggers this).
function onHeadClick(): void {
  if (collapsed.value) setCollapsed(false)
}

// The dock FOLLOWS THE OPEN PROJECT TAB, not the active session. `sessions.activeTab`
// is the projectId of the currently-selected tab ('' = the Default/home tab) — broader
// than `sessions.active?.project`: a tab can be selected with no active session (empty
// project), and switching tabs must move the terminal before any session is clicked.
// Keying off the session's project instead would strand the dock on "home" whenever a
// freshly-opened project tab has no active session yet.
const HOME_KEY = '__home__'
const sessions = useSessionsStore()

// Stable per-project key (also the PTY grouping key). Two sessions in the same project
// share one terminal set; the Default tab ('') maps to a single "home" set.
const projectKey = computed(() => sessions.activeTab || HOME_KEY)

// cwd of the open tab's project ('' → undefined → "~"). When the active session belongs
// to THIS tab, honor its dragged working-folder override; otherwise use the project's
// on-disk path (two sessions of one project share the terminal). Reactive → switching
// tabs re-points it; new terminal tabs spawn there while already-open tabs keep their cwd.
const { root: projectRoot } = useWorkspaceData(() => sessions.activeTab || undefined)
const termRoot = computed(() => {
  const s = sessions.active
  if (s && s.project === sessions.activeTab && s.workspaceFolder) return s.workspaceFolder
  return projectRoot.value || '~'
})

// Keep the composable's notion of "active project" in sync with the open tab, so the
// per-project open/close (isOpen) + open/close/toggle act on the project the dock is
// showing. Declared BEFORE the mount watch so, on a tab switch, activeKey (and thus
// isOpen) is updated before the mount watch reads isOpen in the same flush.
watch(projectKey, setActiveKey, { immediate: true })

// Mount a project's terminal the first time its dock is open for that project, then
// keep it mounted (hidden via v-show) so its shell + scrollback survive a close→reopen
// or a project switch. Pruned only when the project's TAB closes (below). `rootByKey`
// always tracks the latest cwd so a later open spawns in the right place.
watch(
  [isOpen, projectKey, termRoot],
  ([open, key, root]) => {
    rootByKey[key] = root
    if (open && !mountedKeys.value.includes(key)) mountedKeys.value.push(key)
  },
  { immediate: true },
)

// Follow project open/close: when a project tab is closed, drop its terminal from
// `mountedKeys` → the WorkspaceTerminal unmounts → its onBeforeUnmount kills that
// project's PTYs. The home terminal (HOME_KEY, for the Default tab) is never a real
// project tab, so it's kept as long as it's been visited. `openProjectTabs` is always
// reassigned, so this shallow watch fires on every open/close.
watch(
  () => sessions.openProjectTabs,
  (open) => {
    const alive = new Set(open)
    mountedKeys.value = mountedKeys.value.filter((k) => k === HOME_KEY || alive.has(k))
    for (const key of Object.keys(rootByKey)) {
      if (key !== HOME_KEY && !alive.has(key)) delete rootByKey[key]
    }
  },
)

// Real project for snippet scoping (null = no project → only Global snippets).
const { projectName } = useProjects()
const currentProject = computed(() => sessions.activeTab || null)
const currentProjectLabel = computed(() =>
  currentProject.value ? projectName(currentProject.value) : '',
)

// Run a snippet: append a newline so it executes, then write into the ACTIVE
// project's terminal (which picks the right transport for local vs SSH tabs).
function onRunSnippet(command: string): void {
  termRefs.get(projectKey.value)?.runText(`${command}\n`)
}

// Toggle the snippets rail; opening it while collapsed also expands the dock so
// the rail is actually visible.
function onToggleSnippets(): void {
  if (collapsed.value) setCollapsed(false)
  toggleSnippets()
}

// Header label: the folder name (last path segment), or "~" for home.
const cwdLabel = computed(() => {
  const r = termRoot.value
  if (r === '~') return '~'
  return r.split('/').filter(Boolean).pop() || r
})
const cwdTitle = computed(() =>
  termRoot.value === '~' ? t('terminalGlobal.cwdHint') : termRoot.value,
)

// ── SSH tabs ────────────────────────────────────────────────────────────────
// Let the dock open interactive SSH shells alongside local ones. The "+" menu is
// "New shell" plus one entry per saved host; each SSH entry carries a transport
// bound to its hostId (mirrors SshTerminal's adapter). The host-key TOFU prompt is
// rendered app-wide (SshHostKeyHost in the layout), so an SSH connect from any page
// resolves. The store is loaded here (always-mounted host) so hosts + the host-key
// subscription are live regardless of whether the /ssh page was visited.
const ssh = useSshStore()
const sshApi = useSshApi()

const makeSshTransport = (hostId: string): TerminalTransport => ({
  create: (cols, rows) => sshApi.connect(hostId, cols, rows).then((r) => ({ id: r.connId })),
  write: (id, data) => sshApi.write(id, data),
  resize: (id, cols, rows) => sshApi.resize(id, cols, rows),
  kill: (id) => sshApi.disconnect(id),
  dataEvent: 'ssh:data',
  exitEvent: 'ssh:exit',
  idField: 'connId',
})

// Undefined when there are no saved hosts → "+" just adds a plain local shell (no
// one-item dropdown). Otherwise the dropdown offers "New shell" + each host.
const newTabMenu = computed<TerminalTabKind[] | undefined>(() => {
  if (!ssh.hosts.length) return undefined
  return [
    { id: 'local', label: t('terminalGlobal.newShell'), icon: 'terminal' },
    ...ssh.hosts.map((h) => ({
      id: `ssh:${h.id}`,
      label: h.name,
      icon: 'ssh',
      transport: makeSshTransport(h.id),
    })),
  ]
})

onMounted(() => {
  // Populates ssh.hosts + subscribes to ssh:host-key-prompt app-wide (idempotent
  // with the /ssh page's own load). No-op without the bridge.
  void ssh.loadAll()
})

// Drag the top edge: moving up (clientY decreases) grows the dock.
function onResize(ev: PointerEvent): void {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  const startY = ev.clientY
  const startH = height.value
  const onMove = (e: PointerEvent): void => setHeight(startH + (startY - e.clientY))
  const onUp = (): void => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}
</script>

<style scoped>
/* The dock FLOATS over the bottom of `.main` rather than sitting in its flex column.
   In the column it took height from the whole page row, which shortened the Sessions
   list and left a dead gap beneath it; floating means only the column it covers has to
   reserve room (app-shell.css does that with `--awog-dock-h`, published from here).
   `.main` is the containing block (app-shell.css gives it position:relative), and being
   positioned also keeps `.gterm-rsz` anchored to this box as before.
   This lives HERE, not in app-shell.css: a scoped selector compiles to
   `.gterm[data-v-hash]` (0,2,0) and would outrank a bare `.gterm` rule in a global
   stylesheet — the earlier attempt to set `position` from app-shell.css silently lost. */
.gterm {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  /* Page band (page ≤61 · detail 80/81 · drawer 90-92 · modal 100-300). */
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
/* Thin grab strip straddling the top border. */
.gterm-rsz {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 7px;
  cursor: ns-resize;
  z-index: 1;
}
.gterm-rsz:hover {
  background: var(--accentDim);
}
.gterm-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
}
/* Collapsed: the header is the whole dock, so its bottom border is redundant and
   the whole bar becomes a click target to expand. */
.gterm--collapsed .gterm-head {
  border-bottom: 0;
}
.gterm-head--clickable {
  cursor: pointer;
}
/* Status dot: live PTY (accent, breathing), mounted-but-idle (dim), sidecar
   unavailable (danger). Read-only reflection of dotState — see script setup. */
.gterm-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--textFaint);
}
.gterm-dot--live {
  background: var(--accent);
  animation: gterm-dot-breathe 1.6s ease-in-out infinite;
}
.gterm-dot--idle {
  background: var(--textFaint);
}
.gterm-dot--off {
  background: var(--danger);
}
@keyframes gterm-dot-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .gterm-dot--live {
    animation: none;
  }
}
.gterm-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}
.gterm-cwd {
  color: var(--textDim);
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
}
.gterm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
/* First button of the right cluster (Snippets) pushes the cluster to the edge. */
.gterm-btn--lead {
  margin-left: auto;
}
.gterm-btn:hover {
  color: var(--text);
  background: var(--bgHover);
}
/* Active toggle (snippets rail open) — accent tint, no solid gray fill. Declared
   after :hover so it wins for the open state (equal specificity, later source). */
.gterm-btn--on,
.gterm-btn--on:hover {
  color: var(--accent);
  background: var(--accentDim);
}
.gterm-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.gterm-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
/* Terminal column: yields all remaining width to the (fixed-width) snippets rail. */
.gterm-main {
  flex: 1;
  min-width: 0;
  height: 100%;
}
</style>
