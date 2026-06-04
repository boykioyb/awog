<template>
  <PromptCreatorPanel
    :anchor="anchor"
    :headline="tr('workflows.creator.headline')"
    :subheadline="tr('workflows.creator.subheadline')"
    :placeholder="tr('workflows.creator.placeholder')"
    :generated-label="tr('workflows.creator.generated')"
    :has-draft="!!draft"
    :is-generating="isGenerating"
    :error="error"
    @submit="onSubmit"
    @cancel="emit('cancel')"
    @regenerate="onRegenerate"
  >
    <!-- Scope picker shown BEFORE generation so it scopes which agents the LLM
         may wire (project agents only appear when a project is selected). -->
    <template #controls>
      <div class="flex items-center gap-2">
        <span class="text-[1em] flex-shrink-0" :style="{ color: t.textDim }">
          {{ tr('workflows.creator.save_to') }}
        </span>
        <select
          v-model="scope"
          class="flex-1 min-w-0 rounded px-2 py-1 text-[1em] cursor-pointer"
          :style="{
            background: t.bgInput,
            border: `1px solid ${t.border}`,
            color: t.text,
            outline: 'none',
          }"
        >
          <option value="global">{{ tr('workflows.creator.scope_global') }}</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
    </template>

    <template #preview>
      <div
        v-if="draft"
        class="rounded-xl p-3"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <div class="flex items-center gap-2 mb-1.5">
          <Workflow :size="12" :style="{ color: t.textDim }" />
          <span class="text-[1em] font-medium" :style="{ color: t.text }">{{ draft.name }}</span>
        </div>
        <div class="text-[1em]" :style="{ color: t.textMuted }">
          {{ draft.description }}
        </div>

        <!-- Generated steps (the LLM's result) — agent + skill per node. -->
        <div v-if="draft.nodes.length" class="mt-2 space-y-1">
          <div
            v-for="(n, i) in draft.nodes"
            :key="n.id"
            class="flex items-center gap-1.5 text-[1em]"
          >
            <span class="font-mono text-[12px] leading-none" :style="{ color: t.textFaint }">
              {{ (i + 1).toString().padStart(2, '0') }}
            </span>
            <span class="truncate" :style="{ color: t.text }">{{ agentName(n.agentId) }}</span>
            <span :style="{ color: t.textDim }">·</span>
            <span :style="{ color: t.textDim }">{{ n.skillId || tr('workflows.no_skill') }}</span>
            <ShieldCheck
              v-if="n.approval"
              :size="11"
              :style="{ color: t.warning }"
              :title="tr('workflows.node.approval_gate')"
            />
          </div>
        </div>

        <!-- Read-only confirmation — scope was chosen before generating (the
             "Save to" picker above the prompt); Regenerate to change it. -->
        <div class="mt-3 flex items-center gap-2 text-[1em]">
          <span :style="{ color: t.textDim }">{{ tr('workflows.creator.save_to') }}</span>
          <span :style="{ color: t.text }">{{ scopeLabel }}</span>
        </div>
        <div class="text-[1em] mt-2" :style="{ color: t.textFaint }">
          {{
            draft.nodes.length
              ? tr('workflows.creator.steps_generated', { count: draft.nodes.length })
              : tr('workflows.creator.drag_hint')
          }}
        </div>
      </div>
    </template>

    <template #actions>
      <button
        class="text-[1em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium"
        :style="{ background: t.accent, color: t.accentText }"
        @click="draft && emit('save', { ...draft }, scope)"
      >
        <Save :size="11" />
        {{ tr('workflows.creator.create') }}
      </button>
    </template>
  </PromptCreatorPanel>
</template>

<script setup lang="ts">
import { Save, ShieldCheck, Workflow } from 'lucide-vue-next'
import type { Agent } from '~/types'
import type { WorkflowDraft } from '~/composables/useWorkflowGenerator'

const props = withDefaults(
  defineProps<{
    anchor?: { top: number; left: number } | null
    projects?: { id: string; name: string }[]
    // Agents the LLM may use as workflow steps (already scoped by the page).
    agents?: Agent[]
    // Preselected scope (the page passes its current filter): 'global' or a projectId.
    defaultScope?: string
  }>(),
  { anchor: null, projects: () => [], agents: () => [], defaultScope: 'global' },
)

const emit = defineEmits<{
  // scope: 'global' or a projectId — where the workflow is persisted.
  save: [draft: WorkflowDraft, scope: string]
  cancel: []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const scope = ref(props.defaultScope)

// Agents the LLM may wire as steps — scoped to the chosen "Save to" target so a
// global workflow never references a project-only agent (mirrors the page's
// palette filter, but keyed off the modal's scope, not the selected workflow).
const isProjectAgent = (a: Agent): boolean =>
  a.source === 'project-claude' || a.source === 'project-agents'
const scopedAgents = computed(() => {
  if (scope.value === 'global') return props.agents.filter((a) => !isProjectAgent(a))
  return props.agents.filter((a) => !isProjectAgent(a) || a.projectId === scope.value)
})

const { draft, isGenerating, error, onSubmit, onRegenerate } = usePromptCreator<WorkflowDraft>(
  useWorkflowGenerator(() => scopedAgents.value),
)

const agentName = (id: string): string => props.agents.find((a) => a.id === id)?.name ?? id

const scopeLabel = computed(() => {
  if (scope.value === 'global') return tr('workflows.scope.global')
  return props.projects.find((p) => p.id === scope.value)?.name ?? 'Project'
})
</script>
