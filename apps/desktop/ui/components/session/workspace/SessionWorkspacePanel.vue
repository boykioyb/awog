<template>
  <!-- Inline split pane (consumes layout, pushes the chat aside — not an overlay).
       Docks right / left / bottom per the position picker in the drawer header. -->
  <div ref="rootEl" class="flex-shrink-0 flex" :class="containerClass" :style="containerStyle">
    <div
      class="flex-shrink-0 ws-resizer"
      :class="position === 'bottom' ? 'cursor-row-resize' : 'cursor-col-resize hidden md:block'"
      :style="resizerStyle"
      @mousedown="onDragStart"
      @dblclick="resetSize"
    />
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden" :style="contentStyle">
      <!-- Tab strip: one chip per open tool, click to switch, X to close. The +
           button opens the tool menu to add another tab alongside the rest.
           Active tab = bgActive fill + accent underline mark. -->
      <div
        class="flex items-center gap-1 px-1.5 py-1.5 flex-shrink-0 overflow-x-auto ws-tabstrip"
        :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          class="group relative inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg transition flex-shrink-0"
          :style="tabChipStyle(tab)"
          :title="tr(toolOf(tab).labelKey)"
          @click="panel.setActiveTab(session.id, tab)"
        >
          <component :is="toolOf(tab).icon" :size="13" class="flex-shrink-0" />
          <span class="text-[1em] leading-none whitespace-nowrap">
            {{ tr(toolOf(tab).labelKey) }}
          </span>
          <span
            class="inline-flex items-center justify-center w-4 h-4 rounded transition hover:opacity-100"
            :class="tab === active ? 'opacity-70' : 'opacity-0 group-hover:opacity-60'"
            :style="{ color: t.textDim }"
            :title="tr('workspace.close')"
            @click.stop="panel.closeTab(session.id, tab)"
          >
            <X :size="12" />
          </span>
          <!-- Accent underline mark on the active tab. -->
          <span
            v-if="tab === active"
            class="absolute left-2.5 right-2.5 bottom-0 h-0.5 rounded-full"
            :style="{ background: t.accent }"
          />
        </button>

        <button
          ref="addBtnRef"
          type="button"
          class="inline-flex items-center justify-center w-7 h-7 rounded-lg transition flex-shrink-0"
          :style="addBtnStyle"
          :title="tr('workspace.addTab')"
          @click="toggleAddMenu"
        >
          <Plus :size="15" />
        </button>
      </div>

      <div
        v-if="showNoProject"
        class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <FolderGit2 :size="28" :stroke-width="1.5" :style="{ color: t.textFaint }" />
        <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.no_project') }}</p>
      </div>

      <!-- Every open tab stays mounted (terminal keeps running, Files keeps its
           cursor); only the active one is shown. -->
      <div v-else class="flex-1 min-h-0">
        <component
          :is="TAB_COMPONENTS[tab]"
          v-for="tab in renderableTabs"
          v-show="tab === active"
          :key="tab"
          :session="session"
          :workspace-root="workspaceRoot"
        />
      </div>
    </div>
  </div>

  <WorkspaceMenu
    :open="showAddMenu"
    :anchor="addMenuPos"
    :active="active"
    @select="onAddSelect"
    @close="showAddMenu = false"
  />
</template>

<script setup lang="ts">
import { FolderGit2, Plus, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import type { Session, WorkspaceTab } from '~/types'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import { workspaceTool } from '~/utils/workspace-tools'
import WorkspaceMenu from './WorkspaceMenu.vue'
import WorkspaceDiffTab from './WorkspaceDiffTab.vue'
import WorkspaceFilesTab from './WorkspaceFilesTab.vue'
import WorkspacePlanTab from './WorkspacePlanTab.vue'
import WorkspaceTerminalTab from './WorkspaceTerminalTab.vue'
import WorkspaceTasksTab from './WorkspaceTasksTab.vue'
import WorkspacePreviewTab from './WorkspacePreviewTab.vue'
import SessionInfoPanel from '../info/SessionInfoPanel.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string | null
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useWorkspacePanelStore()

const TAB_COMPONENTS = {
  diff: WorkspaceDiffTab,
  files: WorkspaceFilesTab,
  plan: WorkspacePlanTab,
  terminal: WorkspaceTerminalTab,
  tasks: WorkspaceTasksTab,
  preview: WorkspacePreviewTab,
  info: SessionInfoPanel,
} as const

// Open tabs + the visible one (falls back to the first if the store hasn't
// pinned an active tab yet).
const tabs = computed<WorkspaceTab[]>(() => panel.openTabs(props.session.id))
const active = computed<WorkspaceTab | null>(
  () => panel.activeDrawer(props.session.id) ?? tabs.value[0] ?? null,
)
const toolOf = (tab: WorkspaceTab) => workspaceTool(tab)

// Info is the only tab that works without a bound project. So the "no project"
// empty state shows only for a root-requiring active tab, and root-requiring
// tabs aren't mounted at all until a project is bound.
const showNoProject = computed(() => active.value !== 'info' && !props.workspaceRoot)
const renderableTabs = computed<WorkspaceTab[]>(() =>
  props.workspaceRoot ? tabs.value : tabs.value.filter((tab) => tab === 'info'),
)

const tabChipStyle = (tab: WorkspaceTab): CSSProperties =>
  tab === active.value
    ? { color: t.value.text, background: t.value.bgActive }
    : { color: t.value.textDim, background: 'transparent' }

// ── Add-tab menu ────────────────────────────────────────────────────────────
const showAddMenu = ref(false)
const addBtnRef = ref<HTMLElement | null>(null)
const addMenuPos = ref({ top: 0, left: 0 })

const addBtnStyle = computed<CSSProperties>(() =>
  showAddMenu.value
    ? { color: t.value.accent, background: t.value.bgActive }
    : { color: t.value.textDim, background: 'transparent' },
)

const toggleAddMenu = () => {
  showAddMenu.value = !showAddMenu.value
}

const onAddSelect = (tab: WorkspaceTab) => {
  panel.openDrawer(props.session.id, tab)
  showAddMenu.value = false
}

watch(showAddMenu, async (open) => {
  if (!open) return
  await nextTick()
  const r = addBtnRef.value?.getBoundingClientRect()
  // Left-align the 230px menu under the + button, clamped to the viewport.
  if (r) addMenuPos.value = { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 238) }
})

