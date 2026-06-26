<template>
  <div
    class="wpanel"
    :class="{ bottom: dock === 'bottom', left: dock === 'left' }"
    :style="panelStyle"
  >
    <div class="wphead">
      <div class="wptabs2">
        <div
          v-for="tab in tabs"
          :key="tab"
          class="wptab2"
          :class="{ on: tab === active }"
          @click="emit('set-active', tab)"
        >
          <Icon :name="wpIcon(tab)" style="width: 12px; height: 12px" />
          <span>{{ tab }}</span>
          <span class="x" @click.stop="emit('close-tab', tab)">×</span>
        </div>
      </div>
      <span style="position: relative">
        <button class="wpaddb" :title="t('sessions.workspace.openView')" @click.stop="toggleAdd">
          <Icon name="plus" style="width: 13px; height: 13px" />
        </button>
        <div
          v-if="addOpen"
          class="smenu"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        >
          <div v-for="v in addableViews" :key="v" class="mi" @click="addView(v)">
            <Icon :name="wpIcon(v)" style="width: 13px; height: 13px" />
            {{ v }}
          </div>
        </div>
      </span>
      <span style="position: relative">
        <button
          class="wpib"
          :disabled="!active"
          :title="t('sessions.workspace.dock.change')"
          @click.stop="toggleDockMenu"
        >
          <Icon :name="dockIcon(dock)" style="width: 14px; height: 14px" />
        </button>
        <div
          v-if="dockMenuOpen"
          class="smenu"
          style="position: absolute; top: 130%; right: 0; z-index: 50"
          @click.stop
        >
          <div
            v-for="opt in DOCK_OPTS"
            :key="opt.side"
            class="mi"
            :class="{ on: opt.side === dock }"
            @click="pickDock(opt.side)"
          >
            <Icon :name="opt.icon" style="width: 13px; height: 13px" />
            {{ t(opt.label) }}
          </div>
        </div>
      </span>
      <button class="wpib on" :title="t('sessions.workspace.closePanel')" @click="emit('close')">
        <Icon name="x" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="wpbody" :class="{ flush: isFlushTab }">
      <!-- Diff -->
      <WorkspaceDiff v-if="active === 'Diff'" :session="session" />

      <!-- Files -->
      <WorkspaceFiles v-else-if="active === 'Files'" :session="session" />

      <!-- Plan -->
      <WorkspacePlan v-else-if="active === 'Plan'" :session="session" />

      <!-- Tasks -->
      <WorkspaceTasks v-else-if="active === 'Tasks'" :session="session" />

      <!-- Terminal — kept mounted once opened so the PTY persists across tab
           switches; unmounted (PTY killed) only when the Terminal view leaves
           this panel (closed or docked to the other side). -->
      <WorkspaceTerminal
        v-if="terminalMounted && tabs.includes('Terminal')"
        v-show="active === 'Terminal'"
        :session="session"
        :visible="active === 'Terminal'"
      />

      <!-- Info -->
      <div v-if="active === 'Info'" style="display: flex; flex-direction: column">
        <div
          v-for="row in infoRows"
          :key="row.k"
          style="
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 6px 0;
            border-bottom: 1px solid var(--border);
          "
        >
          <span style="color: var(--textDim); flex: 0 0 96px">{{ row.k }}</span>
          <a
            v-if="row.href"
            class="mono"
            :href="row.href"
            target="_blank"
            rel="noopener"
            style="min-width: 0; overflow-wrap: anywhere; color: var(--blue); text-decoration: none"
          >
            {{ row.v }}
          </a>
          <span v-else class="mono" style="min-width: 0; overflow-wrap: anywhere">{{ row.v }}</span>
        </div>
      </div>

      <!-- fallback (Preview / any unhandled view) -->
      <div v-if="isFallbackTab" class="empty" style="padding: 30px">
        <div class="et">{{ t('sessions.workspace.noPreview') }}</div>
      </div>
    </div>

    <div v-if="addOpen" style="position: fixed; inset: 0; z-index: 40" @click="addOpen = false" />
    <div
      v-if="dockMenuOpen"
      style="position: fixed; inset: 0; z-index: 40"
      @click="dockMenuOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
// Workspace panel (wpHtml ~1406 + wpBody ~1425): tab strip (Diff/Files/Terminal/…),
// + panel chrome. Controlled component — the parent (SessionDetail) owns the open
// views, the active tab per dock side, and the dock partition; this panel just
// renders the views routed to one side and emits intents back. Tab bodies are
// wired to real engine data via dedicated tab components (Diff/Files/Terminal/
// Plan/Tasks) which degrade gracefully to an empty state outside the Electron shell.
import type { Session } from '~/composables/useSessionsMock'
import type { WorkspaceDockSide } from '~/stores/settings'

const props = withDefaults(
  defineProps<{
    session: Session
    // Views routed to this panel's dock side, in order, plus the active one.
    tabs: string[]
    active: string | null
    // Fixed dock side of this panel + its size along the docked axis (width when
    // right, height when bottom). The parent owns the value so it can persist.
    dock: WorkspaceDockSide
    size?: number
    // Views not open in any panel — offered by the "+" menu (added on this side).
    addableViews?: string[]
  }>(),
  { size: 322, addableViews: () => [] },
)

const emit = defineEmits<{
  close: []
  'set-active': [view: string]
  'close-tab': [view: string]
  'add-view': [view: string]
  'move-dock': [view: string, side: WorkspaceDockSide]
}>()

