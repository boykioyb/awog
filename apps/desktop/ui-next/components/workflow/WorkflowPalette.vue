<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden border-t">
    <div class="shrink-0 border-b px-3 py-2 text-xs text-dim">
      {{ t('workflow.palette.title') }}
    </div>
    <div class="flex flex-col gap-1 overflow-y-auto p-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="flex cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 hover:border-input active:cursor-grabbing"
        draggable="true"
        @dragstart="onDragStart($event, agent.id)"
      >
        <span
          class="grid size-5 shrink-0 place-items-center rounded-sm bg-selected text-xs font-semibold text-primary"
        >
          {{ roleBadge(agent) }}
        </span>
        <div class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {{ agent.name }}
        </div>
        <Badge
          variant="outline"
          class="rounded-sm"
          :class="
            agent.source === 'project'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'text-muted-foreground'
          "
        >
          {{ scopeLabel(agent) }}
        </Badge>
      </div>
      <div v-if="!agents.length" class="px-2 py-3 text-center text-sm text-faint">
        {{ t('workflow.palette.empty') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Draggable agent stamps for the canvas. Each row sets `agentId` on the native
// DataTransfer; WorkflowCanvas reads it on drop. No emits — drag/drop is fully
// native. Agents are pre-scoped to the selected workflow's tier by the page.
import type { WorkflowAgent } from '~/composables/useWorkflowGen'

const props = defineProps<{
  agents: WorkflowAgent[]
  projects: { id: string; name: string }[]
}>()

const { t } = useI18n()

const roleBadge = (a: WorkflowAgent): string => {
  const r = a.role?.trim()
  if (r) return r.slice(0, 2).toUpperCase()
  return a.name.slice(0, 2).toUpperCase()
}

const scopeLabel = (a: WorkflowAgent): string => {
  if (a.source === 'project' && a.projectId) {
    return props.projects.find((p) => p.id === a.projectId)?.name ?? t('workflow.scope.project')
  }
  return t('workflow.scope.global')
}

const onDragStart = (e: DragEvent, agentId: string) => {
  e.dataTransfer?.setData('agentId', agentId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
</script>
