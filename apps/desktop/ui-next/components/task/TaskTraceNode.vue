<template>
  <div class="ttn">
    <div
      class="ttn-row"
      :class="{ toggle: canToggle }"
      :style="{ marginLeft: `${depth * 14}px` }"
      @click="canToggle && (open = !open)"
    >
      <span class="ttn-chv">
        <Icon v-if="canToggle" name="chev" class="ttn-chvi" :class="{ open }" />
      </span>
      <span class="ttn-kind" :style="{ color: typeColor }">{{ typeLabel }}</span>
      <template v-if="item.type === 'agent' || item.type === 'subagent'">
        <span class="ttn-name">{{ item.name ?? item.agentName }}</span>
        <span v-if="item.model" class="ttn-dot">·</span>
        <span v-if="item.model" class="ttn-dim">{{ item.model }}</span>
      </template>
      <template v-else-if="item.type === 'tool'">
        <span class="ttn-tool mono">{{ item.tool }}</span>
        <span v-if="item.input" class="ttn-input mono">{{ item.input }}</span>
      </template>
      <template v-else-if="item.type === 'todo'">
        <span class="ttn-name">{{ item.name }}</span>
      </template>
      <span v-else-if="item.type === 'thinking' && detailText" class="ttn-think">
        {{ detailText }}
      </span>
      <span class="ttn-dur mono">
        <span v-if="isRunning" class="ttn-live">{{ t('tasks.trace.running') }}</span>
        <template v-else>{{ item.duration }}</template>
      </span>
    </div>

    <div
      v-if="open && (item.purpose || detailText)"
      class="ttn-detail"
      :style="{ marginLeft: `${depth * 14 + 22}px` }"
    >
      <div v-if="item.type === 'subagent' && item.purpose" class="ttn-purpose">
        {{ item.purpose }}
      </div>
      <div
        v-if="detailText && item.type !== 'thinking'"
        class="ttn-detail-body"
        :style="{ color: detailColor }"
      >
        {{ detailText }}
      </div>
      <div v-if="detailText && item.type === 'thinking'" class="ttn-detail-body think">
        {{ detailText }}
      </div>
    </div>

    <div
      v-if="item.type === 'todo' && item.todos?.length"
      class="ttn-todos"
      :style="{ marginLeft: `${depth * 14 + 22}px` }"
    >
      <div v-for="(td, i) in item.todos" :key="i" class="ttn-todo">
        <span class="ttn-todo-mark" :style="{ color: todoColor(td.status) }">
          {{ todoMark(td.status) }}
        </span>
        <span class="ttn-todo-text" :class="{ done: td.status === 'completed' }">
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
// Recursive execution-trace node — port of the old UI TraceNodeItem in prototype
// CSS. AGENT roots open by default; SUBAGENT sub-trees + per-row detail (tool
// result / reasoning) stay collapsed to a one-line preview until clicked.
import { computed, ref } from 'vue'
import Icon from '~/components/Icon.vue'
import { useI18n } from '~/composables/useI18n'
import type { TodoStatus, TraceNode } from '~/stores/tasks'

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
  props.item.result?.startsWith('[error]') ? 'var(--danger)' : 'var(--textFaint)',
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
  agent: 'var(--text)',
  subagent: 'var(--accent)',
  tool: 'var(--textMuted)',
  thinking: 'var(--textDim)',
  todo: 'var(--accent)',
}
const typeColor = computed(() => TYPE_COLOR[props.item.type])

const TODO_MARK: Record<TodoStatus, string> = { pending: '○', in_progress: '▸', completed: '✓' }
const todoMark = (status: TodoStatus): string => TODO_MARK[status]
const todoColor = (status: TodoStatus): string => {
  if (status === 'completed') return 'var(--green)'
  if (status === 'in_progress') return 'var(--accent)'
  return 'var(--textDim)'
}
</script>

<style scoped>
.ttn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 7px;
  border-radius: 7px;
  min-width: 0;
}
.ttn-row.toggle {
  cursor: pointer;
}
.ttn-row.toggle:hover {
  background: var(--bgHover);
}
.ttn-chv {
  width: 10px;
  flex: 0 0 auto;
}
.ttn-chvi {
  width: 10px;
  height: 10px;
  color: var(--textDim);
  transition: transform 0.15s;
  transform: rotate(-90deg);
}
.ttn-chvi.open {
  transform: rotate(0deg);
}
.ttn-kind {
  font-size: 0.7692rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 650;
  flex: 0 0 auto;
}
.ttn-name {
  font-size: 0.9231rem;
  color: var(--text);
  flex: 0 0 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ttn-dot {
  color: var(--textFaint);
  flex: 0 0 auto;
}
.ttn-dim {
  font-size: 0.9231rem;
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ttn-tool {
  font-size: 0.9231rem;
  color: var(--text);
  flex: 0 0 auto;
}
.ttn-input {
  font-size: 0.9231rem;
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.ttn-think {
  font-size: 0.9231rem;
  font-style: italic;
  color: var(--textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.ttn-dur {
  margin-left: auto;
  font-size: 0.7692rem;
  color: var(--textDim);
  flex: 0 0 auto;
}
.ttn-live {
  color: var(--text);
}
.ttn-detail,
.ttn-todos {
  padding: 2px 0;
}
.ttn-purpose {
  font-size: 0.9231rem;
  color: var(--textDim);
  padding: 2px 0;
}
.ttn-detail-body {
  font-size: 0.9231rem;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 2px 0;
}
.ttn-detail-body.think {
  font-style: italic;
  color: var(--textMuted);
}
.ttn-todo {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.9231rem;
}
.ttn-todo-mark {
  font-family: var(--code);
  flex: 0 0 auto;
}
.ttn-todo-text {
  min-width: 0;
  word-break: break-word;
  color: var(--text);
}
.ttn-todo-text.done {
  color: var(--textFaint);
  text-decoration: line-through;
}
</style>
