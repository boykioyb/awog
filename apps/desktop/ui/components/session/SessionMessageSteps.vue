<template>
  <div
    class="mt-2 rounded-md px-3 py-2 space-y-1"
    :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
  >
    <div
      class="flex items-center gap-2 pb-1.5 text-[0.71em] uppercase tracking-wider"
      :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
    >
      <span class="flex-1">{{ summary }}</span>
      <span class="font-mono normal-case tracking-normal">{{ steps.length }}</span>
    </div>
    <StepItem v-for="step in steps" :key="step.id" :step="step" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SessionStep } from '~/types'

const props = defineProps<{
  steps: SessionStep[]
}>()

const { t } = useTheme()

// Inline Claude-Code-style summary: "ran 9 commands · read 3 files · used 6 tools".
// Aggregates by stepFromToolUse's StepTool. Falls back to "N steps" if nothing
// matches a known bucket.
const summary = computed((): string => {
  let cmds = 0
  let reads = 0
  let writes = 0
  let searches = 0
  let subagents = 0
  let others = 0
  props.steps.forEach((s: SessionStep) => {
    if (s.tool === 'terminal') cmds += 1
    else if (s.tool === 'read') reads += 1
    else if (s.tool === 'write' || s.tool === 'edit') writes += 1
    else if (s.tool === 'search' || s.tool === 'find-files') searches += 1
    else if (s.tool === 'task') subagents += 1
    else others += 1
  })
  const parts: string[] = []
  if (cmds) parts.push(`ran ${cmds} command${cmds === 1 ? '' : 's'}`)
  if (reads) parts.push(`read ${reads} file${reads === 1 ? '' : 's'}`)
  if (writes) parts.push(`edited ${writes} file${writes === 1 ? '' : 's'}`)
  if (searches) parts.push(`${searches} search${searches === 1 ? '' : 'es'}`)
  if (subagents) parts.push(`${subagents} subagent${subagents === 1 ? '' : 's'}`)
  if (parts.length === 0 && others > 0) {
    return `${others} step${others === 1 ? '' : 's'}`
  }
  return parts.join(' · ')
})
</script>
