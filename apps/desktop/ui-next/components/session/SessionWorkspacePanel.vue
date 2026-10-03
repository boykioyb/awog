<template>
  <div
    class="wpanel flex h-full flex-col overflow-hidden bg-sidebar"
    :class="{ bottom: dock === 'bottom', left: dock === 'left' }"
    :style="panelStyle"
  >
    <!-- Tab strip — proto §3.5 idiom on ui/tabs: inactive tabs are icon-only
         (the label lives in `title`), `×` shows on the active or hovered tab
         via opacity (the slot is always reserved, so the strip never jumps),
         `+` re-adds a closed view, right-click opens the dock picker. -->
    <Tabs :model-value="active ?? ''" @update:model-value="onTabPick">
      <div
        class="relative flex items-center gap-0.5 border-b border-border px-1.5"
        @contextmenu.prevent="toggleDockMenu"
      >
        <TabsList
          class="wpanel-tabs h-9 min-w-0 flex-1 justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0"
        >
          <TabsTrigger
            v-for="tab in tabs"
            :key="tab"
            :value="tab"
            :title="tab"
            class="group/wtab h-9 shrink-0 gap-1 rounded-none border-b-2 border-transparent px-2 text-xs font-normal text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            <component :is="viewIcon(tab)" class="size-3.5" />
            <!-- active tab keeps its label; inactive ones are icon-only -->
            <span v-if="tab === active">{{ tab }}</span>
            <span
              role="button"
              tabindex="-1"
              :aria-label="t('common.close')"
              :class="[
                'flex size-3.5 items-center justify-center rounded-sm transition-opacity hover:bg-accent-foreground/15',
                tab === active ? 'opacity-100' : 'opacity-0 group-hover/wtab:opacity-100',
              ]"
              @click.stop.prevent="emit('close-tab', tab)"
              @pointerdown.stop.prevent
            >
              <X class="size-2.5" />
            </span>
          </TabsTrigger>
        </TabsList>

        <!-- `+` re-add a closed view (hand-rolled `.smenu`, NOT a reka popover:
             `.smenu` is in the embedded-browser OVERLAYS registry, so the menu
             stays visible when it hangs over the native Chromium viewport —
             a teleported dropdown without that marker would paint UNDER it). -->
        <div class="relative shrink-0">
          <Button
            variant="ghost"
            size="iconSm"
            class="size-6"
            :title="t('sessions.workspace.openView')"
            :aria-label="t('sessions.workspace.openView')"
            @click.stop="toggleAdd"
          >
            <Plus />
          </Button>
          <div v-if="addOpen" class="smenu wpanel-menu" @click.stop>
            <div v-for="v in addableViews" :key="v" class="mi" @click="addView(v)">
              <component :is="viewIcon(v)" class="size-3.5" />
              {{ v }}
            </div>
          </div>
        </div>
        <!-- Panel chrome: close. Dock-side switching is the low-frequency action —
             it lives on the strip's right-click menu instead of a permanent button. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6 shrink-0"
          :title="t('sessions.workspace.closePanel')"
          :aria-label="t('sessions.workspace.closePanel')"
          @click="emit('close')"
        >
          <X />
        </Button>

        <!-- Dock picker — right-click on the strip. Same `.smenu` reasoning. -->
        <div v-if="dockMenuOpen" class="smenu wpanel-dockmenu" @click.stop>
          <div class="smenu-label">{{ t('sessions.workspace.dock.change') }}</div>
          <div
            v-for="opt in DOCK_OPTS"
            :key="opt.side"
            class="mi"
            :class="{ on: opt.side === dock }"
            @click="pickDock(opt.side)"
          >
            <component :is="opt.icon" class="size-3.5" />
            {{ t(opt.label) }}
            <Check v-if="opt.side === dock" class="ck size-3.5" />
          </div>
        </div>
      </div>
    </Tabs>

    <div class="wpbody" :class="{ flush: isFlushTab }">
      <!-- Diff -->
      <WorkspaceDiff v-if="active === 'Diff'" :session="session" />

      <!-- Files -->
      <WorkspaceFiles v-else-if="active === 'Files'" :session="session" />

      <!-- Plan -->
      <WorkspacePlan v-else-if="active === 'Plan'" :session="session" />

      <!-- Tasks -->
      <WorkspaceTasks v-else-if="active === 'Tasks'" :session="session" />

      <!-- Group — bảng trạng thái các phiên con của phiên này. -->
      <WorkspaceTeam v-else-if="active === 'Team'" :session="session" />

      <!-- Preview — renders the markdown artifacts this session produced. -->
      <WorkspacePreview v-else-if="active === 'Preview'" :session="session" />

      <!-- Cost — per-day spend + 1d/7d/30d/custom-range roll-up for this session. -->
      <WorkspaceCost v-else-if="active === 'Cost'" :session="session" />

      <!-- Terminal — kept mounted once opened so the PTY persists across tab
           switches; unmounted (PTY killed) only when the Terminal view leaves
           this panel (closed or docked to the other side). -->
      <WorkspaceTerminal
        v-if="terminalMounted && tabs.includes('Terminal')"
        v-show="active === 'Terminal'"
        :root="termRoot"
        :ready="termReady"
        :pty-key="`ses:${session.id}`"
        :visible="active === 'Terminal'"
      />

      <!-- Browser — the agent's embedded Chromium (ADR 0086). Kept mounted once
           opened, like Terminal: the page (and its login state) must survive a tab
           switch. `active` tells it to pull the native view off screen instead of
           painting over whatever tab is showing. -->
      <WorkspaceBrowser
        v-if="browserMounted && tabs.includes('Browser')"
        v-show="active === 'Browser'"
        :active="active === 'Browser'"
        :session="session"
      />

      <!-- Info — metadata rows, context files, media/links/docs. -->
      <WorkspaceInfo v-if="active === 'Info'" :session="session" />

      <!-- fallback (Preview / any unhandled view) -->
      <div v-if="isFallbackTab" class="empty" style="padding: 30px">
        <div class="et">{{ t('sessions.workspace.noPreview') }}</div>
      </div>
    </div>

    <div v-if="addOpen" class="fixed inset-0 z-40" @click="addOpen = false" />
    <div v-if="dockMenuOpen" class="fixed inset-0 z-40" @click="dockMenuOpen = false" />
  </div>
