<!--
  WorkflowPalette.vue — Danh sách agent có thể drag vào canvas. Dùng trong /workflows.

  Props:
    - agents   Mảng agent hiển thị làm "stamp" kéo thả vào canvas.

  Behavior:
    - Mỗi row `draggable=true`, set `agentId` vào `dataTransfer` để `WorkflowCanvas`
      đọc khi drop.
    - Không emit gì lên parent — drag-drop hoàn toàn qua native DataTransfer.
-->
<template>
  <div class="flex-1 overflow-y-auto" :style="{ borderTop: `1px solid ${t.border}` }">
    <div
      class="px-3 py-2 sticky top-0"
      :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
    >
      <div class="text-[11px] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
        Drag agents to canvas
      </div>
    </div>
    <div class="p-2 space-y-0.5">
      <div
        v-for="agent in agents"
        :key="agent.id"
        :draggable="true"
        class="px-2 py-1.5 rounded cursor-grab active:cursor-grabbing transition"
        @dragstart="(e) => onDragStart(e, agent.id)"
        @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.background = t.bgHover)"
        @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')"
      >
        <div class="flex items-center gap-1.5 min-w-0">
          <div class="text-[11px] truncate" :style="{ color: t.text }">
            {{ agent.name }}
          </div>
          <span
            class="text-[8px] uppercase tracking-wider font-semibold flex-shrink-0 px-1 py-0.5 rounded"
            :style="{
              color: t.textMuted,
              background: t.bgInput,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ agent.role }}
          </span>
        </div>
        <div class="text-[9px]" :style="{ color: t.textDim }">
          {{ agent.skillIds.length }} skills
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Agent } from '~/types'

type Props = {
  agents: Agent[]
}

defineProps<Props>()

const { t } = useTheme()

const onDragStart = (e: DragEvent, agentId: string) => {
  e.dataTransfer?.setData('agentId', agentId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
</script>
