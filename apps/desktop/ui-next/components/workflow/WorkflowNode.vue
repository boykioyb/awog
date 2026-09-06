<template>
  <div class="wfnode" :class="{ sel: selected }">
    <Handle type="target" :position="Position.Left" />

    <div class="wfn-hd">
      <span class="wfn-badge">{{ roleBadge }}</span>
      <div class="wfn-name">{{ data.agent?.name ?? t('workflow.node.unknownAgent') }}</div>
    </div>
    <div class="wfn-skill">{{ data.skill?.name || t('workflow.node.noSkill') }}</div>

    <div class="wfn-foot">
      <span class="wfn-out">
        <Icon name="folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="wfn-out-t">{{ data.outputs?.[0] ?? '' }}</span>
      </span>
      <Icon
        v-if="data.isGate"
        name="refresh"
        class="wfn-loop"
        :title="t('workflow.node.qualityGate')"
      />
      <Icon
        v-if="data.approval"
        name="shield"
        class="wfn-gate"
        :title="t('workflow.node.approvalGate')"
      />
    </div>

    <Handle type="source" :position="Position.Right" />

    <button v-if="selected" class="wfn-del" :title="t('common.delete')" @click.stop="onDelete">
      <Icon name="trash" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>
  </div>
</template>

<script setup lang="ts">
// One agent node rendered inside the VueFlow canvas. Receives VueFlow's node
// props (id/data/selected). `data` carries the resolved agent/skill slices +
// outputs/approval + an onDelete callback (VueFlow custom nodes can't emit to
// the canvas, so the delete handler is threaded through node.data).
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'
import type { WorkflowAgent, WorkflowSkill } from '~/composables/useWorkflowGen'

type NodeData = {
  agent?: WorkflowAgent
  skill?: WorkflowSkill
  outputs: string[]
  approval: boolean
  // True when the node has a gate config (ADR 0056) — shows the loop indicator.
  isGate?: boolean
  onDelete?: (id: string) => void
}

const props = defineProps<{ id: string; data: NodeData; selected: boolean }>()

const { t } = useI18n()

// Role abbreviation (the agent's `role` field, e.g. TL/DV/QA) or the first two
// letters of the name as a fallback.
const roleBadge = computed(() => {
  const r = props.data.agent?.role?.trim()
  if (r) return r.slice(0, 2).toUpperCase()
  return (props.data.agent?.name ?? '?').slice(0, 2).toUpperCase()
})

const onDelete = () => props.data.onDelete?.(props.id)
</script>

<style scoped>
.wfnode {
  width: 168px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  padding: 10px 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  position: relative;
  cursor: pointer;
}
.wfnode.sel {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 8px 24px rgba(0, 0, 0, 0.4);
}
.wfn-hd {
  display: flex;
  align-items: center;
  gap: 7px;
}
.wfn-badge {
  width: 18px;
  height: 18px;
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
.wfn-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfn-skill {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  margin-top: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfn-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.wfn-out {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  /* mono-ok: output artifact file name */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.wfn-out-t {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfn-gate {
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--amber);
  flex: 0 0 auto;
}
.wfn-loop {
  width: var(--icon-xs);
  height: var(--icon-xs);
  color: var(--accent);
  flex: 0 0 auto;
}
.wfn-del {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: var(--r-xs);
  border: 1px solid var(--borderStrong);
  background: var(--bgEl);
  color: var(--textMuted);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.wfn-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
  border-color: transparent;
}
</style>