const { t } = useI18n()
const { wpIcon } = useSessionsMock()
const { projectName } = useProjects()

// Dock side + size go on the docked axis (width when right, height when bottom).
// flex-basis is set both ways so .chatwrap can hold the panel as a row (right) or
// a column (bottom) without it growing past its size.
const panelStyle = computed(() =>
  props.dock === 'bottom'
    ? { flex: `0 0 ${props.size}px`, height: `${props.size}px`, width: '100%' }
    : { flex: `0 0 ${props.size}px`, width: `${props.size}px` },
)

// Lazy-mount the Terminal on first activation, then keep it mounted so its PTY
// survives tab switches (an unmount would kill + respawn the shell). It unmounts
// only when the Terminal view leaves this panel — see the v-if in the template.
const terminalMounted = ref(props.active === 'Terminal')
watch(
  () => props.active,
  (tab) => {
    if (tab === 'Terminal') terminalMounted.value = true
  },
)

// Diff/Files/Terminal own their own full-bleed chrome; the others use the padded
// wpbody. `isFallbackTab` = any view without a dedicated body (Preview).
const FLUSH_TABS = new Set(['Diff', 'Files', 'Terminal'])
const HANDLED_TABS = new Set(['Diff', 'Files', 'Terminal', 'Plan', 'Tasks', 'Info'])
const isFlushTab = computed(() => FLUSH_TABS.has(props.active ?? ''))
const isFallbackTab = computed(() => !!props.active && !HANDLED_TABS.has(props.active))

const addOpen = ref(false)
function toggleAdd() {
  addOpen.value = !addOpen.value
}
function addView(view: string) {
  emit('add-view', view)
  addOpen.value = false
}

// Dock-position picker — pick where this panel's active view sits (left / right /
// bottom). Clearer than a single cycling button, and the only way to reach left.
const DOCK_OPTS = [
  { side: 'left', icon: 'dock-left', label: 'sessions.workspace.dock.left' },
  { side: 'right', icon: 'dock-right', label: 'sessions.workspace.dock.right' },
  { side: 'bottom', icon: 'dock-bottom', label: 'sessions.workspace.dock.bottom' },
] as const
const dockIcon = (side: WorkspaceDockSide): string => `dock-${side}`
const dockMenuOpen = ref(false)
function toggleDockMenu() {
  dockMenuOpen.value = !dockMenuOpen.value
}
function pickDock(side: WorkspaceDockSide) {
  if (props.active && side !== props.dock) emit('move-dock', props.active, side)
  dockMenuOpen.value = false
}

const kfmt = (n: number): string => (n > 999 ? `${(n / 1000).toFixed(1)}k` : String(n))
const totalTok = computed(() => {
  const chars = props.session.msgs.reduce((a, m) => {
    if (m.role === 'assistant') {
      return (
        a +
        m.blocks.reduce(
          (b, k) =>
            b +
            ('text' in k ? k.text.length : 0) +
            ('detail' in k ? (k.detail || '').length : 0) +
            60,
          0,
        )
      )
    }
    return a + m.text.length
  }, 0)
  return Math.floor(chars / 3)
})

// Derive a compact label for a GitHub issue/PR URL, e.g. "PR owner/repo#5".
function ghLabel(url: string): string {
  const m = /github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/.exec(url)
  if (!m) return url
  const kind = m[3] === 'pull' ? 'PR' : 'Issue'
  return `${kind} ${m[1]}/${m[2]}#${m[4]}`
}

const infoRows = computed<{ k: string; v: string; href?: string }[]>(() => {
  const s = props.session
  const rows: { k: string; v: string; href?: string }[] = [
    { k: t('sessions.info.id'), v: `s_${s.id}` },
    { k: t('sessions.info.project'), v: projectName(s.project) },
    { k: t('sessions.info.account'), v: s.account },
    { k: t('sessions.info.model'), v: s.model },
    { k: t('sessions.info.style'), v: s.style || 'Normal' },
    { k: t('sessions.info.mode'), v: s.mode || 'Ask' },
    { k: t('sessions.info.messages'), v: String(s.msgs.length) },
    { k: t('sessions.info.tokens'), v: `${kfmt(totalTok.value)} / 200k` },
    { k: t('sessions.info.updated'), v: s.when },
  ]
  if (s.aboutGhUrl) {
    rows.push({ k: t('sessions.info.gh'), v: ghLabel(s.aboutGhUrl), href: s.aboutGhUrl })
  }
  return rows
})
</script>

<style scoped>
/* Diff/Files/Terminal own their full chrome (file lists, viewers, the PTY canvas)
   so they take over the whole body without the default 13px padding + scroll. */
.wpbody.flush {
  padding: 0;
  overflow: hidden;
}
/* Bottom dock: full-width row under the chat — the divider sits on top, not left
   (the prototype's .wpanel uses border-left for the right-dock layout). */
.wpanel.bottom {
  border-left: none;
  border-top: 1px solid var(--border);
}
/* Left dock: the divider sits on the right edge (toward the chat). */
.wpanel.left {
  border-left: none;
  border-right: 1px solid var(--border);
}
.wpib:disabled {
  opacity: 0.4;
  cursor: default;
}
/* Mark the current dock position in the picker. */
.smenu .mi.on {
  color: var(--text);
  background: var(--bgActive);
}
</style>
