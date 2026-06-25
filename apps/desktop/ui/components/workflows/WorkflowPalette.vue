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
      class="px-3 py-2.5 sticky top-0 z-10"
      :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
    >
      <div class="text-[1em] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
        {{ tr('workflows.palette.title') }}
      </div>
    </div>
    <div class="p-2 space-y-1">
      <div
        v-for="agent in agents"
        :key="agent.id"
        :draggable="true"
        class="px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing transition"
        :style="{ border: `1px solid ${t.border}`, background: t.bgElevated }"
        @dragstart="(e) => onDragStart(e, agent.id)"
        @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.borderColor = t.borderStrong)"
        @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.borderColor = t.border)"
      >
        <div class="flex items-center gap-2 min-w-0">
          <RoleBadge :role="agentRoleLabel(agent)" size="sm" />
          <div class="text-[1em] truncate flex-1" :style="{ color: t.text }">
            {{ agent.name }}
          </div>
        </div>
        <div class="flex items-center gap-1.5 mt-1 ml-[28px]">
          <span
            class="text-[12px] font-mono leading-none px-1.5 py-0.5 rounded-full flex-shrink-0 truncate"
            :style="{ color: t.textFaint, background: t.bgInput, border: `1px solid ${t.border}` }"
            :title="scopeLabel(agent)"
          >
            {{ scopeLabel(agent) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Agent } from '~/types'
import { agentRoleLabel } from '~/utils/agent-role'

type Props = {
  agents: Agent[]
}

defineProps<Props>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

// Project-tier agents resolve to the owning project's name so they are
// distinguishable from global agents (ADR 0035).
const scopeLabel = (agent: Agent): string => {
  if (agent.source === 'project' && agent.projectId) {
    return ws.projectById(agent.projectId)?.name ?? 'Project'
  }
  return tr('workflows.scope.global_badge')
}

const onDragStart = (e: DragEvent, agentId: string) => {
  e.dataTransfer?.setData('agentId', agentId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
</script>
