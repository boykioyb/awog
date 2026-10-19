<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <!-- Không đóng bằng scrim/Esc khi đang generate — không bỏ dở lượt đang chạy. -->
    <DialogContent
      class="flex max-h-[86vh] w-170 max-w-[94vw] flex-col gap-0 overflow-hidden border-input bg-card p-0 sm:max-w-170 sm:rounded-2xl"
      @pointer-down-outside="guardDismiss"
      @focus-outside.prevent
      @escape-key-down="guardDismiss"
    >
      <DialogHeader class="flex-none flex-row items-center gap-2 border-b px-4 py-3 pr-12">
        <Icon name="sparkles" class="size-3.5 text-primary" />
        <DialogTitle class="text-base font-semibold">
          {{ t('workflow.creator.headline') }}
        </DialogTitle>
        <DialogDescription class="text-xs text-dim">
          {{ t('workflow.creator.subheadline') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
        <LibraryScopePicker v-model="scope" :projects="projects" />

        <Textarea
          v-model="promptText"
          class="min-h-28 resize-y rounded-lg p-3"
          rows="5"
          :disabled="isGenerating"
          :placeholder="t('workflow.creator.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />

        <div
          v-if="error"
          class="rounded-md border border-destructive bg-muted px-3 py-2 text-sm text-destructive"
        >
          {{ error }}
        </div>

        <!-- generated draft preview -->
        <div v-if="draft" class="rounded-lg border bg-muted p-3">
          <div class="mb-1 flex items-center gap-2">
            <Icon name="workflows" class="size-3 text-dim" />
            <span class="text-sm font-semibold text-foreground">{{ draft.name }}</span>
          </div>
          <div class="text-sm text-muted-foreground">{{ draft.description }}</div>
          <!-- Steps grouped by agent (project agents first), the agent name as
               the group header and its skills/steps listed underneath. -->
          <div v-if="draft.nodes.length" class="mt-2 flex flex-col gap-2">
            <div v-for="grp in groupedSteps" :key="grp.agentId">
              <div class="flex items-baseline gap-1.5">
                <Icon name="agents" class="size-3 text-dim" />
                <span class="text-sm font-semibold text-foreground">{{ grp.agentName }}</span>
                <span v-if="grp.role" class="text-xs text-faint">{{ grp.role }}</span>
              </div>
              <div class="mt-0.5 flex flex-col gap-0.5 pl-4.5">
                <div v-for="s in grp.steps" :key="s.id" class="flex items-center gap-1.5 text-sm">
                  <span class="text-xs tabular-nums text-faint">{{ s.num }}</span>
                  <span class="text-dim">
                    {{ s.skillId || t('workflow.node.noSkill') }}
                  </span>
                  <Icon
                    v-if="s.approval"
                    name="shield"
                    class="size-3 text-warning"
                    :title="t('workflow.node.approvalGate')"
                  />
                </div>
              </div>
            </div>
          </div>
          <div class="mt-2 text-xs text-faint">
            {{
              draft.nodes.length
                ? t('workflow.creator.stepsGenerated', { count: draft.nodes.length })
                : t('workflow.creator.dragHint')
            }}
          </div>
        </div>
      </div>

      <div class="flex flex-none items-center gap-2 border-t px-4 py-3">
        <span class="text-xs text-faint">{{ t('workflow.creator.sendHint') }}</span>
        <span class="flex-1" />
        <Button
          v-if="draft"
          :disabled="isGenerating"
          variant="outline"
          size="sm"
          @click="onGenerate"
        >
          <Icon name="refresh" :class="{ 'animate-spin': isGenerating }" />
          {{ t('workflow.creator.regenerate') }}
        </Button>
        <Button
          v-if="!draft"
          :disabled="!canGenerate"
          variant="default"
          size="sm"
          @click="onGenerate"
        >
          <Icon
            :name="isGenerating ? 'refresh' : 'sparkles'"
            :class="{ 'animate-spin': isGenerating }"
          />
          {{ isGenerating ? t('workflow.creator.generating') : t('workflow.creator.generate') }}
        </Button>
        <Button v-if="draft" variant="default" size="sm" @click="onCreate">
          <Icon name="save" />
          {{ t('workflow.creator.create') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Chat-to-workflow generation panel — a ONE-SHOT generate flow (workflows.generate
// returns a full DAG draft, unlike the streaming `<area>.author` flow that
// LibraryCreatorPanel drives). Mirrors the old UI WorkflowPromptCreator: scope
// picker (chosen BEFORE generating so it scopes which agents the LLM may wire) +
// prompt → draft preview → Create. On Create the draft is persisted at the chosen
// tier. Surfaces an error when there is no engine / LLM account to generate with.
import { computed, ref, watch } from 'vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import type { WorkflowAgent, WorkflowDraft, WorkflowSkill } from '~/composables/useWorkflowGen'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    // Full agent/skill rosters (global + every project). The modal re-scopes both
    // to the chosen "Save to" tier below (scopedAgents / scopedSkills) so a global
    // workflow never references a project-only agent or skill.
    agents: WorkflowAgent[]
    skills: WorkflowSkill[]
    projects?: { id: string; name: string }[]
    defaultScope?: string
    // Runs the one-shot LLM generate. Provided by the page-controller.
    generate: (
      prompt: string,
      scopedAgents: WorkflowAgent[],
      scopedSkills: WorkflowSkill[],
    ) => Promise<WorkflowDraft>
  }>(),
  { projects: () => [], defaultScope: 'global' },
)

const emit = defineEmits<{
  // scope: 'global' or a projectId — where the workflow is persisted.
  save: [draft: WorkflowDraft, scope: string]
  close: []
}>()

const { t } = useI18n()

const scope = ref(props.defaultScope)
const promptText = ref('')
const draft = ref<WorkflowDraft | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

// Reset transcript each time the panel opens.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    scope.value = props.defaultScope
    promptText.value = ''
    draft.value = null
    error.value = null
    isGenerating.value = false
  },
)

// Agents the LLM may wire — re-scoped to the modal's "Save to" target so a global
// workflow never references a project-only agent.
const scopedAgents = computed<WorkflowAgent[]>(() => {
  if (scope.value === 'global') return props.agents.filter((a) => a.source !== 'project')
  return props.agents.filter((a) => a.source !== 'project' || a.projectId === scope.value)
})

// Skills offered to the LLM — re-scoped the same way (preserve per-project skill
// scope: a global workflow only sees global skills; a project workflow sees global
// + that project's skills).
const scopedSkills = computed<WorkflowSkill[]>(() => {
  if (scope.value === 'global') return props.skills.filter((s) => s.source !== 'project')
  return props.skills.filter((s) => s.source !== 'project' || s.projectId === scope.value)
})

const canGenerate = computed(() => !isGenerating.value && promptText.value.trim().length > 0)

// Draft steps grouped by agent — the agent is the group header (like the project
// header in the session list), its skills/steps listed underneath. Project agents
// come first, then global; within each tier, first-appearance (pipeline) order.
// Step numbers keep the original DAG index so pipeline position stays legible.
type StepRow = { id: string; num: string; skillId: string; approval: boolean }
type StepGroup = {
  agentId: string
  agentName: string
  role: string
  scope: 'project' | 'global'
  steps: StepRow[]
}
const groupedSteps = computed<StepGroup[]>(() => {
  const d = draft.value
  if (!d) return []
  const byAgent = new Map<string, StepGroup>()
  const order: string[] = []
  d.nodes.forEach((n, i) => {
    let grp = byAgent.get(n.agentId)
    if (!grp) {
      const a = props.agents.find((x) => x.id === n.agentId)
      grp = {
        agentId: n.agentId,
        agentName: a?.name ?? n.agentId,
        role: a?.role ?? '',
        scope: (a?.source ?? n.agentSource) === 'project' ? 'project' : 'global',
        steps: [],
      }
      byAgent.set(n.agentId, grp)
      order.push(n.agentId)
    }
    grp.steps.push({
      id: n.id,
      num: (i + 1).toString().padStart(2, '0'),
      skillId: n.skillId,
      approval: n.approval,
    })
  })
  // Stable sort keeps first-appearance order within each scope tier.
  return order
    .map((id) => byAgent.get(id)!)
    .sort((a, b) => {
      if (a.scope === b.scope) return 0
      return a.scope === 'project' ? -1 : 1
    })
})

const onGenerate = async () => {
  const text = promptText.value.trim()
  if (!text || isGenerating.value) return
  isGenerating.value = true
  error.value = null
  try {
    draft.value = await props.generate(text, scopedAgents.value, scopedSkills.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onCreate = () => {
  if (!draft.value) return
  emit('save', { ...draft.value }, scope.value)
}

// Chặn đóng bằng scrim/Esc khi đang generate (nút X vẫn đóng như trước).
const guardDismiss = (e: Event) => {
  if (isGenerating.value) e.preventDefault()
}
</script>
