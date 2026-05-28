<template>
  <div class="space-y-5">
    <div>
      <div
        class="text-[10px] uppercase tracking-wider mb-2 font-medium"
        :style="{ color: t.textDim }"
      >
        Node
      </div>
      <div class="flex items-center gap-2.5">
        <RoleBadge :role="agent.role" />
        <div class="flex-1 min-w-0">
          <div class="text-sm truncate" :style="{ color: t.text }">{{ agent.name }}</div>
          <div class="text-[10px] font-mono" :style="{ color: t.textDim }">{{ node.id }}</div>
        </div>
      </div>
    </div>

    <Field label="Skill">
      <select
        :value="node.skillId || ''"
        class="w-full rounded px-2 py-1.5 text-xs font-mono"
        :style="inputStyle"
        @change="onSkillChange"
      >
        <option v-if="availableSkills.length === 0" value="">
          No skills assigned to this agent
        </option>
        <option v-for="s in availableSkills" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <div v-if="skill" class="text-[10px] mt-1.5 leading-relaxed" :style="{ color: t.textDim }">
        {{ skill.description }}
      </div>
    </Field>

    <Field label="Output artifacts">
      <div class="space-y-1">
        <div v-for="(out, i) in node.outputs" :key="i" class="flex items-center gap-1">
          <input
            :value="out"
            class="flex-1 rounded px-2 py-1 text-[11px] font-mono"
            :style="inputStyle"
            @input="updateOutput(i, ($event.target as HTMLInputElement).value)"
          />
          <button
            class="p-1 transition"
            :style="{ color: t.textDim }"
            @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
            @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
            @click="removeOutput(i)"
          >
            <X :size="11" />
          </button>
        </div>
        <button
          class="text-[11px] flex items-center gap-1 mt-1 transition"
          :style="{ color: t.textDim }"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
          @click="addOutput"
        >
          <Plus :size="11" />
          Add output
        </button>
      </div>
    </Field>

    <div>
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          :checked="node.approval"
          :style="{ accentColor: t.accent }"
          @change="onApprovalChange"
        />
        <span class="text-xs" :style="{ color: t.text }">Require human approval</span>
      </label>
      <div class="text-[10px] mt-1 ml-5" :style="{ color: t.textDim }">
        Workflow pauses for review before continuing
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import type { Agent, Skill, WorkflowNode } from '~/types'

const props = defineProps<{
  node: WorkflowNode
  agent: Agent
  skill: Skill | undefined
  availableSkills: Skill[]
}>()

const emit = defineEmits<{
  (e: 'update:node', value: WorkflowNode): void
}>()

const { t } = useTheme()

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const onSkillChange = (e: Event) => {
  const { value } = e.target as HTMLSelectElement
  emit('update:node', {
    ...props.node,
    skillId: value,
  })
}

const updateOutput = (index: number, value: string) => {
  emit('update:node', {
    ...props.node,
    outputs: props.node.outputs.map((o, j) => (j === index ? value : o)),
  })
}

const removeOutput = (index: number) => {
  emit('update:node', {
    ...props.node,
    outputs: props.node.outputs.filter((_, j) => j !== index),
  })
}

const addOutput = () => {
  emit('update:node', {
    ...props.node,
    outputs: [...props.node.outputs, 'new_artifact.md'],
  })
}

const onApprovalChange = (e: Event) => {
  emit('update:node', {
    ...props.node,
    approval: (e.target as HTMLInputElement).checked,
  })
}
</script>
