<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
    <div v-for="msg in messages" :key="msg.id">
      <div
        v-if="msg.role === 'system'"
        class="text-center text-[10px] uppercase tracking-wider"
        :style="{ color: t.textDim }"
      >
        ── {{ msg.text }} · {{ fmt(msg.at) }} ──
      </div>

      <div v-else>
        <div v-if="msg.role === 'user'" class="flex flex-col items-end gap-1.5">
          <div
            v-if="msg.text"
            class="rounded-2xl px-4 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
            :style="{
              background: t.bgElevated,
              color: t.text,
              border: `1px solid ${t.border}`,
              maxWidth: '78%',
            }"
          >
            <template v-for="(seg, i) in tokenizeMessage(msg.text)" :key="i">
              <span
                v-if="seg.kind === 'token'"
                :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
              >
                {{ seg.text }}
              </span>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
          <div
            v-if="msg.attachments?.length"
            class="flex flex-wrap gap-1.5 justify-end"
            :style="{ maxWidth: '78%' }"
          >
            <template v-for="att in msg.attachments" :key="att.id">
              <button
                v-if="att.type === 'image' && att.url"
                type="button"
                class="rounded-md overflow-hidden relative group transition"
                :style="{
                  width: '160px',
                  height: '100px',
                  border: `1px solid ${t.border}`,
                  background: t.bgSubtle,
                }"
                :title="`View ${att.name}${att.size ? ` · ${att.size}` : ''}`"
                @click="emit('openAttachment', att)"
              >
                <img
                  :src="att.url"
                  :alt="att.name"
                  class="w-full h-full object-cover"
                  draggable="false"
                />
                <div
                  class="absolute inset-x-0 bottom-0 px-2 py-1 flex items-center gap-1"
                  :style="{
                    background: t.overlay,
                    backdropFilter: 'blur(4px)',
                  }"
                >
                  <span
                    class="text-[10px] font-mono truncate flex-1 text-left"
                    :style="{ color: t.onAccent }"
                  >
                    {{ att.name }}
                  </span>
                  <Maximize2 :size="10" :style="{ color: t.onAccent, flexShrink: 0 }" />
                </div>
              </button>
              <button
                v-else
                type="button"
                class="rounded-md flex items-center gap-2.5 px-3 text-left transition"
                :style="{
                  height: '44px',
                  minWidth: '180px',
                  maxWidth: '260px',
                  background: t.bgSubtle,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  cursor: att.preview ? 'pointer' : 'default',
                  opacity: att.preview ? 1 : 0.85,
                }"
                :disabled="!att.preview"
                :title="
                  att.preview
                    ? `View ${att.name}${att.size ? ` · ${att.size}` : ''}`
                    : `${att.name}${att.size ? ` · ${att.size}` : ''}`
                "
                @click="emit('openAttachment', att)"
              >
                <component
                  :is="fileIconFor(att.name).icon"
                  :size="18"
                  class="flex-shrink-0"
                  :style="{ color: fileIconFor(att.name).color }"
                />
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-[12px] truncate" :style="{ color: t.text }">
                    {{ att.name }}
                  </div>
                  <div
                    class="text-[10px] truncate flex items-center gap-1.5"
                    :style="{ color: t.textFaint }"
                  >
                    <span :style="{ color: fileIconFor(att.name).color, fontWeight: 500 }">
                      {{ fileIconFor(att.name).label }}
                    </span>
                    <span v-if="att.size">· {{ att.size }}</span>
                  </div>
                </div>
              </button>
            </template>
          </div>
          <div class="text-[9px] flex items-center gap-1.5" :style="{ color: t.textFaint }">
            <span>{{ fmt(msg.at) }}</span>
            <span v-if="msg.modeAtSend">· sent in {{ msg.modeAtSend }} mode</span>
          </div>
        </div>

        <div
          v-if="msg.role === 'agent'"
          class="rounded-2xl px-4 py-3 text-[13px] leading-relaxed"
          :style="{
            background: t.bgElevated,
            border: `1px solid ${t.border}`,
            maxWidth: '92%',
          }"
        >
          <div
            class="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider"
            :style="{ color: t.textFaint }"
          >
            <Sparkles :size="10" :style="{ color: t.accent }" />
            <span :style="{ color: t.textDim }">Assistant</span>
            <template v-if="msg.modelUsed">
              <span>·</span>
              <span class="font-mono normal-case tracking-normal">{{ msg.modelUsed }}</span>
            </template>
            <template v-if="msg.at">
              <span>·</span>
              <span class="normal-case tracking-normal">{{ fmt(msg.at) }}</span>
            </template>
            <span class="flex-1" />
            <button
              v-if="msg.text"
              type="button"
              class="awog-copy-btn"
              :style="{ color: copiedId === msg.id ? t.success : t.textDim }"
              :title="copiedId === msg.id ? 'Copied' : 'Copy message'"
              @click="copyMessage(msg)"
            >
              <Check v-if="copiedId === msg.id" :size="12" />
              <Copy v-else :size="12" />
            </button>
          </div>

          <!-- eslint-disable vue/no-v-html — renderMarkdown qua marked html:false, escape HTML thô (an toàn XSS) -->
          <div
            v-if="msg.text"
            class="awog-md text-[13px]"
            :style="{ color: t.text, '--awog-accent': t.accent }"
            :data-agent-message-id="msg.id"
            v-html="renderMarkdown(msg.text)"
          />
          <!-- eslint-enable vue/no-v-html -->

          <button
            v-if="msg.steps?.length"
            type="button"
            class="inline-flex items-center gap-1.5 text-[11px] py-0.5 px-1.5 -ml-1.5 rounded transition hover:bg-white/5"
            :class="msg.text ? 'mt-2' : ''"
            :style="{ color: t.textDim }"
            @click="openStepsModal(msg.id)"
          >
            <Info :size="11" />
            <span>{{ stepsSummary(msg.steps) }}</span>
            <Activity
              v-if="hasRunningStep(msg)"
              :size="10"
              class="animate-pulse"
              :style="{ color: t.accent }"
            />
            <ChevronRight :size="10" />
          </button>

          <SessionInlinePermission
            v-if="store.pendingPermission?.messageId === msg.id"
            :message-id="msg.id"
            class="mt-2"
          />

          <div
            v-if="msg.startedAt"
            class="mt-2 pt-2 text-[10px] flex items-center gap-2"
            :style="{ color: t.textFaint, borderTop: `1px dashed ${t.border}` }"
          >
            <template v-if="msg.completedAt">
              <span>{{ formatElapsed(msg.completedAt - msg.startedAt) }}</span>
              <span v-if="msg.usage">· {{ msg.usage.outputTokens }} tok</span>
            </template>
            <template v-else>
              <Activity :size="10" class="animate-pulse" />
              <span>Streaming… {{ formatElapsed(now - msg.startedAt) }}</span>
            </template>
          </div>

          <div v-if="msg.artifacts?.length" class="mt-2 space-y-1.5">
            <div
              v-for="art in msg.artifacts"
              :key="art.name"
              class="rounded"
              :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
            >
              <div
                class="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]"
                :style="{ borderBottom: art.preview ? `1px solid ${t.border}` : 'none' }"
              >
                <FileText :size="11" :style="{ color: t.textDim }" />
                <span class="font-mono" :style="{ color: t.text }">{{ art.name }}</span>
              </div>
              <pre
                v-if="art.preview"
                class="text-[11px] px-2.5 py-2 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap"
                :style="{ color: t.textMuted, maxHeight: '160px' }"
                >{{ art.preview }}</pre
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-for="agentId in pendingAgentIds"
      :key="`pending-${agentId}`"
      class="flex gap-1.5 items-center"
    >
      <Activity :size="11" class="animate-pulse" :style="{ color: t.textDim }" />
      <span class="text-[11px]" :style="{ color: t.textDim }">
        {{ agentName(agentId) }} đang phản hồi...
      </span>
    </div>
  </div>

  <Teleport to="body">
    <button
      v-if="quotePopup"
      type="button"
      class="fixed z-50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] shadow-lg transition"
      :style="{
        top: `${quotePopup.top}px`,
        left: `${quotePopup.left}px`,
        background: t.bgElevated,
        color: t.text,
        border: `1px solid ${t.border}`,
      }"
      @mousedown.prevent
      @click="addQuoteFollowUp"
    >
      <Quote :size="11" :style="{ color: t.accent }" />
      Quote &amp; follow up
    </button>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="stepsModalMsg"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
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
          <div class="text-[13px] font-semibold" :style="{ color: t.text }">
            {{ stepsSummary(stepsModalMsg.steps ?? []) }}
          </div>
          <span
            class="ml-auto font-mono text-[10px]"
            :style="{ color: t.textDim }"
            :title="`${stepsModalMsg.steps?.length ?? 0} total step(s)`"
          >
            {{ stepsModalMsg.steps?.length ?? 0 }}
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
          <StepItem v-for="step in stepsModalMsg.steps" :key="step.id" :step="step" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  Activity,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Info,
  Maximize2,
  Quote,
  Sparkles,
  X,
} from 'lucide-vue-next'
import { computed, inject, onMounted, onUnmounted, provide, ref, watch, nextTick } from 'vue'
import type { SessionAttachment, SessionMessage, SessionStep, SessionTokenKind } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { fileIconFor } from '~/utils/file-icon'
import { tokenizeMessage } from '~/utils/tokenize'
import { renderMarkdown } from '~/utils/markdown'
import { renderMermaidIn } from '~/utils/mermaid'
import { formatTime } from '~/utils/time'