</template>

<script setup lang="ts">
// Workspace panel (wpHtml ~1406 + wpBody ~1425): tab strip (Diff/Files/Terminal/…),
// + panel chrome. Controlled component — the parent (SessionDetail) owns the open
// views, the active tab per dock side, and the dock partition; this panel just
// renders the views routed to one side and emits intents back. Tab bodies are
// wired to real engine data via dedicated tab components (Diff/Files/Terminal/
// Plan/Tasks) which degrade gracefully to an empty state outside the Electron shell.
import type { Component } from 'vue'
import {
  Check,
  Eye,
  Files,
  Folder,
  GitBranch,
  Globe,
  Info,
  ListChecks,
  ListTodo,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plus,
  SquareTerminal,
  Users,
  X,
  Zap,
} from 'lucide-vue-next'
import type { Session } from '~/composables/useSessionsData'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
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

// View → lucide glyph (the tab strip is icon-first). Same names the old sprite
// map carried (useSessionsData.WPVIEWS), expressed in the shadcn icon set.
const VIEW_ICONS: Record<string, Component> = {
  Preview: Eye,
  Browser: Globe,
  Diff: GitBranch,
  Terminal: SquareTerminal,
  Files: Files,
  Tasks: ListTodo,
  Team: Users,
  Plan: ListChecks,
  Cost: Zap,
  Info: Info,
}
const viewIcon = (tab: string): Component => VIEW_ICONS[tab] ?? Folder

// Resolve the project's absolute root + readiness for the (session-agnostic)
// Terminal widget — it now takes a cwd + grouping key, not a Session.
const { root: termRoot, ready: termReady } = useWorkspaceData(() => props.session.project)

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
// Same lazy-then-sticky rule for Browser: don't spin up a Chromium view until the
// user opens the tab, then keep it so the page survives tab switches.
const browserMounted = ref(props.active === 'Browser')
watch(
  () => props.active,
  (tab) => {
    if (tab === 'Terminal') terminalMounted.value = true
    if (tab === 'Browser') browserMounted.value = true
  },
)

// Diff/Files/Terminal/Preview own their own full-bleed chrome; the others use the
// padded wpbody. `isFallbackTab` = any view without a dedicated body (defensive — all
// known views are handled).
const FLUSH_TABS = new Set(['Diff', 'Files', 'Terminal', 'Preview', 'Browser'])
const HANDLED_TABS = new Set([
  'Diff',
  'Files',
  'Terminal',
  'Browser',
  'Plan',
  'Tasks',
  'Team',
  'Info',
  'Preview',
  'Cost',
])
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
  { side: 'left', icon: PanelLeft, label: 'sessions.workspace.dock.left' },
  { side: 'right', icon: PanelRight, label: 'sessions.workspace.dock.right' },
  { side: 'bottom', icon: PanelBottom, label: 'sessions.workspace.dock.bottom' },
] as const
const dockMenuOpen = ref(false)
// Mở bằng CHUỘT PHẢI trên tab strip (§3.5): đổi vị trí dock là thao tác tần suất
// thấp, không đáng một nút thường trực ở mỗi dock.
function toggleDockMenu() {
  dockMenuOpen.value = !dockMenuOpen.value
  if (dockMenuOpen.value) addOpen.value = false
}
function pickDock(side: WorkspaceDockSide) {
  if (props.active && side !== props.dock) emit('move-dock', props.active, side)
  dockMenuOpen.value = false
}

// Reka Tabs updates its model on trigger click/arrow-key nav — forward the intent
// to the parent, which owns the active tab per dock side.
function onTabPick(v: string | number) {
  emit('set-active', String(v))
}
</script>

<style scoped>
/* Diff/Files/Terminal own their full chrome (file lists, viewers, the PTY canvas)
   so they take over the whole body without the default 13px padding + scroll. */
.wpbody.flush {
  padding: 0;
  overflow: hidden;
}
/* Docked-edge hairline — NONE on the panel itself. Every dock renders a `.rszwp`
   drag handle flush against the panel, and the handle's ::after already paints
   the divider; the global `.wpanel{border-left}` (+ the flips below) stacked a
   second line right beside it. One hairline per edge, owned by the handle. */
.wpanel {
  border-left: none;
}
.wpanel.bottom {
  border-left: none;
  border-top: none;
}
.wpanel.left {
  border-left: none;
  border-right: none;
}
/* `position:fixed` comes from the global `.smenu`; these are anchored to the
   strip instead. */
.wpanel-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 50;
}
.wpanel-dockmenu {
  position: absolute;
  top: calc(100% + 4px);
  left: 8px;
  z-index: 50;
}
/* Menu section label — same voice as a shadcn DropdownMenuLabel. */
.smenu-label {
  padding: 4px 8px;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--muted-foreground);
}
/* Mark the current dock position in the picker. */
.smenu .mi.on {
  color: var(--text);
  background: var(--accent-wash);
}
/* Thin horizontal scrollbar on the tab strip (was `.wptabs2` in app-shell.css). */
.wpanel-tabs::-webkit-scrollbar {
  height: 5px;
}
.wpanel-tabs::-webkit-scrollbar-thumb {
  border: 1px solid transparent;
}
</style>
