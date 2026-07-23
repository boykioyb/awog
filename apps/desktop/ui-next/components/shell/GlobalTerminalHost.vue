<template>
  <!-- App-wide terminal dock. Lives in the layout flex column ABOVE the status
       bar, so when open it pushes the page up (a real panel, not an overlay).
       `v-show` (display:none when closed) removes it from the flex flow entirely
       while keeping the inner terminal mounted so its PTY + scrollback survive a
       close → reopen. When collapsed the dock shrinks to just this header (the
       body is hidden but its PTYs live on — an in-place "roll-up" minimize). -->
  <section
    v-show="isOpen"
    class="gterm"
    :class="{ 'gterm--collapsed': collapsed }"
    :style="collapsed ? undefined : { height: `${height}px` }"
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
      <span class="gterm-title">
        <Icon name="commands" style="width: 13px; height: 13px" />
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
        <!-- One WorkspaceTerminal instance PER project, cached by <KeepAlive> keyed
             on the active session's project (or a home key when none). Switching
             project deactivates the old instance (its PTYs survive — onBeforeUnmount
             doesn't fire on KeepAlive deactivate) and activates/creates the new one,
             so each project keeps its own tab set + live shells. `root` follows the
             active session's cwd (dragged folder → project path → home). -->
        <KeepAlive :max="4">
          <WorkspaceTerminal
            v-if="everOpened"
            ref="termRef"
            :key="projectKey"
            :root="termRoot"
            :ready="sc.available"
            :pty-key="`global:${projectKey}`"
            :visible="isOpen && !collapsed"
            :new-tab-menu="newTabMenu"
            :unavailable-label="t('terminalGlobal.unavailable')"
            @conn="activeConnId = $event"
          />
        </KeepAlive>
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
// Global terminal dock — single app-lifetime mount in the default layout. The
// status bar's always-visible Terminal button toggles it via useGlobalTerminal.
// Its cwd + tab set FOLLOW the active session's project: each project gets its
// own cached WorkspaceTerminal (KeepAlive keyed by project), so returning to a
// project restores the exact terminals you left there. Falls back to a single
// "home" terminal (cwd "~") when no session/project is open. The heavy PTY +
// xterm logic is reused from the (session-agnostic) WorkspaceTerminal.
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
  everOpened,
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

// Ref to the active project's WorkspaceTerminal instance (KeepAlive keeps the ref
// pointed at whichever is currently rendered). Used to run snippets into its
// active tab. The exposed shape is just runText.
const termRef = useTemplateRef<{ runText: (text: string) => void }>('termRef')
// Live backend id of the active tab's active pane (null → no shell to run into).
const activeConnId = ref<string | null>(null)

// Expand the roll-up when the collapsed header bar is clicked (buttons stop
// propagation, so only the bar itself triggers this).
function onHeadClick(): void {
  if (collapsed.value) setCollapsed(false)
}

// Resolve the open session's cwd, mirroring the session engine's precedence
// (sessions.send-message): dragged working folder → bound project's path → home.
// `useWorkspaceData` maps the project name/id to its absolute root; a null root
// (no/unknown project) or no open session falls through to "~". `termRoot` is
// reactive, so switching sessions re-points it — new terminal tabs then spawn in
// the new project while any already-open tab keeps its original cwd.
const sessions = useSessionsStore()
const { root: projectRoot } = useWorkspaceData(() => sessions.active?.project)
const termRoot = computed(() => sessions.active?.workspaceFolder || projectRoot.value || '~')

// Stable per-project key for <KeepAlive> + the PTY grouping key. Two sessions in
// the same project share one terminal set; no project → a single "home" set.
const projectKey = computed(() => sessions.active?.project ?? '__home__')

// Real project for snippet scoping (null = no project → only Global snippets).
const { projectName } = useProjects()
const currentProject = computed(() => sessions.active?.project ?? null)
const currentProjectLabel = computed(() =>
  currentProject.value ? projectName(currentProject.value) : '',
)

// Run a snippet: append a newline so it executes, then write into the active tab
// via WorkspaceTerminal (which picks the right transport for local vs SSH tabs).
function onRunSnippet(command: string): void {
  termRef.value?.runText(`${command}\n`)
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
  // with the /ssh page's own load). No-op in browser-dev beyond seeding mocks.
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
.gterm {
  position: relative;
  flex: 0 0 auto;
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
.gterm-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  font-size: 12px;
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
  border-radius: 6px;
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