const settingsStore = useSettingsStore()
const fmt = (at: string | undefined) => formatTime(at, settingsStore.defaults?.timezone)

const copiedId = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const copyMessage = async (msg: SessionMessage) => {
  try {
    await navigator.clipboard.writeText(msg.text ?? '')
    copiedId.value = msg.id
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedId.value = null
    }, 1500)
  } catch {
    // ignore — clipboard may be denied in restricted contexts
  }
}

const props = defineProps<{
  messages: SessionMessage[]
  pendingAgentIds: string[]
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const workspace = useWorkspaceStore()
const store = useSessionsStore()

const scrollRef = ref<HTMLElement | null>(null)

// Selection-driven "Quote & follow up" popup. We watch document selectionchange
// and only surface the button when the entire range sits inside a single agent
// message body (data-agent-message-id). Position is anchored to the end of the
// selection — viewport coords, since the popup is teleported to body.
const followUpController = inject(FOLLOW_UP_KEY, null)
const quotePopup = ref<{ messageId: string; text: string; top: number; left: number } | null>(null)

const closestAgentMessageId = (node: Node | null): string | null => {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null)
  while (el) {
    const id = el.dataset?.agentMessageId
    if (id) return id
    el = el.parentElement
  }
  return null
}

const onSelectionChange = () => {
  if (!followUpController) {
    quotePopup.value = null
    return
  }
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    quotePopup.value = null
    return
  }
  const range = sel.getRangeAt(0)
  const startMsg = closestAgentMessageId(range.startContainer)
  const endMsg = closestAgentMessageId(range.endContainer)
  if (!startMsg || startMsg !== endMsg) {
    quotePopup.value = null
    return
  }
  const text = sel.toString().trim()
  if (!text) {
    quotePopup.value = null
    return
  }
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return
  quotePopup.value = {
    messageId: startMsg,
    text,
    // 6px gap below the selection; clamp left into viewport.
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(window.innerWidth - 160, rect.left)),
  }
}

