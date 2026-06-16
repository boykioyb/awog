<!--
  WorkflowInspectorPane.vue — Pane phải của /workflows: header "Inspector" + slot cho
  WorkflowNodeInspector hoặc empty state.

  Props:
    - node          Node đang chọn (undefined = render empty state).
    - agent         Agent tương ứng node.
    - skill         Skill tương ứng node.
    - availableSkills  Skill list dành cho agent (combobox trong inspector).

  Emits:
    - update:node   Inspector cập nhật node → bubble lên parent.
-->
<template>
  <div
    class="w-72 flex-col flex-shrink-0 hidden md:flex rounded-xl overflow-hidden"
    :style="{
      border: `1px solid ${parts.border}`,
      background: parts.bg,
      backdropFilter: parts.blur,
      boxShadow: `0 4px 16px -10px ${t.shadow}`,
    }"
  >
    <div class="px-3 py-2.5" :style="{ borderBottom: `1px solid ${t.border}` }">
      <div class="text-[1em] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
        {{ tr('workflows.inspector.title') }}
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-4">
      <WorkflowNodeInspector
        v-if="node && agent"
        :node="node"
        :agent="agent"
        :skill="skill"
        :available-skills="availableSkills"
        @update:node="(updated) => emit('update:node', updated)"
      />
      <div v-else class="text-center text-[1em] py-12" :style="{ color: t.textDim }">
        <Eye :size="20" class="mx-auto mb-2" :stroke-width="1.5" :style="{ color: t.textFaint }" />
        {{ tr('workflows.inspector.empty') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Eye } from 'lucide-vue-next'
import type { Agent, Skill, WorkflowNode } from '~/types'

type Props = {
  node: WorkflowNode | undefined
  agent: Agent | undefined
  skill: Skill | undefined
  availableSkills: Skill[]
}

type Emits = {
  'update:node': [node: WorkflowNode]
}

defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useTheme()
const { parts } = useGlass()
const { t: tr } = useI18n()
</script>
