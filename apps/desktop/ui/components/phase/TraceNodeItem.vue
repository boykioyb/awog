<template>
  <div>
    <div
      class="flex items-start gap-2 py-1 px-1 rounded transition"
      :style="{
        paddingLeft: depth * 16 + 4 + 'px',
        cursor: hasChildren ? 'pointer' : 'default',
        background: hovered ? t.bgHover : 'transparent',
      }"
      @click="canToggle && (open = !open)"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <div :style="{ width: '12px', paddingTop: '2px' }">
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
      <div :style="{ color: typeColor, paddingTop: '1px' }">
        <Cpu v-if="item.type === 'agent'" :size="11" />
        <Zap v-else-if="item.type === 'subagent'" :size="11" />
        <Wrench v-else-if="item.type === 'tool'" :size="11" />
        <Sparkles v-else-if="item.type === 'thinking'" :size="11" />
        <ListChecks v-else-if="item.type === 'todo'" :size="11" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="text-[1em] uppercase tracking-wider font-semibold flex-shrink-0"
            :style="{ color: typeColor }"
          >
            {{ typeLabel }}
          </span>
          <template v-if="item.type === 'agent'">
            <span :style="{ color: t.text }">{{ item.name }}</span>
            <span :style="{ color: t.textFaint }">·</span>
            <span :style="{ color: t.textDim }">{{ item.model }}</span>
          </template>
          <template v-else-if="item.type === 'subagent'">
            <span :style="{ color: t.text }">{{ item.agentName }}</span>
            <span :style="{ color: t.textFaint }">·</span>
            <span :style="{ color: t.textDim }">{{ item.model }}</span>
          </template>
          <template v-else-if="item.type === 'tool'">
            <span :style="{ color: t.text }">{{ item.tool }}</span>
            <span :style="{ color: t.textFaint }">(</span>
            <span class="min-w-0 break-all" :style="{ color: t.textMuted }">{{ item.input }}</span>
            <span :style="{ color: t.textFaint }">)</span>
          </template>
          <template v-else-if="item.type === 'todo'">
            <span :style="{ color: t.text }">{{ item.name }}</span>
          </template>
          <span class="ml-auto text-[1em] font-mono flex-shrink-0" :style="{ color: t.textDim }">
            <span
              v-if="isRunning"
              class="inline-flex items-center gap-1"
              :style="{ color: t.text }"
            >
              <Circle :size="6" class="animate-pulse" :style="{ fill: 'currentColor' }" />
              running
            </span>
            <template v-else>{{ item.duration }}</template>
          </span>
        </div>
        <div
          v-if="item.type === 'subagent' && item.purpose"
          class="text-[1em] mt-0.5"
          :style="{ color: t.textDim }"
        >
          {{ item.purpose }}
        </div>
        <!-- Collapsible detail: tool result (⎿) or reasoning text. Shows a 1-line
             preview when closed ("đóng chi tiết") and the full text — newlines
             preserved — when the node is expanded. ⎿ marker + faint style match
             the session timeline. -->
        <div v-if="detailText" class="flex items-start gap-1.5 text-[1em] mt-0.5 min-w-0">
          <span
            v-if="item.type === 'tool'"
            class="flex-shrink-0 font-mono"
            :style="{ color: t.textDim }"
          >
            ⎿
          </span>
          <span
            class="min-w-0"
            :class="[
              open ? 'whitespace-pre-wrap break-words' : 'truncate',
              item.type === 'thinking' ? 'italic' : '',
            ]"
            :style="{ color: detailColor }"
          >
            {{ detailText }}
          </span>
        </div>
        <div v-if="item.type === 'todo' && item.todos?.length" class="mt-1 space-y-0.5">
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
