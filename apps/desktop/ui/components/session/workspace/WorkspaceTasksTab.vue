<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.tab.tasks')" :icon="ListTodo" @close="close">
      <template #actions>
        <span
          v-if="entries.length"
          class="font-mono leading-none text-[12px]"
          :style="{ color: t.textDim }"
        >
          ({{ entries.length }})
        </span>
      </template>
    </WorkspaceDrawerHeader>

    <div v-if="!entries.length" class="flex-1 flex items-center justify-center px-6 text-center">
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.tasks.empty') }}</p>
    </div>

    <div v-else class="flex-1 overflow-y-auto">
      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        class="w-full text-left px-3 py-2 flex items-center gap-2 transition"
        :style="{ borderBottom: `1px solid ${t.border}`, color: t.text }"
        @click="open(entry.step)"
      >
        <component
          :is="entry.step.tool === 'task' ? Bot : TerminalSquare"
          :size="13"
          class="flex-shrink-0"
          :style="{ color: t.textDim }"
        />
        <div class="min-w-0 flex-1">
          <div class="text-[1em] truncate">{{ entry.step.label }}</div>
          <div
            v-if="entry.step.target"
            class="font-mono text-[12px] truncate"
            :style="{ color: t.textDim }"
          >
            {{ entry.step.target }}
          </div>
        </div>
        <span
          class="flex-shrink-0 w-2 h-2 rounded-full"
          :style="{ background: statusColor(entry.step.status) }"
          :title="entry.step.status ?? 'done'"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Bot, ListTodo, TerminalSquare } from 'lucide-vue-next'
import { computed, inject } from 'vue'
import type { Session, SessionStep, StepStatus } from '~/types'
import { SELECT_STEP_KEY } from '~/utils/step-context'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useWorkspacePanelStore()
const selectStep = inject(SELECT_STEP_KEY, null)

const close = () => panel.closeDrawer(props.session.id)

type Entry = { key: string; step: SessionStep }

// Background-task view: bash/terminal commands + Task subagents across the
// session. Running ones float to the top so an in-flight turn is obvious.
const entries = computed<Entry[]>(() => {
  const out: Entry[] = []
  props.session.messages.forEach((m) => {
    ;(m.steps ?? []).forEach((s) => {
      if (s.tool === 'terminal' || s.tool === 'task') {
        out.push({ key: `${m.id}-${s.id}`, step: s })
      }
    })
  })
  return out.sort(
    (a, b) => Number(b.step.status === 'running') - Number(a.step.status === 'running'),
  )
})

const statusColor = (status: StepStatus | undefined): string => {
  if (status === 'running') return t.value.statusWarn
  if (status === 'error') return t.value.danger
  return t.value.statusOk
}

const open = (step: SessionStep) => {
  if (selectStep) selectStep(step)
}
</script>
