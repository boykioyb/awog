<template>
  <div class="step" :class="{ col: collapsed }">
    <div class="steph" @click="collapsed = !collapsed">
      <Icon :name="stepIcon(block.tool)" class="stepic" style="width: 13px; height: 13px" />
      <span class="tname">{{ block.tool }}</span>
      <span class="starg">{{ block.target }}</span>
      <SessionStepResult :text="block.result" />
      <Icon name="chev" style="width: 13px; height: 13px" />
    </div>
    <div class="stepd">
      <!-- subagent (has children) -->
      <div v-if="block.sub" class="substep">
        <div class="subhd">
          <Icon name="agents" style="width: 12px; height: 12px" />
          {{ block.sub.agent }}
        </div>
        <div
          v-for="(st, i) in block.sub.steps"
          :key="i"
          class="step"
          :class="{ col: !subExpanded.has(i) }"
        >
          <div class="steph" @click="toggleSub(i)">
            <Icon :name="stepIcon(st.tool)" class="stepic" style="width: 13px; height: 13px" />
            <span class="tname">{{ st.tool }}</span>
            <span class="starg">{{ st.target }}</span>
            <SessionStepResult :text="st.result" />
            <Icon name="chev" style="width: 13px; height: 13px" />
          </div>
          <div class="stepd">
            <SessionStepBody
              :tool="st.tool"
              :target="st.target"
              :detail="st.detail"
              :detail-kind="st.detailKind"
            />
          </div>
        </div>
        <!-- The subagent's final report — the summary it returns to the main agent
             (Task tool result). Without this the nested timeline ends at the last
             tool call and the handed-back summary is invisible. -->
        <div v-if="summaryText" class="subsum">
          <div class="subhd">
            <Icon name="check" style="width: 12px; height: 12px" />
            {{ t('sessions.step.subagentSummary') }}
          </div>
          <SessionTextBlock :text="summaryText" />
        </div>
      </div>

      <!-- skill -->
      <div
        v-else-if="isSkill"
        style="font-size: 0.9231rem; color: var(--textMuted); line-height: 1.6"
      >
        {{ block.detail || t('sessions.step.skillRunning') }}
      </div>

      <!-- diff / file / output — real detail (mock DEMO_DIFF fallback inside) -->
      <SessionStepBody
        v-else
        :tool="block.tool"
        :target="block.target"
        :detail="block.detail"
        :detail-kind="block.detailKind"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// A single tool step (blockHtml step branch ~1461 + stepInner ~1479 + subHtml ~1486).
// Collapsed-by-default styling comes from .step.col in the prototype CSS.
import type { StepBlock } from '~/composables/useSessionsData'

const props = defineProps<{ block: StepBlock }>()
const { t } = useI18n()

// Subagent steps render via the sub-step loop (when `block.sub` is set); a Skill
// step shows its description text; everything else delegates to SessionStepBody.
const isSkill = computed(() => /skill/i.test(props.block.tool))

// A subagent's (Task) final report = the text it returns to the main agent, carried
// on the step's `detail` (full, up to ~2k chars) or the truncated `result` chip.
// Surfaced as a concluding summary block under the nested sub-steps.
const summaryText = computed(() => {
  const b = props.block
  if (!b.sub) return ''
  if (b.detail && (!b.detailKind || b.detailKind === 'text')) return b.detail
  return b.result ?? ''
})

// Per-tool glyph for the step header. Matches both canonical tool names (mock:
// Read/Edit/Bash/…) and the engine's human labels ("Run", "Search", "Update", …)
// via keyword. Keeps a recognizable icon per step type instead of a bare row.
function stepIcon(tool: string): string {
  const k = (tool || '').toLowerCase()
  if (k.includes('task') || k.includes('agent')) return 'agents'
  if (k.includes('skill')) return 'skills'
  if (k.includes('grep') || k.includes('search')) return 'search'
  if (k.includes('glob') || k.includes('find')) return 'folder'
  if (k.includes('read')) return 'rules'
  if (
    k.includes('edit') ||
    k.includes('write') ||
    k.includes('update') ||
    k.includes('create') ||
    k.includes('notebook')
  )
    return 'edit'
  if (
    k.includes('bash') ||
    k.includes('run') ||
    k.includes('exec') ||
    k.includes('shell') ||
    k.includes('command') ||
    k.includes('kill')
  )
    return 'commands'
  if (k.includes('web') || k.includes('fetch')) return 'search'
  if (k.includes('todo')) return 'check'
  if (k.includes('git')) return 'git'
  if (k.includes('plan')) return 'rules'
  return 'commands'
}

// Collapsed-by-default: header click toggles the step body (.step.col hides .stepd).
const collapsed = ref(true)

// Nested sub-steps collapse independently; track expanded indices in a reactive Set.
const subExpanded = reactive(new Set<number>())

// Transcript-wide collapse-all / expand-all: follow the broadcast signal, mirroring
// the body's open state across every nested sub-step too. Manual clicks still work
// (they just set local state until the next broadcast).
const fold = useStepFold()
watch(
  () => fold.signal.seq,
  () => {
    const expand = fold.signal.mode === 'expand'
    collapsed.value = !expand
    subExpanded.clear()
    if (expand && props.block.sub) props.block.sub.steps.forEach((_, i) => subExpanded.add(i))
  },
)
const toggleSub = (i: number) => {
  if (subExpanded.has(i)) subExpanded.delete(i)
  else subExpanded.add(i)
}
</script>

<style scoped>
/* Flat steps: drop the grey fill (prototype .step uses var(--bgSubtle)); keep the
   hairline border so the row still reads as a discrete unit on the message bg. */
.step {
  background: transparent;
}
/* Per-tool step glyph — subtle, consistent with the row's muted chrome. */
.stepic {
  flex: 0 0 auto;
  color: var(--textDim);
}
/* Sharper, more interactive step cards: hover feedback on the header (the whole
   row is the clickable expand toggle), with a tidy accent on the open state. */
.step > .steph {
  transition: background 0.12s ease;
}
.step > .steph:hover {
  background: var(--bgHover);
}
/* Subagent summary: the report handed back to the main agent, under the nested
   steps. Compact (step-context) markdown with a small top divider. */
.subsum {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 0.9231rem;
}
</style>
