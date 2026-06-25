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
import type { WorkflowNode } from '~/stores/workflows'

const props = defineProps<{
  node: WorkflowNode | undefined
  agent: WorkflowAgent | undefined
  skill: WorkflowSkill | undefined
  availableSkills: WorkflowSkill[]
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
  border-radius: 11px;
  padding: 10px 12px;
}
.wfn-badge {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 0.7692rem;
  font-family: var(--code);
  font-weight: 600;
  background: var(--accentDim);
  color: var(--accent);
  flex: 0 0 auto;
}
.wfi-agent-meta {
  min-width: 0;
}
.wfi-agent-name {
  font-size: 0.9615rem;
  font-weight: 550;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wfi-agent-id {
  font-size: 0.7692rem;
  color: var(--textDim);
  margin-top: 2px;
}
.wfi-skill-desc {
  font-size: 0.8846rem;
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
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 0.8846rem;
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
  font-size: 0.8846rem;
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
  font-size: 0.9615rem;
  color: var(--text);
}
.wfi-chk input {
  accent-color: var(--accent);
}
.wfi-hint {
  font-size: 0.8462rem;
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
  font-size: 0.9615rem;
}
</style>
