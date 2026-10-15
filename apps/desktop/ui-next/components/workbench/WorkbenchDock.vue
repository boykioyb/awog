<template>
  <!-- Dock của Session Workbench (ADR 0098, slice D): 3 trạng thái —
       full (dockH) / collapsed (34, chỉ bar) / hidden (⌘J). Grip kéo trên
       cạnh trên; body = view chính (checklist rail đã gỡ — chip trên header
       đã cover). Terminal mount lười-rồi-dính (v-show) để PTY + scrollback
       sống qua đổi view; các view còn lại mount theo lần chọn đầu (v-if) vì
       dữ liệu tự nạp lại. -->
  <section
    v-show="!wb.dockHidden"
    data-wb-dock
    class="relative flex min-h-0 flex-none flex-col"
    :style="{
      height: wb.dockH + 'px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bgPanel)',
    }"
  >
    <!-- Grip kéo tay CỐ Ý thay ResizablePanelGroup (ngoại lệ trong rule):
         dockH là pixel có toggle dockHidden + collapsed bar-only ở DOCK_MIN —
         SplitterGroup làm theo % không giữ được 3 trạng thái này. -->
    <div
      class="absolute inset-x-0 -top-[3px] z-[5] h-1.5 cursor-row-resize"
      title="Kéo đổi cao dock"
      @mousedown.prevent="startDockDrag"
    />
    <DockBar />
    <div v-show="wb.dockH > wb.DOCK_MIN + 1" class="flex min-h-0 flex-1">
      <div class="dock-main flex min-h-0 min-w-0 flex-1 flex-col">
        <DockTerminal v-if="terminalMounted" v-show="wb.dockView === 'Terminal'" />
        <DockTasks v-if="wb.dockView === 'Tasks'" />
        <DockCost v-if="wb.dockView === 'Cost'" />
        <DockInfo v-if="wb.dockView === 'Info'" />
        <DockTeam v-if="wb.dockView === 'Team'" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Slice D — dock container. Trong khi trang workbench hiển thị thì dock
// terminal TOÀN CỤC (GlobalTerminalHost) bị giấu: hai dock đáy chồng nhau thì
// xterm nằm dưới và ⌘J bật cả hai. `useGlobalTerminal().setSuppressed` chỉ là
// cờ hiển thị — PTY của dock kia sống tiếp, trả lại khi rời/deactivate.
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import DockBar from '~/components/workbench/dock/DockBar.vue'
import DockCost from '~/components/workbench/dock/DockCost.vue'
import DockInfo from '~/components/workbench/dock/DockInfo.vue'
import DockTasks from '~/components/workbench/dock/DockTasks.vue'
import DockTeam from '~/components/workbench/dock/DockTeam.vue'
import DockTerminal from '~/components/workbench/dock/DockTerminal.vue'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'

import { useWorkbenchStore } from '~/stores/workbench'

const wb = useWorkbenchStore()

const globalTerm = useGlobalTerminal()

// Giấu dock toàn cục suốt đời component (KeepAlive: activate/deactivate;
// onMounted chặn trường hợp mount lần đầu trước khi activated kịp chạy).
const suppress = (): void => globalTerm.setSuppressed(true)
const release = (): void => globalTerm.setSuppressed(false)
onMounted(suppress)
onActivated(suppress)
onDeactivated(release)
onBeforeUnmount(release)

// Terminal mount lười: chưa ai chọn view Terminal thì chưa spawn PTY nào;
// một khi mount rồi thì giữ bằng v-show — unmount = giết PTY.
const terminalMounted = ref(wb.dockView === 'Terminal')
watch(
  () => wb.dockView,
  (v) => {
    if (v === 'Terminal') terminalMounted.value = true
  },
)

// Grip kéo trên cạnh trên dock: kéo lên lớn hơn, clamp [DOCK_MIN 34, DOCK_MAX 480].
// Xuống tới 34 coi như collapsed (bar-only).
function startDockDrag(e: MouseEvent): void {
  const startY = e.clientY
  const startH = wb.dockH
  const move = (ev: MouseEvent) => {
    wb.dockH = Math.min(wb.DOCK_MAX, Math.max(wb.DOCK_MIN, startH + (startY - ev.clientY)))
  }
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<style scoped>
/* Child dock views fill remaining height — `:deep` cần thiết vì các view là
   component con (Tailwind không đặt flex-1 trên slot con). */
.dock-main > * {
  flex: 1;
  min-height: 0;
}
</style>