const addQuoteFollowUp = () => {
  const popup = quotePopup.value
  if (!popup || !followUpController) return
  followUpController.add({
    messageId: popup.messageId,
    selectedText: popup.text,
    note: '',
  })
  quotePopup.value = null
  window.getSelection()?.removeAllRanges()
}

// StepItem reads SELECT_STEP_KEY via inject; provide here so clicking a Task
// step opens the subagent drawer. Other tool kinds: no-op for now (StepItem
// already disables click when there's no detail; we just don't handle them).
const selectedStepId = ref<string | null>(null)
provide(SELECTED_STEP_ID_KEY, selectedStepId)
provide(SELECT_STEP_KEY, (step: SessionStep) => {
  if (step.kind !== 'tool' || step.tool !== 'task') return
  // Find which message owns this step. Sessions are short — linear scan is fine.
  const owner = props.messages.find((msg) => msg.steps?.some((s) => s.id === step.id))
  if (!owner) return
  const session = store.selectedSession
  if (!session) return
  selectedStepId.value = step.id
  store.openSubagentDrawer(session.id, owner.id, step.id)
})

const tokenColor = (kind: SessionTokenKind) => {
  if (kind === 'agent') return t.value.warning
  if (kind === 'skill') return t.value.accent
  if (kind === 'file') return t.value.info
  return t.value.success
}

