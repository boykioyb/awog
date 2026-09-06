<template>
  <div class="insp wfinsp">
    <template v-if="node && agent">
      <div class="sech">{{ t('workflow.inspector.node') }}</div>
      <div class="wfi-agent">
        <span class="wfn-badge">{{ roleBadge }}</span>
        <div class="wfi-agent-meta">
          <div class="wfi-agent-name">{{ agent.name }}</div>
          <div class="wfi-agent-id mono">{{ node.id }}</div>
        </div>
      </div>

      <div class="sech">{{ t('workflow.inspector.skill') }}</div>
      <AppSelect
        :model-value="node.skillId || ''"
        :options="skillOptions"
        width="100%"
        @update:model-value="onSkill"
      />
      <div v-if="skill" class="wfi-skill-desc">{{ skill.description }}</div>

      <div class="sech">{{ t('workflow.inspector.outputs') }}</div>
      <div class="wfi-outs">
        <div v-for="(out, i) in node.outputs" :key="i" class="wfi-out-row">
          <input
            class="wfi-inp mono"
            :value="out"
            @input="updateOutput(i, ($event.target as HTMLInputElement).value)"
          />
          <button class="iconbtn wfi-del" :title="t('common.delete')" @click="removeOutput(i)">
            <Icon name="x" style="width: 12px; height: 12px" />
          </button>
        </div>
        <button class="wfi-add" @click="addOutput">
          <Icon name="plus" style="width: 12px; height: 12px" />
          {{ t('workflow.inspector.addOutput') }}
        </button>
      </div>

      <div class="sech">{{ t('workflow.inspector.approval') }}</div>
      <label class="wfi-chk">
        <input type="checkbox" :checked="node.approval" @change="onApproval" />
        <span>{{ t('workflow.inspector.approvalLabel') }}</span>
      </label>
      <div class="wfi-hint">{{ t('workflow.inspector.approvalHint') }}</div>

      <div class="sech">{{ t('workflow.inspector.gate') }}</div>
      <label class="wfi-chk" :class="{ 'wfi-chk-disabled': !canGate }">
        <input type="checkbox" :checked="!!node.gate" :disabled="!canGate" @change="onGateToggle" />
        <span>{{ t('workflow.inspector.gateLabel') }}</span>
      </label>
      <div v-if="!canGate" class="wfi-hint">{{ t('workflow.inspector.gateNoAncestors') }}</div>
      <template v-else-if="node.gate">
        <div class="wfi-hint">{{ t('workflow.inspector.gateHint') }}</div>
        <div class="wfi-gate-field">
          <div class="wfi-gate-lbl">{{ t('workflow.inspector.gateTarget') }}</div>
          <AppSelect
            :model-value="node.gate.onFailTarget"
            :options="gateTargetOptions"
            width="100%"
            @update:model-value="onGateTarget"
          />
        </div>
        <div class="wfi-gate-field">
          <div class="wfi-gate-lbl">{{ t('workflow.inspector.gateMaxIter') }}</div>
          <input
            class="wfi-inp mono wfi-gate-num"
            type="number"
            min="1"
            max="10"
            :value="node.gate.maxIterations"
            @input="onGateMaxIter(($event.target as HTMLInputElement).value)"
          />
        </div>
        <label class="wfi-chk wfi-gate-auto">
          <input type="checkbox" :checked="node.gate.auto" @change="onGateAuto" />
          <span>{{ t('workflow.inspector.gateAuto') }}</span>
        </label>
        <div class="wfi-hint">{{ t('workflow.inspector.gateAutoHint') }}</div>
      </template>
    </template>

    <div v-else class="wfi-empty">
      <Icon name="panel" style="width: 18px; height: 18px" />
      <div>{{ t('workflow.inspector.empty') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Right inspector for the selected workflow node — skill picker (scoped to the
// workflow's tier so node.skillId stays per-project), outputs editor, and the
// approval-gate toggle. Mutations bubble up as `update:node` (the page-controller
// folds them into the node array → store debounced upsert). Renders the empty
// state when no node is selected.
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { WorkflowAgent, WorkflowSkill } from '~/composables/useWorkflowGen'
import type { NodeGate, WorkflowNode } from '~/stores/workflows'

const props = defineProps<{
  node: WorkflowNode | undefined
  agent: WorkflowAgent | undefined
  skill: WorkflowSkill | undefined
  availableSkills: WorkflowSkill[]
  // Transitive ancestors of the selected node — valid loop-back targets (ADR 0056).
  gateTargets: { id: string; label: string }[]
}>()

const emit = defineEmits<{ 'update:node': [node: WorkflowNode] }>()

const { t } = useI18n()

const roleBadge = computed(() => {
  const r = props.agent?.role?.trim()
  if (r) return r.slice(0, 2).toUpperCase()
  return (props.agent?.name ?? '?').slice(0, 2).toUpperCase()
})

const skillOptions = computed<AppSelectOption[]>(() => [
  { value: '', label: t('workflow.inspector.noSkillOption') },
  ...props.availableSkills.map((s) => ({ value: s.id, label: s.name })),
])

const onSkill = (value: string) => {
  if (!props.node) return
  emit('update:node', { ...props.node, skillId: value })
}

const updateOutput = (index: number, value: string) => {
  if (!props.node) return
  emit('update:node', {
    ...props.node,
    outputs: props.node.outputs.map((o, j) => (j === index ? value : o)),
  })
}

const removeOutput = (index: number) => {
  if (!props.node) return
  emit('update:node', {
    ...props.node,
    outputs: props.node.outputs.filter((_, j) => j !== index),
  })
}

const addOutput = () => {
  if (!props.node) return
  emit('update:node', { ...props.node, outputs: [...props.node.outputs, 'new_artifact.md'] })
}

const onApproval = (e: Event) => {
  if (!props.node) return
  emit('update:node', { ...props.node, approval: (e.target as HTMLInputElement).checked })
}

// --- gate (ADR 0056) -------------------------------------------------------
// A node can only be a gate if it has an upstream node to loop back to.
const canGate = computed(() => props.gateTargets.length > 0)

const gateTargetOptions = computed<AppSelectOption[]>(() =>
  props.gateTargets.map((g) => ({ value: g.id, label: g.label })),
)

const onGateToggle = (e: Event) => {
  if (!props.node) return
  if ((e.target as HTMLInputElement).checked) {
    const target = props.gateTargets[0]?.id
    if (!target) return
    const gate: NodeGate = { onFailTarget: target, maxIterations: 3, auto: true }
    emit('update:node', { ...props.node, gate })
  } else {
    // Drop the gate key entirely (exactOptionalPropertyTypes-safe).
    const { gate: _gate, ...rest } = props.node
    emit('update:node', rest)
  }
}

const patchGate = (patch: Partial<NodeGate>) => {
  if (!props.node?.gate) return
  emit('update:node', { ...props.node, gate: { ...props.node.gate, ...patch } })
}

const onGateTarget = (value: string) => patchGate({ onFailTarget: value })

const onGateMaxIter = (value: string) => {
  const n = Math.max(1, Math.min(10, Math.trunc(Number(value) || 1)))
  patchGate({ maxIterations: n })
}

const onGateAuto = (e: Event) => patchGate({ auto: (e.target as HTMLInputElement).checked })
</script>

<style scoped>
.wfinsp {
  flex: 0 0 260px;
}
.wfi-agent {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 10px 12px;
}
.wfn-badge {
  width: 22px;
  height: 22px;
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
.wfi-agent-meta {
  min-width: 0;
}
.wfi-agent-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfi-agent-id {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  margin-top: 2px;
}
.wfi-skill-desc {
  font-size: var(--fs-sm);
  color: var(--textDim);
  margin-top: 6px;
  line-height: 1.5;
}
.wfi-outs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wfi-out-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wfi-inp {
  flex: 1;
  min-width: 0;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px 9px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  outline: none;
}
.wfi-inp:focus {
  border-color: var(--borderStrong);
}
.wfi-del {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}
.wfi-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
  border-color: transparent;
}
.wfi-add {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  background: transparent;
  border: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  padding: 4px 2px;
}
.wfi-add:hover {
  color: var(--text);
}
.wfi-chk {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.wfi-chk input {
  accent-color: var(--accent);
}
.wfi-chk-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wfi-gate-field {
  margin-top: 8px;
}
.wfi-gate-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  color: var(--textDim);
  margin-bottom: 4px;
}
.wfi-gate-num {
  width: 72px;
}
.wfi-gate-auto {
  margin-top: 10px;
}
.wfi-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  margin-top: 5px;
  margin-left: 22px;
  line-height: 1.5;
}
.wfi-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--textDim);
  text-align: center;
  padding: 40px 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
