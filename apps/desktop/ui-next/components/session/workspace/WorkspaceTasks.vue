<template>
  <div class="wstasks">
    <div v-if="!entries.length" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.tasks.placeholder') }}</div>
    </div>

    <div v-else class="wstasks-list">
      <div v-for="entry in entries" :key="entry.key" class="wstasks-row">
        <Icon :name="entry.icon" style="width: 13px; height: 13px; color: var(--textDim)" />
        <div class="wstasks-main">
          <div class="wstasks-label">{{ entry.label }}</div>
          <div v-if="entry.target" class="wstasks-target">{{ entry.target }}</div>
        </div>
        <span class="wstasks-dot" :style="{ background: entry.color }" :title="entry.status" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Tasks tab (§5/§10) — ui-next has no dedicated tasks store/data source, so this is
// a minimal, graceful surface derived from the session's own transcript: it lists
// background-task steps (Bash/terminal commands + Task sub-agents) the session ran.
// No backend is invented; an empty session shows a clear placeholder. (NOTE: a true
// Tasks engine view would need a tasks store — out of scope here.)
import type { Session, StepBlock } from '~/composables/useSessionsMock'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()

type Entry = {
  key: string
  label: string
  target: string
  status: string
  color: string
  icon: string
}

// Tools that represent a background task in the transcript.
const TASK_TOOLS = new Set(['bash', 'terminal', 'task', 'subagent'])

const colorOf = (status: StepBlock['status']): string => {
  if (status === 'running') return 'var(--amber)'
  if (status === 'error') return 'var(--danger)'
  return 'var(--add)'
}

const entries = computed<Entry[]>(() => {
  const out: Entry[] = []
  props.session.msgs.forEach((m, mi) => {
    if (m.role !== 'assistant') return
    m.blocks.forEach((b, bi) => {
      if (b.kind !== 'step') return
      const toolLower = b.tool.toLowerCase()
      if (!TASK_TOOLS.has(toolLower) && !b.sub) return
      out.push({
        key: `${mi}-${bi}`,
        label: b.tool,
        target: b.target,
        status: b.status ?? 'done',
        color: colorOf(b.status),
        icon: b.sub || toolLower === 'task' ? 'agents' : 'commands',
      })
    })
  })
  // Running entries float to the top so an in-flight turn is obvious.
  return out.sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))
})
</script>

<style scoped>
.wstasks {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}
.wstasks-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wstasks-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bgSubtle);
}
.wstasks-main {
  min-width: 0;
  flex: 1;
}
.wstasks-label {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wstasks-target {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wstasks-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