const agentName = (id: string) => workspace.agentById(id)?.name ?? 'Agent'

const hasRunningStep = (msg: SessionMessage): boolean =>
  (msg.steps ?? []).some((s) => s.status === 'running' || s.status === undefined)

// Inline Claude-Code-style summary: "ran 9 commands · read 3 files · used 6 tools".
// Aggregates by stepFromToolUse's StepTool. Falls back to "N steps" if nothing
// matches a known bucket.
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

// Modal popup for the full step list — only one message's steps on screen at
// a time (consistent with the mode popover's "2-level" pattern).
const stepsModalMsgId = ref<string | null>(null)
const openStepsModal = (id: string) => {
  stepsModalMsgId.value = id
}
const closeStepsModal = () => {
  stepsModalMsgId.value = null
}
const stepsModalMsg = computed<SessionMessage | null>(() => {
  const id = stepsModalMsgId.value
  if (!id) return null
  return props.messages.find((m) => m.id === id) ?? null
})

const onStepsModalKey = (e: KeyboardEvent) => {
  if (!stepsModalMsgId.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeStepsModal()
  }
}

const now = ref(Date.now())
const hasStreaming = computed(() => props.messages.some((m) => m.startedAt && !m.completedAt))
let nowTimer: ReturnType<typeof setInterval> | null = null

watch(
  hasStreaming,
  (active) => {
    if (active && !nowTimer) {
      nowTimer = setInterval(() => {
        now.value = Date.now()
      }, 100)
    } else if (!active && nowTimer) {
      clearInterval(nowTimer)
      nowTimer = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})

// Global ESC closes the steps modal — captured at document level so we don't
// need the inner panel to hold focus.
onMounted(() => document.addEventListener('keydown', onStepsModalKey))
onUnmounted(() => document.removeEventListener('keydown', onStepsModalKey))

// selectionchange fires globally — we filter inside the handler to only act
// on selections rooted in an agent message body.
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange))

// Render mermaid diagrams once each assistant message stabilises (either
// historical/no startedAt, or live with completedAt set). Skipping in-flight
// placeholders avoids parsing incomplete diagram source on every chunk.
const mermaidSignature = computed(() =>
  props.messages
    .filter((m) => m.role === 'agent' && (!m.startedAt || m.completedAt !== undefined))
    .map((m) => `${m.id}:${m.text?.length ?? 0}`)
    .join('|'),
)

watch(
  mermaidSignature,
  () => {
    nextTick(() => {
      renderMermaidIn(scrollRef.value)
    })
  },
  { immediate: true },
)

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  },
)
</script>

<!-- Markdown styles (.awog-md) + .awog-copy-btn moved to assets/css/main.css so
     they apply globally — subagent drawer, permission card, etc. all need them. -->
