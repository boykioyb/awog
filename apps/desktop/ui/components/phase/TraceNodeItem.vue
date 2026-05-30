<template>
  <div>
    <div
      class="flex items-start gap-2 py-1 px-1 rounded transition"
      :style="{
        paddingLeft: depth * 16 + 4 + 'px',
        cursor: hasChildren ? 'pointer' : 'default',
        background: hovered ? t.bgHover : 'transparent',
      }"
      @click="hasChildren && (expanded = !expanded)"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
    >
      <div :style="{ width: '12px', paddingTop: '2px' }">
        <ChevronRight
          v-if="hasChildren"
          :size="10"
          :style="{
            color: t.textDim,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }"
        />
      </div>
      <div :style="{ color: typeColor, paddingTop: '1px' }">
        <Cpu v-if="item.type === 'agent'" :size="11" />
        <Zap v-else-if="item.type === 'subagent'" :size="11" />
        <Wrench v-else-if="item.type === 'tool'" :size="11" />
        <Sparkles v-else-if="item.type === 'thinking'" :size="11" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="text-[0.64em] uppercase tracking-wider font-semibold flex-shrink-0"
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
            <span class="truncate" :style="{ color: t.textMuted }">{{ item.input }}</span>
            <span :style="{ color: t.textFaint }">)</span>
          </template>
          <template v-else-if="item.type === 'thinking'">
            <span class="italic" :style="{ color: t.textMuted }">{{ item.text }}</span>
          </template>
          <span class="ml-auto text-[0.71em] font-mono flex-shrink-0" :style="{ color: t.textDim }">
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
          class="text-[0.71em] mt-0.5"
          :style="{ color: t.textDim }"
        >
          {{ item.purpose }}
        </div>
        <div
          v-if="item.type === 'tool' && item.result"
          class="text-[0.71em] mt-0.5"
          :style="{ color: t.textDim }"
        >
          → {{ item.result }}
        </div>
      </div>
    </div>
    <div v-if="hasChildren && expanded">
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
import { ChevronRight, Cpu, Zap, Wrench, Sparkles, Circle } from 'lucide-vue-next'
import type { TraceNode } from '~/types'

defineOptions({ name: 'TraceNodeItem' })

const props = defineProps<{
  item: TraceNode
  depth: number
}>()

const { t } = useTheme()

const expanded = ref(true)
const hovered = ref(false)

const hasChildren = computed(() => !!(props.item.children && props.item.children.length > 0))
const isRunning = computed(() => props.item.status === 'running')

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
    default:
      return ''
  }
})

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
    default:
      return t.value.textDim
  }
})
</script>
