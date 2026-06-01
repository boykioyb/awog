<template>
  <div
    ref="scrollRef"
    class="flex-1 overflow-y-auto px-4 md:px-6 py-4"
    :class="isEmpty ? 'flex flex-col items-center justify-center' : 'space-y-3'"
    @click="onMermaidZoomClick"
  >
    <div
      v-if="isEmpty"
      class="flex flex-col items-center gap-5 max-w-md text-center select-none px-6"
    >
      <div
        class="ws-empty-orb flex items-center justify-center rounded-2xl"
        :style="{
          width: '72px',
          height: '72px',
          background: t.bgSubtle,
          border: `1px solid ${t.border}`,
          color: t.accent,
        }"
      >
        <MessagesSquare :size="30" :stroke-width="1.5" />
      </div>
      <div class="space-y-1.5">
        <p class="text-[1em] font-semibold" :style="{ color: t.text }">
          {{ tr('session.empty.title') }}
        </p>
        <p class="text-[1em] leading-relaxed" :style="{ color: t.textDim }">
          {{ tr('session.empty.subtitle') }}
        </p>
      </div>
      <div class="flex flex-wrap gap-2 justify-center">
        <span
          v-for="hint in hints"
          :key="hint.token"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[1em]"
          :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
        >
          <component :is="hint.icon" :size="12" :style="{ color: t.accent }" />
          <span class="font-mono">{{ hint.token }}</span>
        </span>
      </div>
    </div>

    <template v-else>
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
    </template>
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
      @click="openFollowUpDraft"
    >
      <Quote :size="11" :style="{ color: t.accent }" />
      Quote &amp; follow up
    </button>
  </Teleport>

  <SessionFollowUpNoteModal
    v-if="followUpDraft"
    :selected-text="followUpDraft.text"
    :top="followUpDraft.top"
    :left="followUpDraft.left"
    @save="saveFollowUp"
    @cancel="followUpDraft = null"
  />

  <MermaidZoomModal
    v-if="mermaidZoomSource"
    :source="mermaidZoomSource"
    @close="mermaidZoomSource = null"
  />
</template>

<script setup lang="ts">
import { Activity, AtSign, Bot, MessagesSquare, Quote, Slash } from 'lucide-vue-next'
import type { SessionAttachment, SessionMessage, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { decodeMermaidSource, renderMermaidIn } from '~/utils/mermaid'

const props = defineProps<{
  messages: SessionMessage[]
  pendingAgentIds: string[]
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

// Empty state: no messages and nothing streaming yet.
const isEmpty = computed(() => props.messages.length === 0 && props.pendingAgentIds.length === 0)

const hints = [
  { token: '@file', icon: AtSign },
  { token: '$agent', icon: Bot },
  { token: '/command', icon: Slash },
]
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

// Clicking "Quote & follow up" opens a note modal anchored to the selection
// (position captured now, since the modal's textarea steals focus and clears
// the live selection). The follow-up is added only on Save — so the composer
// chip arrives already annotated instead of empty.
const followUpDraft = ref<{ messageId: string; text: string; top: number; left: number } | null>(
  null,
)

const openFollowUpDraft = () => {
  const popup = quotePopup.value
  if (!popup || !followUpController) return
  followUpDraft.value = {
    messageId: popup.messageId,
    text: popup.text,
    // Clamp so the ~220px-tall card stays on screen even near the bottom edge.
    top: Math.min(popup.top, window.innerHeight - 240),
    left: Math.max(8, Math.min(window.innerWidth - 348, popup.left)),
  }
  quotePopup.value = null
  window.getSelection()?.removeAllRanges()
}

const saveFollowUp = (note: string) => {
  const draft = followUpDraft.value
  if (!draft || !followUpController) {
    followUpDraft.value = null
    return
  }
  followUpController.add({ messageId: draft.messageId, selectedText: draft.text, note })
  followUpDraft.value = null
}

// StepItem reads SELECT_STEP_KEY via inject. We shadow the provide here so Task
// steps open the subagent drawer; every other step delegates to SessionChat's
// step-detail drawer (captured before we re-provide). Without the delegation,
// clicking a read/edit/run step would do nothing.
const parentSelectStep = inject(SELECT_STEP_KEY, null)
const selectedStepId = ref<string | null>(null)
provide(SELECTED_STEP_ID_KEY, selectedStepId)
provide(SELECT_STEP_KEY, (step: SessionStep) => {
  if (step.kind === 'tool' && step.tool === 'task') {
    // Find which message owns this step. Sessions are short — linear scan is fine.
    const owner = props.messages.find((msg: SessionMessage) =>
      msg.steps?.some((s: SessionStep) => s.id === step.id),
    )
    if (!owner) return
    const session = store.selectedSession
    if (!session) return
    selectedStepId.value = step.id
    store.openSubagentDrawer(session.id, owner.id, step.id)
    return
  }
  // read / edit / run / search / … → open the floating step-detail drawer.
  selectedStepId.value = step.id
  parentSelectStep?.(step)
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
      renderMermaidIn(scrollRef.value, { zoomLabel: tr('session.mermaid.zoom') })
    })
  },
  { immediate: true },
)

// Full-screen diagram viewer. Mermaid blocks are rendered into v-html'd markup
// (no Vue listeners), so we delegate the zoom-button click here and recover the
// diagram source from the block's data-source attribute.
const mermaidZoomSource = ref<string | null>(null)
const onMermaidZoomClick = (ev: MouseEvent) => {
  const target = ev.target as HTMLElement | null
  const trigger = target?.closest('.awog-mermaid-zoom')
  if (!trigger) return
  const block = trigger.closest<HTMLElement>('.awog-mermaid')
  const encoded = block?.dataset.source
  if (!encoded) return
  try {
    mermaidZoomSource.value = decodeMermaidSource(encoded)
  } catch {
    // Malformed source — ignore the click rather than open an empty modal.
  }
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  },
)
</script>

<style scoped>
/* Gentle float + breathing glow on the empty-state orb. */
.ws-empty-orb {
  animation: ws-empty-float 4s ease-in-out infinite;
}
@keyframes ws-empty-float {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.85;
  }
  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ws-empty-orb {
    animation: none;
  }
}
</style>

<!-- Markdown styles (.awog-md) + .awog-copy-btn moved to assets/css/main.css so
     they apply globally — subagent drawer, permission card, etc. all need them. -->
