<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on wfpc-ovl" @click.self="onBackdrop">
      <div class="wfpc" role="dialog" aria-modal="true">
        <div class="wfpc-hd">
          <Icon name="sparkles" style="width: 13px; height: 13px; color: var(--accent)" />
          <span class="wfpc-title">{{ t('workflow.creator.headline') }}</span>
          <span class="wfpc-sub">{{ t('workflow.creator.subheadline') }}</span>
          <span style="flex: 1" />
          <button class="iconbtn wfpc-x" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <div class="wfpc-body">
          <LibraryScopePicker v-model="scope" :projects="projects" />

          <textarea
            v-model="promptText"
            class="wfpc-ta"
            rows="5"
            :disabled="isGenerating"
            :placeholder="t('workflow.creator.placeholder')"
            @keydown.enter.exact.prevent="onGenerate"
          />

          <div v-if="error" class="wfpc-err">{{ error }}</div>

          <!-- generated draft preview -->
          <div v-if="draft" class="wfpc-draft">
            <div class="wfpc-draft-hd">
              <Icon name="workflows" style="width: 12px; height: 12px; color: var(--textDim)" />
              <span class="wfpc-draft-name">{{ draft.name }}</span>
            </div>
            <div class="wfpc-draft-desc">{{ draft.description }}</div>
            <!-- Steps grouped by agent (project agents first), the agent name as
                 the group header and its skills/steps listed underneath. -->
            <div v-if="draft.nodes.length" class="wfpc-groups">
              <div v-for="grp in groupedSteps" :key="grp.agentId" class="wfpc-group">
                <div class="wfpc-group-hd">
                  <Icon name="agents" style="width: 12px; height: 12px; color: var(--textDim)" />
                  <span class="wfpc-group-name">{{ grp.agentName }}</span>
                  <span v-if="grp.role" class="wfpc-group-role">{{ grp.role }}</span>
                </div>
                <div class="wfpc-group-steps">
                  <div v-for="s in grp.steps" :key="s.id" class="wfpc-step">
                    <span class="wfpc-step-n tnum">{{ s.num }}</span>
                    <span class="wfpc-step-skill">
                      {{ s.skillId || t('workflow.node.noSkill') }}
                    </span>
                    <Icon
                      v-if="s.approval"
                      name="shield"
                      style="width: 11px; height: 11px; color: var(--amber)"
                      :title="t('workflow.node.approvalGate')"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div class="wfpc-draft-hint">
              {{
                draft.nodes.length
                  ? t('workflow.creator.stepsGenerated', { count: draft.nodes.length })
                  : t('workflow.creator.dragHint')
              }}
            </div>
          </div>
        </div>

        <div class="wfpc-foot">
          <span class="wfpc-foothint">{{ t('workflow.creator.sendHint') }}</span>
          <span style="flex: 1" />
          <button v-if="draft" class="btn sm" :disabled="isGenerating" @click="onGenerate">
            <Icon
              name="refresh"
              :class="{ spin: isGenerating }"
              style="width: 13px; height: 13px"
            />
            {{ t('workflow.creator.regenerate') }}
          </button>
          <button v-if="!draft" class="btn pri sm" :disabled="!canGenerate" @click="onGenerate">
            <Icon
              :name="isGenerating ? 'refresh' : 'sparkles'"
              :class="{ spin: isGenerating }"
              style="width: 13px; height: 13px"
            />
            {{ isGenerating ? t('workflow.creator.generating') : t('workflow.creator.generate') }}
          </button>
          <button v-if="draft" class="btn pri sm" @click="onCreate">
            <Icon name="save" style="width: 13px; height: 13px" />
            {{ t('workflow.creator.create') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
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

const onBackdrop = () => {
  if (isGenerating.value) return
  emit('close')
}
</script>

<style scoped>
.wfpc-ovl {
  align-items: center;
  padding-top: 0;
}
.wfpc {
  width: 680px;
  max-width: 94vw;
  max-height: 86vh;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
}
.wfpc-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.wfpc-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.wfpc-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.wfpc-x {
  width: 28px;
  height: 28px;
}
.wfpc-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wfpc-ta {
  width: 100%;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
  outline: none;
  resize: vertical;
  min-height: 7rem;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.55;
  font-family: var(--sans);
}
.wfpc-ta:focus {
  border-color: var(--borderStrong);
}
.wfpc-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.wfpc-draft {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 12px;
}
.wfpc-draft-hd {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}
.wfpc-draft-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.wfpc-draft-desc {
  font-size: var(--fs-sm);
  color: var(--textMuted);
  line-height: 1.5;
}
.wfpc-groups {
  margin-top: 9px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.wfpc-group-hd {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.wfpc-group-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.wfpc-group-role {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.wfpc-group-steps {
  margin-top: 3px;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wfpc-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.wfpc-step-n {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.wfpc-step-skill {
  color: var(--textDim);
}
.wfpc-draft-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  margin-top: 9px;
}
.wfpc-foot {
  flex: 0 0 auto;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
}
.wfpc-foothint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.btn.pri.sm:disabled,
.btn.sm:disabled {
  opacity: 0.45;
  cursor: default;
  filter: none;
}
.spin {
  animation: wfpc-spin 0.9s linear infinite;
}
@keyframes wfpc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
