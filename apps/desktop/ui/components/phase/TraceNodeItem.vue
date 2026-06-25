<template>
  <div>
    <div
      class="flex items-center gap-2 py-1 px-2 rounded-lg transition min-w-0"
      :style="{
        marginLeft: depth * 14 + 'px',
        cursor: canToggle ? 'pointer' : 'default',
        background: hovered && canToggle ? t.bgHover : 'transparent',
      }"
      @click="canToggle && (open = !open)"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <div class="flex-shrink-0" :style="{ width: '10px' }">
        <ChevronRight
          v-if="canToggle"
          :size="10"
          :style="{
            color: t.textDim,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }"
        />
      </div>
      <div class="flex-shrink-0 flex items-center" :style="{ color: typeColor }">
        <Cpu v-if="item.type === 'agent'" :size="11" />
        <Zap v-else-if="item.type === 'subagent'" :size="11" />
        <Wrench v-else-if="item.type === 'tool'" :size="11" />
        <Sparkles v-else-if="item.type === 'thinking'" :size="11" />
        <ListChecks v-else-if="item.type === 'todo'" :size="11" />
      </div>
      <span
        class="text-[12px] leading-none uppercase tracking-wider font-semibold flex-shrink-0"
        :style="{ color: typeColor }"
      >
        {{ typeLabel }}
      </span>
      <template v-if="item.type === 'agent'">
        <span class="text-[1em] truncate flex-shrink-0" :style="{ color: t.text }">
          {{ item.name }}
        </span>
        <span class="text-[1em] flex-shrink-0" :style="{ color: t.textFaint }">·</span>
        <span class="text-[1em] truncate" :style="{ color: t.textDim }">{{ item.model }}</span>
      </template>
      <template v-else-if="item.type === 'subagent'">
        <span class="text-[1em] truncate flex-shrink-0" :style="{ color: t.text }">
          {{ item.agentName }}
        </span>
        <span class="text-[1em] flex-shrink-0" :style="{ color: t.textFaint }">·</span>
        <span class="text-[1em] truncate" :style="{ color: t.textDim }">{{ item.model }}</span>
      </template>
      <template v-else-if="item.type === 'tool'">
        <span class="text-[1em] font-mono flex-shrink-0" :style="{ color: t.text }">
          {{ item.tool }}
        </span>
        <span class="text-[1em] font-mono truncate min-w-0" :style="{ color: t.textMuted }">
          {{ item.input }}
        </span>
      </template>
      <template v-else-if="item.type === 'todo'">
        <span class="text-[1em] truncate" :style="{ color: t.text }">{{ item.name }}</span>
      </template>
      <span
        v-else-if="item.type === 'thinking' && detailText"
        class="text-[1em] italic truncate min-w-0"
        :style="{ color: t.textMuted }"
      >
        {{ detailText }}
      </span>
      <span
        class="ml-auto text-[12px] leading-none font-mono flex-shrink-0"
        :style="{ color: t.textDim }"
      >
        <span v-if="isRunning" class="inline-flex items-center gap-1" :style="{ color: t.text }">
          <Circle :size="6" class="animate-pulse" :style="{ fill: 'currentColor' }" />
          running
        </span>
        <template v-else>{{ item.duration }}</template>
      </span>
    </div>

    <!-- Expanded detail: subagent purpose, tool result, or full reasoning text.
         One-line rows stay collapsed by default; expanding reveals the full body. -->
    <div
      v-if="open && (item.purpose || detailText)"
      :style="{ marginLeft: depth * 14 + 22 + 'px' }"
    >
      <div
        v-if="item.type === 'subagent' && item.purpose"
        class="text-[1em] py-0.5"
        :style="{ color: t.textDim }"
      >
        {{ item.purpose }}
      </div>
      <div
        v-if="detailText && item.type !== 'thinking'"
        class="text-[1em] py-0.5 whitespace-pre-wrap break-words"
        :style="{ color: detailColor }"
      >
        {{ detailText }}
      </div>
      <div
        v-if="detailText && item.type === 'thinking'"
        class="text-[1em] py-0.5 italic whitespace-pre-wrap break-words"
        :style="{ color: detailColor }"
      >
        {{ detailText }}
      </div>
    </div>

    <div
      v-if="item.type === 'todo' && item.todos?.length"
      class="mt-0.5 space-y-0.5"
      :style="{ marginLeft: depth * 14 + 22 + 'px' }"
    >
      <div v-for="(todo, i) in item.todos" :key="i" class="flex items-start gap-1.5 text-[1em]">
        <span
          class="font-mono flex-shrink-0"
          :style="{ color: todoColor(todo.status), paddingTop: '1px' }"
        >
          {{ todoMark(todo.status) }}
        </span>
        <span
          class="min-w-0 break-words"
          :style="{
            color: todo.status === 'completed' ? t.textFaint : t.text,
            textDecoration: todo.status === 'completed' ? 'line-through' : 'none',
          }"
        >
          {{ todo.content }}
        </span>
      </div>
    </div>
    <div v-if="hasChildren && open">
      <TraceNodeItem
        v-for="child in item.children"
        :key="child.id"
        :item="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronRight, Cpu, Zap, Wrench, Sparkles, Circle, ListChecks } from 'lucide-vue-next'
