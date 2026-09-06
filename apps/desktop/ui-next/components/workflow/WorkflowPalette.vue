<template>
  <div class="wfpal">
    <div class="wfpal-hd">{{ t('workflow.palette.title') }}</div>
    <div class="wfpal-list">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="wfpal-item"
        draggable="true"
        @dragstart="onDragStart($event, agent.id)"
      >
        <span class="wfpal-badge">{{ roleBadge(agent) }}</span>
        <div class="wfpal-name">{{ agent.name }}</div>
        <span class="tag" :class="{ acc: agent.source === 'project' }">
          {{ scopeLabel(agent) }}
        </span>
      </div>
      <div v-if="!agents.length" class="wfpal-empty">{{ t('workflow.palette.empty') }}</div>
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

<style scoped>
.wfpal {
  border-top: 1px solid var(--border);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wfpal-hd {
  padding: 8px 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.wfpal-list {
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wfpal-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bgEl);
  cursor: grab;
}
.wfpal-item:hover {
  border-color: var(--borderStrong);
}
.wfpal-item:active {
  cursor: grabbing;
}
.wfpal-badge {
  width: 20px;
  height: 20px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}
.wfpal-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfpal-empty {
  padding: 14px 8px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
  text-align: center;
}
</style>
