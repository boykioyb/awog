<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
    <SessionMessageItem
      v-for="msg in messages"
      :key="msg.id"
      :message="msg"
      :now="now"
      @open-attachment="(att: SessionAttachment) => emit('openAttachment', att)"
    />

    <div
      v-for="agentId in pendingAgentIds"
      :key="`pending-${agentId}`"
      class="flex gap-1.5 items-center"
    >
      <Activity :size="11" class="animate-pulse" :style="{ color: t.textDim }" />
      <span class="text-[1em]" :style="{ color: t.textDim }">
        {{ agentName(agentId) }} đang phản hồi...
      </span>
    </div>
  </div>

  <Teleport to="body">
    <button
      v-if="quotePopup"
      type="button"
      class="fixed z-50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[1em] shadow-lg transition"
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
</template>

<script setup lang="ts">
import { Activity, Quote } from 'lucide-vue-next'
import type { SessionAttachment, SessionMessage, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { renderMermaidIn } from '~/utils/mermaid'

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
  const owner = props.messages.find((msg: SessionMessage) =>
    msg.steps?.some((s: SessionStep) => s.id === step.id),
  )
  if (!owner) return
  const session = store.selectedSession
  if (!session) return
  selectedStepId.value = step.id
  store.openSubagentDrawer(session.id, owner.id, step.id)
})

const agentName = (id: string) => workspace.agentById(id)?.name ?? 'Agent'

// Single ticker shared across all streaming messages — children read `now`
// via prop so we don't create one interval per bubble.
const now = ref(Date.now())
const hasStreaming = computed(() =>
  props.messages.some((m: SessionMessage) => m.startedAt && !m.completedAt),
)
let nowTimer: ReturnType<typeof setInterval> | null = null

watch(
  hasStreaming,
  (active: boolean) => {
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

// selectionchange fires globally — we filter inside the handler to only act
// on selections rooted in an agent message body.
onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange))

// Render mermaid diagrams once each assistant message stabilises (either
// historical/no startedAt, or live with completedAt set). Skipping in-flight
// placeholders avoids parsing incomplete diagram source on every chunk.
const mermaidSignature = computed(() =>
  props.messages
    .filter(
      (m: SessionMessage) => m.role === 'agent' && (!m.startedAt || m.completedAt !== undefined),
    )
    .map((m: SessionMessage) => `${m.id}:${m.text?.length ?? 0}`)
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