import type { TodoStatus, TraceNode } from '~/types'

defineOptions({ name: 'TraceNodeItem' })

const props = defineProps<{
  item: TraceNode
  depth: number
}>()

const { t } = useTheme()

const hovered = ref(false)

const hasChildren = computed(() => !!(props.item.children && props.item.children.length > 0))
const isRunning = computed(() => props.item.status === 'running')

// Collapsible detail shown below the label row: a tool's result (⎿) or a
// thinking node's reasoning text. Null for container/todo nodes.
const detailText = computed<string | null>(() => {
  if (props.item.type === 'tool') return props.item.result ?? null
  if (props.item.type === 'thinking') return props.item.text ?? null
  return null
})
const detailColor = computed(() => {
  if (props.item.type === 'thinking') return t.value.textMuted
  // Tool result: errors are prefixed "[error] " by the trace-mapper.
  if (props.item.result?.startsWith('[error]')) return t.value.danger
  return t.value.textFaint
})

// A node is expandable when it has children (container) OR a collapsible detail.
const canToggle = computed(() => hasChildren.value || !!detailText.value)

// "Thấy step, đóng chi tiết" default: AGENT root opens (its tool steps show),
// while SUBAGENT sub-trees and per-step detail (tool result / reasoning) stay
// collapsed to a 1-line preview until the user clicks. Click toggles whichever
// this node owns (children for containers, detail for tool/thinking).
const open = ref(props.item.type === 'agent')

const typeLabel = computed(() => {
  switch (props.item.type) {
    case 'agent':
      return 'AGENT'
    case 'subagent':
      return 'SUBAGENT'
    case 'tool':
      return 'TOOL'
    case 'thinking':
      return 'THINK'
    case 'todo':
      return 'TODOS'
    default:
      return ''
  }
})

const TODO_MARK: Record<TodoStatus, string> = { pending: '○', in_progress: '▸', completed: '✓' }
const todoMark = (status: TodoStatus): string => TODO_MARK[status]
const todoColor = (status: TodoStatus): string => {
  if (status === 'completed') return t.value.success
  if (status === 'in_progress') return t.value.accent
  return t.value.textDim
}

const typeColor = computed(() => {
  switch (props.item.type) {
    case 'agent':
      return t.value.text
    case 'subagent':
      return t.value.info
    case 'tool':
      return t.value.textMuted
    case 'thinking':
      return t.value.textDim
    case 'todo':
      return t.value.accent
    default:
      return t.value.textDim
  }
})
</script>
