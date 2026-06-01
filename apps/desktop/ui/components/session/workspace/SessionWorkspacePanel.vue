<template>
  <!-- Overlay layer floating on top of the chat (never consumes main layout).
       Docks right / left / bottom per the position picker in the drawer header. -->
  <div class="absolute z-30 flex" :class="containerClass" :style="containerStyle">
    <div
      class="flex-shrink-0 ws-resizer"
      :class="position === 'bottom' ? 'cursor-row-resize' : 'cursor-col-resize hidden md:block'"
      :style="resizerStyle"
      @mousedown="onDragStart"
      @dblclick="resetSize"
    />
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden" :style="contentStyle">
      <div
        v-if="!workspaceRoot"
        class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <FolderGit2 :size="28" :stroke-width="1.5" :style="{ color: t.textFaint }" />
        <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.no_project') }}</p>
      </div>

      <KeepAlive v-else>
        <component
          :is="activeComponent"
          :key="active"
          :session="session"
          :workspace-root="workspaceRoot"
        />
      </KeepAlive>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FolderGit2 } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'
import type { CSSProperties } from 'vue'
import type { Session, WorkspaceTab } from '~/types'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDiffTab from './WorkspaceDiffTab.vue'
import WorkspaceFilesTab from './WorkspaceFilesTab.vue'
import WorkspacePlanTab from './WorkspacePlanTab.vue'
import WorkspaceTerminalTab from './WorkspaceTerminalTab.vue'
import WorkspaceTasksTab from './WorkspaceTasksTab.vue'
import WorkspacePreviewTab from './WorkspacePreviewTab.vue'

const props = defineProps<{
  session: Session
  active: WorkspaceTab
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
} as const

const activeComponent = computed(() => TAB_COMPONENTS[props.active])
const position = computed(() => panel.position)
const dragging = ref(false)

// ── Position-aware geometry ─────────────────────────────────────────────────
const containerClass = computed(() => {
  if (position.value === 'left') return 'inset-y-0 left-0 flex-row-reverse'
  if (position.value === 'bottom') return 'inset-x-0 bottom-0 flex-col'
  return 'inset-y-0 right-0' // right (default)
})

const SHADOW = {
  right: (c: string) => `-12px 0 32px ${c}`,
  left: (c: string) => `12px 0 32px ${c}`,
  bottom: (c: string) => `0 -12px 32px ${c}`,
}

const containerStyle = computed<CSSProperties>(() => {
  const shadow = SHADOW[position.value](t.value.shadow)
  if (position.value === 'bottom') return { height: `${panel.heightPx}px`, boxShadow: shadow }
  return { width: `${panel.widthPx}px`, boxShadow: shadow }
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

const onDragMove = (e: MouseEvent) => {
  if (position.value === 'bottom') {
    // Handle on top edge → drag up grows height.
    panel.setHeight(dragStartHeight - (e.clientY - dragStartY))
  } else if (position.value === 'left') {
    // Handle on right edge → drag right grows width.
    panel.setWidth(dragStartWidth + (e.clientX - dragStartX))
  } else {
    // right: handle on left edge → drag left grows width.
    panel.setWidth(dragStartWidth - (e.clientX - dragStartX))
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
</style>