const position = computed(() => panel.position)
const dragging = ref(false)
const rootEl = ref<HTMLElement | null>(null)

// Minimum room left for the chat column when the pane is at its largest, so
// dragging / a persisted-too-large size can never collapse the conversation.
const MIN_CHAT_PX = 320

// ── Position-aware geometry ─────────────────────────────────────────────────
// Direction places the resizer (first child) on the chat-facing edge: left edge
// for a right-docked pane, right edge for left-docked, top edge for bottom.
const containerClass = computed(() => {
  if (position.value === 'left') return 'flex-row-reverse'
  if (position.value === 'bottom') return 'flex-col'
  return 'flex-row' // right (default)
})

const containerStyle = computed<CSSProperties>(() => {
  // max-*: leaves MIN_CHAT_PX for the chat column so a persisted-too-large size
  // never squeezes the conversation to nothing.
  if (position.value === 'bottom')
    return { height: `${panel.heightPx}px`, maxHeight: `calc(100% - ${MIN_CHAT_PX}px)` }
  return { width: `${panel.widthPx}px`, maxWidth: `calc(100% - ${MIN_CHAT_PX}px)` }
})

const resizerStyle = computed<CSSProperties>(() => {
  const bg = dragging.value ? t.value.accent : t.value.border
  if (position.value === 'bottom')
    return { height: '6px', background: bg, marginBottom: '-1px', zIndex: 5 }
  return { width: '6px', background: bg, zIndex: 5 }
})

const contentStyle = computed<CSSProperties>(() => {
  const border = `1px solid ${t.value.border}`
  const base: CSSProperties = { background: t.value.bg }
  if (position.value === 'left') return { ...base, borderRight: border }
  if (position.value === 'bottom') return { ...base, borderTop: border }
  return { ...base, borderLeft: border }
})

// ── Resize ──────────────────────────────────────────────────────────────────
let dragStartX = 0
let dragStartY = 0
let dragStartWidth = 0
let dragStartHeight = 0

// Live cap = the split container size minus the chat's minimum, so dragging
// stops while the conversation still has MIN_CHAT_PX of room. Falls back to the
// viewport if the ancestor is unknown.
const availableSize = (): number => {
  const parent = rootEl.value?.offsetParent as HTMLElement | null
  const total = position.value === 'bottom' ? parent?.clientHeight : parent?.clientWidth
  return (
    (total ?? (position.value === 'bottom' ? window.innerHeight : window.innerWidth)) - MIN_CHAT_PX
  )
}

const onDragMove = (e: MouseEvent) => {
  const max = availableSize()
  if (position.value === 'bottom') {
    // Handle on top edge → drag up grows height.
    panel.setHeight(Math.min(dragStartHeight - (e.clientY - dragStartY), max))
  } else if (position.value === 'left') {
    // Handle on right edge → drag right grows width.
    panel.setWidth(Math.min(dragStartWidth + (e.clientX - dragStartX), max))
  } else {
    // right: handle on left edge → drag left grows width.
    panel.setWidth(Math.min(dragStartWidth - (e.clientX - dragStartX), max))
  }
}

const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  panel.commitSize()
}

const onDragStart = (e: MouseEvent) => {
  e.preventDefault()
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartWidth = panel.widthPx
  dragStartHeight = panel.heightPx
  dragging.value = true
  document.body.style.cursor = position.value === 'bottom' ? 'row-resize' : 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

const resetSize = () => {
  if (position.value === 'bottom') panel.setHeight(320)
  else panel.setWidth(440)
  panel.commitSize()
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>

<style scoped>
.ws-resizer {
  transition: background 120ms ease;
}
.ws-resizer:hover,
.ws-resizer.is-dragging {
  background-color: var(--ws-resizer-hover, currentColor);
}
/* Slim, unobtrusive scrollbar when the tab strip overflows horizontally. */
.ws-tabstrip {
  scrollbar-width: thin;
}
.ws-tabstrip::-webkit-scrollbar {
  height: 4px;
}
.ws-tabstrip::-webkit-scrollbar-thumb {
  background-color: var(--ws-resizer-hover, currentColor);
  border-radius: 2px;
}
</style>
