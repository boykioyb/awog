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
      <!-- subagent (Task) -->
      <div v-if="block.tool === 'Task' && block.sub" class="substep">
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
            <SessionCodeView
              v-if="st.tool === 'Edit' || st.tool === 'Write'"
              mode="diff"
              :fname="st.target"
              :lines="DEMO_DIFF"
            />
            <SessionCodeView
              v-else-if="st.tool === 'Read'"
              :fname="st.target"
              :code="st.detail || '// ...'"
            />
            <pre v-else class="cvcode plain">{{ st.detail || '(no output)' }}</pre>
          </div>
        </div>
      </div>

      <!-- skill -->
      <div
        v-else-if="block.tool === 'Skill'"
        style="font-size: 0.9231rem; color: var(--textMuted); line-height: 1.6"
      >
        {{ block.detail || t('sessions.step.skillRunning') }}
      </div>

      <!-- edit / write → diff -->
      <SessionCodeView
        v-else-if="block.tool === 'Edit' || block.tool === 'Write'"
        mode="diff"
        :fname="block.target"
        :lines="DEMO_DIFF"
      />

      <!-- read → code -->
      <SessionCodeView
        v-else-if="block.tool === 'Read'"
        :fname="block.target"
        :code="block.detail || '// (empty)'"
      />

      <!-- everything else → raw output -->
      <pre v-else class="cvcode plain">{{ block.detail || '(no output)' }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
// A single tool step (blockHtml step branch ~1461 + stepInner ~1479 + subHtml ~1486).
// Collapsed-by-default styling comes from .step.col in the prototype CSS.
import type { StepBlock } from '~/composables/useSessionsMock'

defineProps<{ block: StepBlock }>()
const { t } = useI18n()

const { DEMO_DIFF } = useSessionsMock()

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
const toggleSub = (i: number) => {
  if (subExpanded.has(i)) subExpanded.delete(i)
  else subExpanded.add(i)
}
</script>

<style scoped>
/* Match the prototype's inline `border:none;background:transparent;padding:4px 0;
   white-space:pre-wrap` on the raw-output <pre> (no dedicated class exists). */
.cvcode.plain {
  border: none;
  background: transparent;
  padding: 4px 0;
  white-space: pre-wrap;
}
/* Per-tool step glyph — subtle, consistent with the row's muted chrome. */
.stepic {
  flex: 0 0 auto;
  color: var(--textDim);
}
</style>
