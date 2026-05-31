<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[280px]">
    <div v-if="messages.length === 0 && !streamingText && !streamingSteps.length">
      <slot name="empty" />
    </div>

    <div v-for="(msg, i) in messages" :key="i">
      <div v-if="msg.role === 'user'" class="flex flex-col items-end gap-1">
        <div
          class="rounded-2xl px-3.5 py-2 text-[1em] leading-relaxed whitespace-pre-wrap"
          :style="{
            background: t.bgElevated,
            color: t.text,
            border: `1px solid ${t.border}`,
            maxWidth: '85%',
          }"
        >
          {{ msg.text }}
        </div>
      </div>

      <div
        v-else
        class="rounded-2xl px-3.5 py-2.5 text-[1em] leading-relaxed"
        :style="{
          background: t.bgElevated,
          border: `1px solid ${t.border}`,
          maxWidth: '95%',
        }"
      >
        <div
          class="flex items-center gap-1.5 mb-1.5 text-[1em] uppercase tracking-wider"
          :style="{ color: t.textFaint }"
        >
          <Sparkles :size="10" :style="{ color: t.accent }" />
          <span :style="{ color: t.textDim }">Assistant</span>
          <span class="flex-1" />
          <button
            v-if="msg.text"
            type="button"
            class="awog-copy-btn"
            :style="{ color: copiedIdx === i ? t.success : t.textDim }"
            :title="copiedIdx === i ? 'Copied' : 'Copy message'"
            @click="copyMessage(msg.text, i)"
          >
            <Check v-if="copiedIdx === i" :size="11" />
            <Copy v-else :size="11" />
          </button>
        </div>

        <MarkdownStreamBody
          v-if="msg.text"
          :text="msg.text"
          :streaming="false"
          class="awog-md text-[1em]"
          :style="{ color: t.text, '--awog-accent': t.accent }"
        />

        <button
          v-if="msg.steps?.length"
          type="button"
          class="inline-flex items-center gap-1.5 text-[1em] py-0.5 px-1.5 -ml-1.5 rounded transition hover:bg-white/5"
          :class="msg.text ? 'mt-2' : ''"
          :style="{ color: t.textDim }"
          @click="openStepsModal(i)"
        >
          <Info :size="11" />
          <span>{{ stepsSummary(msg.steps) }}</span>
          <Activity
            v-if="hasRunningStep(msg.steps)"
            :size="10"
            class="animate-pulse"
            :style="{ color: t.accent }"
          />
          <ChevronRight :size="10" />
        </button>
      </div>
    </div>

    <div
      v-if="streamingText || streamingSteps.length > 0"
      class="rounded-2xl px-3.5 py-2.5 text-[1em] leading-relaxed"
      :style="{
        background: t.bgElevated,
        border: `1px solid ${t.border}`,
        maxWidth: '95%',
      }"
    >
      <div
        class="flex items-center gap-1.5 mb-1.5 text-[1em] uppercase tracking-wider"
        :style="{ color: t.textFaint }"
      >
        <Sparkles :size="10" :style="{ color: t.accent }" />
        <span :style="{ color: t.textDim }">Assistant</span>
        <span class="flex-1" />
        <Activity :size="10" class="animate-pulse" :style="{ color: t.accent }" />
      </div>

      <MarkdownStreamBody
        v-if="streamingText"
        :text="streamingText"
        :streaming="true"
        class="awog-md text-[1em]"
        :style="{ color: t.text, '--awog-accent': t.accent }"
      />

      <button
        v-if="streamingSteps.length > 0"
        type="button"
        class="inline-flex items-center gap-1.5 text-[1em] py-0.5 px-1.5 -ml-1.5 rounded transition hover:bg-white/5"
        :class="streamingText ? 'mt-2' : ''"
        :style="{ color: t.textDim }"
        @click="openStreamingStepsModal"
      >
        <Info :size="11" />
        <span>{{ stepsSummary(streamingSteps) }}</span>
        <Activity
          v-if="hasRunningStep(streamingSteps)"
          :size="10"
          class="animate-pulse"
          :style="{ color: t.accent }"
        />
        <ChevronRight :size="10" />
      </button>
    </div>

    <div v-if="error" class="text-[1em]" :style="{ color: t.danger }">{{ error }}</div>
  </div>

  <Teleport to="body">
    <div
      v-if="stepsModalSteps"
      class="fixed inset-0 z-[60] flex items-center justify-center p-4"
      :style="{ background: t.overlay }"
      @click.self="closeStepsModal"
    >
      <div
        class="w-full max-w-2xl rounded-lg shadow-xl flex flex-col"
        :style="{
          background: t.bgElevated,
          border: `1px solid ${t.border}`,
          maxHeight: '80vh',
        }"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="px-4 py-3 flex items-center gap-2"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <Info :size="13" :style="{ color: t.textDim }" />
          <div class="text-[1em] font-semibold" :style="{ color: t.text }">
            {{ stepsSummary(stepsModalSteps) }}
          </div>
          <span
            class="ml-auto font-mono text-[1em]"
            :style="{ color: t.textDim }"
            :title="`${stepsModalSteps.length} total step(s)`"
          >
            {{ stepsModalSteps.length }}
          </span>
          <button
            type="button"
            class="p-1 rounded transition flex items-center"
            :style="{ color: t.textDim }"
            aria-label="Close"
            @click="closeStepsModal"
          >
            <X :size="14" />
          </button>
        </div>
        <div class="px-4 py-3 overflow-y-auto space-y-1 flex-1">
          <StepItem v-for="step in stepsModalSteps" :key="step.id" :step="step" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Activity, Check, ChevronRight, Copy, Info, Sparkles, X } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import type { SessionStep } from '~/types'

