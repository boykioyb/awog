<template>
  <!-- Session Workbench (ADR 0098) — VS Code-style layout.
       Left edge: explorer panel (collapsible; view switcher = segmented strip
       ở đầu panel). Center: stage with session strip + doc tabs + surface,
       and the bottom dock. Status bar lives at app level (AppStatusBar). -->
  <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background" data-page="workbench">
    <!-- explorer panel — collapsible, resizable. Khi đóng thì co thành một
         rail icon mảnh để mở lại (giống Activity Bar của VS Code khi kéo panel
         về 0). -->
    <aside
      v-show="!wb.sideClosed"
      class="relative min-w-0 flex-none border-r border-border bg-sidebar"
      :style="{ width: sideW + 'px' }"
    >
      <WorkbenchExplorer />
      <!-- Grip kéo tay CỐ Ý thay ResizablePanelGroup: panel phải đóng/mở theo
           sideClosed + clamp min/max trong startSideDrag — ép sang primitive
           phức tạp hơn lợi ích. -->
      <!-- raw-ok: grip kéo resize -->
      <div
        class="absolute -right-0.75 top-0 z-5 h-full w-1.5 cursor-col-resize"
        @mousedown.prevent="startSideDrag"
      />
    </aside>
    <div
      v-show="wb.sideClosed"
      class="flex w-(--sidebar-width-icon) flex-none flex-col items-center gap-1 border-r border-border bg-sidebar pt-2"
    >
      <Button
        v-for="v in miniViews"
        :key="v.id"
        variant="ghost"
        :class="VIEW_BTN"
        :title="v.title"
        @click="wb.setView(v.id)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -- icon SVG constant -->
        <span class="flex" v-html="v.icon" />
      </Button>
    </div>

    <!-- stage: doc tabs + surface + dock. SessionSwitcher mount ở đây vì root
         của nó là Teleport — không chiếm chỗ trong flex row. Row TopRow cũ
         (crumb + state chip + popover phiên + ⓘ) đã bỏ: project tab strip trên
         `.top` đã mang project name, chip trạng thái trùng lặp với DocTabs. -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <SessionSwitcher />
      <WorkbenchDocTabs />
      <WorkbenchSurface />
      <WorkbenchDock />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useWorkbenchStore } from '~/stores/workbench'
import SessionSwitcher from '~/components/workbench/stage/SessionSwitcher.vue'
import { EXPLORER_VIEWS, VIEW_BTN } from '~/components/workbench/explorer-views'

const wb = useWorkbenchStore()

// Mini rail khi panel đóng — cùng danh sách view với dải chọn view của panel
// (EXPLORER_VIEWS), bấm mở lại vào đúng view (setView đặt sideClosed = false).
// Không badge ở đây — badge sống ở dải chọn view của explorer.
const miniViews = EXPLORER_VIEWS

// ---- explorer resize -------------------------------------------------------
const sideW = ref(240)
const SIDE_MIN = 180
const SIDE_MAX = 480
let sideDragging = false
function startSideDrag(e: MouseEvent) {
  sideDragging = true
  const startX = e.clientX
  const startW = sideW.value
  const move = (ev: MouseEvent) => {
    if (!sideDragging) return
    sideW.value = Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + ev.clientX - startX))
  }
  const up = () => {
    sideDragging = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

// ---- shortcuts -------------------------------------------------------------
function onKey(e: KeyboardEvent) {
  const meta = e.metaKey || e.ctrlKey
  if (meta && e.key === 'b') {
    e.preventDefault()
    wb.toggleSide()
  }
  if (meta && e.key === 'j') {
    e.preventDefault()
    wb.toggleDock()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>
