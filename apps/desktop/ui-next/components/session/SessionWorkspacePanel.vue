<template>
  <!-- Mép dock KHÔNG có hairline trên chính panel: mỗi dock đều có tay kéo `.rszwp`
       sát mép và ::after của nó đã vẽ đường chia — thêm viền ở đây là hai đường cạnh
       nhau. Mỗi mép một hairline, do tay kéo giữ.
       hook-ok: `.wpanel` được useBrowserPanelSizing.ts / WorkspaceBrowser đọc qua closest() -->
  <div class="wpanel" :class="PANEL_CLASS" :style="panelStyle">
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
          class="h-9 min-w-0 [&::-webkit-scrollbar]:h-1.25 [&::-webkit-scrollbar-thumb]:border [&::-webkit-scrollbar-thumb]:border-transparent flex-1 justify-start gap-0 overflow-x-auto rounded-none bg-transparent p-0"
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

        <!-- `+` re-add a closed view (menu tự dựng, NOT a reka popover: nó mang
             `role=dialog` + `data-state=open` — khớp selector trong OVERLAYS của trình
             duyệt nhúng, nên menu vẫn hiện khi treo trên viewport Chromium native;
             một dropdown teleport không có dấu đó sẽ bị vẽ ĐÈ LÊN). -->
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
          <div
            v-if="addOpen"
            role="dialog"
            data-state="open"
            class="absolute top-[calc(100%+4px)] z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md right-0"
            @click.stop
          >
            <div
              v-for="v in addableViews"
              :key="v"
              class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              @click="addView(v)"
            >
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

        <!-- Dock picker — right-click on the strip. Cùng lý do role=dialog như menu `+`. -->
        <div
          v-if="dockMenuOpen"
          role="dialog"
          data-state="open"
          class="absolute top-[calc(100%+4px)] z-50 min-w-40 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md left-2"
          @click.stop
        >
          <!-- Nhãn mục — cùng giọng DropdownMenuLabel. -->
          <div class="px-2 py-1 text-xs font-semibold text-muted-foreground">
            {{ t('sessions.workspace.dock.change') }}
          </div>
          <!-- Vị trí dock hiện tại được đánh dấu. -->
          <div
            v-for="opt in DOCK_OPTS"
            :key="opt.side"
            class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            :class="{ 'bg-accent text-foreground': opt.side === dock }"
            @click="pickDock(opt.side)"
          >
            <component :is="opt.icon" class="size-3.5" />
            {{ t(opt.label) }}
            <Check v-if="opt.side === dock" class="ml-auto size-3.5 text-primary" />
          </div>
        </div>
      </div>
    </Tabs>

    <!-- Diff/Files/Terminal/Preview/Browser tự lo chrome tràn mép (danh sách file,
         viewer, canvas PTY) nên chiếm cả thân, không đệm + không cuộn mặc định. -->
    <div
      class="min-h-0 flex-1 text-sm text-muted-foreground"
      :class="isFlushTab ? 'overflow-hidden p-0' : 'overflow-auto p-3'"
    >
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
        :visible="live === true && active === 'Terminal'"
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
      <div v-if="isFallbackTab" class="p-7.5 text-center text-muted-foreground">
        {{ t('sessions.workspace.noPreview') }}
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
    // Phiên này đang là view hiển thị của SessionDetail (false khi KeepAlive giữ
    // instance khuất mắt). Terminal dùng nó để claim khoá runner "đang hiện" — một
    // panel bị cache không được phép hút lệnh Run về shell không ai thấy.
    live?: boolean
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

// Khung panel; `border-0` gỡ viền trái của `.wpanel` cũ (xem comment ở template).
const PANEL_CLASS = 'flex h-full flex-col overflow-hidden border-0 bg-sidebar'

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
