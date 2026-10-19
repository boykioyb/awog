<template>
  <div>
    <div
      class="flex min-w-0 items-center gap-2 rounded-sm px-2 py-0.5"
      :class="{ 'cursor-pointer hover:bg-accent': canToggle }"
      :style="{ marginLeft: `${depth * 14}px` }"
      @click="canToggle && (open = !open)"
    >
      <span class="w-2.5 shrink-0">
        <Icon
          v-if="canToggle"
          name="chev"
          class="size-2.5 text-dim transition-transform"
          :class="open ? 'rotate-0' : '-rotate-90'"
        />
      </span>
      <span class="shrink-0 text-xs font-semibold uppercase" :class="typeColor">
        {{ typeLabel }}
      </span>
      <template v-if="item.type === 'agent' || item.type === 'subagent'">
        <span class="shrink-0 truncate text-sm font-medium text-foreground">
          {{ item.name ?? item.agentName }}
        </span>
        <span v-if="item.model" class="shrink-0 text-faint">·</span>
        <span v-if="item.model" class="truncate text-sm text-dim">
          {{ item.model }}
        </span>
      </template>
      <template v-else-if="item.type === 'tool'">
        <span class="shrink-0 font-mono text-sm text-foreground">{{ item.tool }}</span>
        <span v-if="item.input" class="min-w-0 truncate font-mono text-sm text-muted-foreground">
          {{ item.input }}
        </span>
      </template>
      <template v-else-if="item.type === 'todo'">
        <span class="shrink-0 truncate text-sm font-medium text-foreground">
          {{ item.name }}
        </span>
      </template>
      <span
        v-else-if="item.type === 'thinking' && detailText"
        class="min-w-0 truncate text-sm text-muted-foreground italic"
      >
        {{ detailText }}
      </span>
      <span class="ml-auto shrink-0 text-xs tabular-nums text-dim">
        <span v-if="isRunning" class="text-foreground">{{ t('tasks.trace.running') }}</span>
        <template v-else>{{ item.duration }}</template>
      </span>
    </div>

    <div
      v-if="open && (item.purpose || detailText)"
      class="py-0.5"
      :style="{ marginLeft: `${depth * 14 + 22}px` }"
    >
      <div v-if="item.type === 'subagent' && item.purpose" class="py-0.5 text-sm text-dim">
        {{ item.purpose }}
      </div>
      <div
        v-if="detailText && item.type !== 'thinking'"
        class="py-0.5 text-sm break-words whitespace-pre-wrap"
        :class="detailColor"
      >
        {{ detailText }}
      </div>
      <div
        v-if="detailText && item.type === 'thinking'"
        class="py-0.5 text-sm break-words whitespace-pre-wrap text-muted-foreground italic"
      >
        {{ detailText }}
      </div>
    </div>

    <div
      v-if="item.type === 'todo' && item.todos?.length"
      class="py-0.5"
      :style="{ marginLeft: `${depth * 14 + 22}px` }"
    >
      <div v-for="(td, i) in item.todos" :key="i" class="flex items-start gap-1.5 text-sm">
        <!-- Ba dấu (○ ▸ ✓) có độ rộng khác nhau trong font hệ thống — hộp cố định 1em giữ cột chữ không xô lệch. -->
        <span class="w-[1em] shrink-0 text-center" :class="todoColor(td.status)">
          {{ todoMark(td.status) }}
        </span>
        <span
          class="min-w-0 break-words"
          :class="td.status === 'completed' ? 'text-faint line-through' : 'text-foreground'"
        >
          {{ td.content }}
        </span>
      </div>
    </div>

    <div v-if="hasChildren && open">
      <TaskTraceNode
        v-for="child in item.children"
        :key="child.id"
        :item="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Recursive execution-trace node. AGENT roots open by default; SUBAGENT sub-trees + per-row detail (tool
// result / reasoning) stay collapsed to a one-line preview until clicked.
import { computed, ref } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import type { TraceNode } from '~/stores/tasks'
import type { TodoStatus } from '~/types'

defineOptions({ name: 'TaskTraceNode' })

const props = defineProps<{ item: TraceNode; depth: number }>()

const { t } = useI18n()

const hasChildren = computed(() => !!(props.item.children && props.item.children.length > 0))
const isRunning = computed(() => props.item.status === 'running')

const detailText = computed<string | null>(() => {
  if (props.item.type === 'tool') return props.item.result ?? null
  if (props.item.type === 'thinking') return props.item.text ?? null
  return null
})
const detailColor = computed(() =>
  props.item.result?.startsWith('[error]') ? 'text-destructive' : 'text-faint',
)
const canToggle = computed(() => hasChildren.value || !!detailText.value)

const open = ref(props.item.type === 'agent')

const TYPE_LABEL: Record<TraceNode['type'], string> = {
  agent: 'AGENT',
  subagent: 'SUBAGENT',
  tool: 'TOOL',
  thinking: 'THINK',
  todo: 'TODOS',
}
const typeLabel = computed(() => TYPE_LABEL[props.item.type])

const TYPE_COLOR: Record<TraceNode['type'], string> = {
  agent: 'text-foreground',
  subagent: 'text-primary',
  tool: 'text-muted-foreground',
  thinking: 'text-dim',
  todo: 'text-primary',
}
const typeColor = computed(() => TYPE_COLOR[props.item.type])

const TODO_MARK: Record<TodoStatus, string> = { pending: '○', in_progress: '▸', completed: '✓' }
const todoMark = (status: TodoStatus): string => TODO_MARK[status]
const todoColor = (status: TodoStatus): string => {
  if (status === 'completed') return 'text-success'
  if (status === 'in_progress') return 'text-primary'
  return 'text-dim'
}
</script>
