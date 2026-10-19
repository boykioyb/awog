<template>
  <div class="w-65 shrink-0 overflow-y-auto border-l bg-sidebar p-4">
    <template v-if="node && agent">
      <div class="mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {{ t('workflow.inspector.node') }}
      </div>
      <div class="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
        <span
          class="grid size-5.5 shrink-0 place-items-center rounded-sm bg-selected text-xs font-semibold text-primary"
        >
          {{ roleBadge }}
        </span>
        <div class="min-w-0">
          <div class="truncate text-sm font-medium text-foreground">{{ agent.name }}</div>
          <div class="mt-0.5 font-mono text-xs text-dim">{{ node.id }}</div>
        </div>
      </div>

      <div class="mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {{ t('workflow.inspector.skill') }}
      </div>
      <AppSelect
        :model-value="node.skillId || ''"
        :options="skillOptions"
        width="100%"
        @update:model-value="onSkill"
      />
      <div v-if="skill" class="mt-1.5 text-sm text-dim">{{ skill.description }}</div>

      <div class="mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {{ t('workflow.inspector.outputs') }}
      </div>
      <div class="flex flex-col gap-1.5">
        <div v-for="(out, i) in node.outputs" :key="i" class="flex items-center gap-1.5">
          <Input
            :model-value="out"
            class="font-mono"
            @update:model-value="updateOutput(i, $event)"
          />
          <Button
            :title="t('common.delete')"
            class="shrink-0 hover:border-transparent hover:bg-destructive/10 hover:text-destructive"
            variant="outline"
            size="iconSm"
            @click="removeOutput(i)"
          >
            <Icon name="x" class="size-3" />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="xs"
          class="self-start px-0.5 text-sm font-normal text-dim hover:bg-transparent hover:text-foreground"
          @click="addOutput"
        >
          <Icon name="plus" class="size-3" />
          {{ t('workflow.inspector.addOutput') }}
        </Button>
      </div>

      <div class="mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {{ t('workflow.inspector.approval') }}
      </div>
      <label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <Checkbox :model-value="node.approval" @update:model-value="onApproval($event === true)" />
        <span>{{ t('workflow.inspector.approvalLabel') }}</span>
      </label>
      <div class="mt-1 ml-6 text-xs text-dim">{{ t('workflow.inspector.approvalHint') }}</div>

      <div class="mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {{ t('workflow.inspector.gate') }}
      </div>
      <label
        class="flex items-center gap-2 text-sm text-foreground"
        :class="canGate ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
      >
        <Checkbox
          :model-value="!!node.gate"
          :disabled="!canGate"
          @update:model-value="onGateToggle($event === true)"
        />
        <span>{{ t('workflow.inspector.gateLabel') }}</span>
      </label>
      <div v-if="!canGate" class="mt-1 ml-6 text-xs text-dim">
        {{ t('workflow.inspector.gateNoAncestors') }}
      </div>
      <template v-else-if="node.gate">
        <div class="mt-1 ml-6 text-xs text-dim">{{ t('workflow.inspector.gateHint') }}</div>
        <div class="mt-2">
          <div class="mb-1 text-xs font-medium text-dim">
            {{ t('workflow.inspector.gateTarget') }}
          </div>
          <AppSelect
            :model-value="node.gate.onFailTarget"
            :options="gateTargetOptions"
            width="100%"
            @update:model-value="onGateTarget"
          />
        </div>
        <div class="mt-2">
          <div class="mb-1 text-xs font-medium text-dim">
            {{ t('workflow.inspector.gateMaxIter') }}
          </div>
          <Input
            type="number"
            min="1"
            max="10"
            :model-value="node.gate.maxIterations"
            class="w-18 tabular-nums"
            @update:model-value="onGateMaxIter($event)"
          />
        </div>
        <label class="mt-2.5 flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <Checkbox
            :model-value="node.gate.auto"
            @update:model-value="onGateAuto($event === true)"
          />
          <span>{{ t('workflow.inspector.gateAuto') }}</span>
        </label>
        <div class="mt-1 ml-6 text-xs text-dim">{{ t('workflow.inspector.gateAutoHint') }}</div>
      </template>
    </template>

    <div v-else class="flex flex-col items-center gap-3 px-3 py-10 text-center text-sm text-dim">
      <Icon name="panel" class="size-4.5" />
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

const onApproval = (checked: boolean) => {
  if (!props.node) return
  emit('update:node', { ...props.node, approval: checked })
}

// --- gate (ADR 0056) -------------------------------------------------------
// A node can only be a gate if it has an upstream node to loop back to.
const canGate = computed(() => props.gateTargets.length > 0)

const gateTargetOptions = computed<AppSelectOption[]>(() =>
  props.gateTargets.map((g) => ({ value: g.id, label: g.label })),
)

const onGateToggle = (checked: boolean) => {
  if (!props.node) return
  if (checked) {
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

const onGateAuto = (checked: boolean) => patchGate({ auto: checked })
</script>