interface ChatMsg {
  role: 'user' | 'agent'
  text: string
  steps?: SessionStep[]
}

const props = defineProps<{
  messages: ChatMsg[]
  streamingText: string
  streamingSteps: SessionStep[]
  error?: string | null
}>()

const { t } = useTheme()

const scrollRef = ref<HTMLElement | null>(null)

const scrollToBottom = () => {
  nextTick(() => {
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

defineExpose({ scrollToBottom })

// Auto-scroll on incoming content. Watching length of messages + streaming text
// covers both new turns and live chunks.
watch(
  () => [props.messages.length, props.streamingText.length, props.streamingSteps.length],
  () => scrollToBottom(),
)

const copiedIdx = ref<number | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const copyMessage = async (text: string, idx: number) => {
  try {
    await navigator.clipboard.writeText(text)
    copiedIdx.value = idx
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedIdx.value = null
    }, 1500)
  } catch {
    // clipboard denied — ignore
  }
}

const hasRunningStep = (steps: SessionStep[]): boolean =>
  steps.some((s) => s.status === 'running' || s.status === undefined)

// Mirror SessionMessageList.stepsSummary so behaviour matches /sessions exactly.
const stepsSummary = (steps: SessionStep[]): string => {
  let cmds = 0
  let reads = 0
  let writes = 0
  let searches = 0
  let subagents = 0
  let others = 0
  steps.forEach((s) => {
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
}

// Steps modal: indexes by either message index (`m:i`) or the streaming sentinel
// (`s`). Keeps the modal open while streaming so the user can watch StepItem
// expansions live.
const stepsModalKey = ref<string | null>(null)

const openStepsModal = (i: number) => {
  stepsModalKey.value = `m:${i}`
}
const openStreamingStepsModal = () => {
  stepsModalKey.value = 's'
}
const closeStepsModal = () => {
  stepsModalKey.value = null
}

const stepsModalSteps = computed<SessionStep[] | null>(() => {
  const key = stepsModalKey.value
  if (!key) return null
  if (key === 's') return props.streamingSteps
  const idx = Number(key.slice(2))
  return props.messages[idx]?.steps ?? null
})
</script>
