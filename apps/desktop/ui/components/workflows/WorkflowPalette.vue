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
      <div class="text-[14px] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
        {{ tr('workflows.palette.title') }}
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
          <div class="text-[1em] truncate" :style="{ color: t.text }">
            {{ agent.name }}
          </div>
          <span
            class="text-[1em] uppercase tracking-wider font-semibold flex-shrink-0 px-1 py-0.5 rounded"
            :style="{
              color: t.textMuted,
              background: t.bgInput,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ agentRoleLabel(agent) }}
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <span
            class="text-[12px] font-mono leading-none px-1 py-0.5 rounded flex-shrink-0 truncate"
            :style="{ color: t.textFaint, background: t.bgInput }"
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

// User-level tiers map to short paths; project tiers resolve to the owning
// project's name so duplicate-named agents across tiers are distinguishable.
const SOURCE_LABEL: Record<string, string> = {
  'user-claude': '~/.claude',
  'user-agents': '~/.agents',
}

const scopeLabel = (agent: Agent): string => {
  if ((agent.source === 'project-claude' || agent.source === 'project-agents') && agent.projectId) {
    return ws.projectById(agent.projectId)?.name ?? 'Project'
  }
  if (agent.source === 'global') return tr('workflows.scope.global_badge')
  return SOURCE_LABEL[agent.source] ?? agent.source
}

const onDragStart = (e: DragEvent, agentId: string) => {
  e.dataTransfer?.setData('agentId', agentId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
</script>
