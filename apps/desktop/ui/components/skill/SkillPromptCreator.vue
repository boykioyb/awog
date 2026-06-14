<template>
  <div class="fixed inset-0 z-50" @click="onBackdropClick">
    <div
      class="absolute rounded-2xl overflow-hidden flex flex-col"
      :style="{
        top: `${cardPos.top}px`,
        left: `${cardPos.left}px`,
        width: `${cardPos.width}px`,
        maxHeight: `${cardPos.maxHeight}px`,
        background: t.bgPanel,
        border: `1px solid ${t.border}`,
        boxShadow: `0 24px 60px ${t.shadow}`,
      }"
      @click.stop
    >
      <div
        class="px-4 py-2.5 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <Sparkles :size="13" :style="{ color: t.accent }" />
        <div class="text-[1em] font-medium" :style="{ color: t.text }">New skill</div>
        <span class="text-[1em]" :style="{ color: t.textDim }">
          · LLM will create SKILL.md on disk
        </span>
        <span class="flex-1" />
        <button
          class="p-1 rounded transition"
          :style="{ color: t.textDim }"
          title="Close"
          @click="onClose"
        >
          <X :size="13" />
        </button>
      </div>

      <AgentChatLog
        ref="logRef"
        :messages="messages"
        :streaming-text="streamingText"
        :streaming-steps="streamingSteps"
        :error="error"
      >
        <template #empty>
          <div class="text-[1em] py-4" :style="{ color: t.textDim }">
            Describe the skill you want — for example
            <span :style="{ color: t.text }">"Review PRs against our TypeScript style guide"</span>
            or
            <span :style="{ color: t.text }">"Plan a sprint from a Linear epic"</span>
            . The LLM will pick a slug + location and write the SKILL.md folder.
          </div>
        </template>
      </AgentChatLog>

      <div class="px-4 pb-4">
        <div
          class="rounded-2xl p-3 flex flex-col gap-2.5"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <CreatorScopePicker v-model="scope" :projects="projects" />
          <textarea
            v-model="promptText"
            :rows="2"
            :disabled="isStreaming"
            :placeholder="
              messages.length === 0
                ? 'Describe what this skill should do…'
                : 'Iterate further (or close when happy)…'
            "
            class="w-full bg-transparent text-[1em] leading-relaxed resize-none focus:outline-none"
            :style="{ color: t.text }"
            @keydown.enter.exact.prevent="onSend"
          />
          <div class="flex items-center justify-between">
            <div class="text-[1em]" :style="{ color: t.textFaint }">
              <template v-if="messages.length === 0">
                Enter to send · Shift+Enter for newline
              </template>
              <template v-else>{{ messages.length }} turn(s) · skills auto-refresh</template>
            </div>
            <button
              class="w-7 h-7 rounded-full inline-flex items-center justify-center transition"
              :disabled="!canSend"
              :style="{
                background: canSend ? t.accent : t.bgPanel,
                color: canSend ? t.accentText : t.textFaint,
              }"
              :title="isStreaming ? 'Generating…' : 'Send'"
              @click="onSend"
            >
              <Loader2 v-if="isStreaming" :size="14" class="animate-spin" />
              <ArrowUp v-else :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowUp, Loader2, Sparkles, X } from 'lucide-vue-next'
import type { SessionStep } from '~/types'

interface ChatMsg {
  role: 'user' | 'agent'
  text: string
  steps?: SessionStep[]
}

interface AuthorChunkPayload {
  messageId: string
  delta: string
}

interface AuthorStepPayload {
  messageId: string
  step: SessionStep
}

interface AuthorDonePayload {
  messageId: string
  text: string
}

interface SidecarEvent {
  type: string
  payload: unknown
}

const props = defineProps<{
  anchor?: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  // Closing the modal — the parent should refresh the skill list because the
  // LLM may have written a new SKILL.md to disk during the conversation.
  close: []
}>()

const { t } = useTheme()
const sidecar = useSidecar()
const settings = useSettingsStore()
const ws = useWorkspaceStore()

// "Save to" scope: 'global' (→ ~/.awog/skills) or a projectId
// (→ {project}/.awog/skills). The sidecar resolves it to the write dir + cwd.
const scope = ref('global')
const projects = computed(() => ws.projects.map((p) => ({ id: p.id, name: p.name })))

const messages = ref<ChatMsg[]>([])
const promptText = ref('')
const streamingText = ref('')
const streamingSteps = ref<SessionStep[]>([])
const error = ref<string | null>(null)
const isStreaming = ref(false)
const currentMessageId = ref<string | null>(null)

const logRef = ref<{ scrollToBottom: () => void } | null>(null)

const canSend = computed(() => !isStreaming.value && promptText.value.trim().length > 0)

const MAX_CARD_WIDTH = 520
const VIEWPORT_MARGIN = 12
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : MAX_CARD_WIDTH)
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 600)

const onResize = () => {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

const cardPos = computed(() => {
  const width = Math.min(MAX_CARD_WIDTH, viewportWidth.value - VIEWPORT_MARGIN * 2)
  const maxHeight = Math.min(640, viewportHeight.value - VIEWPORT_MARGIN * 2)
  if (!props.anchor) {
    return {
      top: Math.max(VIEWPORT_MARGIN, (viewportHeight.value - maxHeight) / 3),
      left: Math.max(VIEWPORT_MARGIN, (viewportWidth.value - width) / 2),
      width,
      maxHeight,
    }
  }
  const maxLeft = viewportWidth.value - width - VIEWPORT_MARGIN
  return {
    top: props.anchor.top,
    left: Math.min(Math.max(VIEWPORT_MARGIN, props.anchor.left), maxLeft),
    width,
    maxHeight,
  }
})

const scrollToBottom = () => {
  logRef.value?.scrollToBottom()
}

const onClose = () => {
  emit('close')
}

const onBackdropClick = () => {
  if (isStreaming.value) return // don't drop in-flight requests
  onClose()
}

const upsertStreamingStep = (step: SessionStep) => {
  const idx = streamingSteps.value.findIndex((s: SessionStep) => s.id === step.id)
  if (idx >= 0) {
    streamingSteps.value = [
      ...streamingSteps.value.slice(0, idx),
      { ...streamingSteps.value[idx], ...step },
      ...streamingSteps.value.slice(idx + 1),
    ]
  } else {
    streamingSteps.value = [...streamingSteps.value, step]
  }
}

const handleEvent = (evt: SidecarEvent) => {
  if (!currentMessageId.value) return
  if (evt.type === 'skills.author.chunk') {
    const p = evt.payload as AuthorChunkPayload
    if (p.messageId !== currentMessageId.value) return
    streamingText.value += p.delta
    scrollToBottom()
  } else if (evt.type === 'skills.author.step') {
    const p = evt.payload as AuthorStepPayload
    if (p.messageId !== currentMessageId.value) return
    upsertStreamingStep(p.step)
    scrollToBottom()
  } else if (evt.type === 'skills.author.done') {
    const p = evt.payload as AuthorDonePayload
    if (p.messageId !== currentMessageId.value) return
    // Server-authoritative text overrides accumulated stream (handles SDKs that
    // skip partial deltas for short messages).
    if (p.text) streamingText.value = p.text
  }
}

let unsubscribe: (() => void) | null = null

onMounted(async () => {
  window.addEventListener('resize', onResize)
  if (sidecar.available) {
    try {
      unsubscribe = await sidecar.onEvent(handleEvent)
    } catch {
      // event channel unavailable — chat will fall back to RPC-only result.
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (unsubscribe) unsubscribe()
})

const onSend = async () => {
  const text = promptText.value.trim()
  if (!text || isStreaming.value) return

  const account = settings.activeAccount('anthropic')
  if (!sidecar.available || !account) {
    error.value = !sidecar.available
      ? 'Sidecar offline — chat unavailable. Run the desktop app.'
      : 'No active Anthropic account. Connect one in Settings.'
    return
  }

  error.value = null
  promptText.value = ''
  // Push user turn into the visible log immediately so the user sees what they
  // sent even before any chunks come back.
  messages.value = [...messages.value, { role: 'user', text }]
  streamingText.value = ''
  streamingSteps.value = []
  isStreaming.value = true

  const messageId = `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  currentMessageId.value = messageId

  // History sent to the model is everything EXCEPT the message we just pushed —
  // userText is the new turn.
  const history = messages.value.slice(0, -1).map((m: ChatMsg) => ({ role: m.role, text: m.text }))

  try {
    await sidecar.request('skills.author', {
      messageId,
      history,
      userText: text,
      accountId: account.id,
      scope: scope.value,
    })
    // Finalise: move the streaming buffer into a permanent agent message.
    messages.value = [
      ...messages.value,
      { role: 'agent', text: streamingText.value, steps: [...streamingSteps.value] },
    ]
    // Every turn may have written a new SKILL.md — refresh now so the parent
    // skill list reflects it immediately, without waiting for modal close.
    ws.hydrateSkillsFromSidecar().catch(() => {
      // hydrate logs its own warning
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isStreaming.value = false
    currentMessageId.value = null
    streamingText.value = ''
    streamingSteps.value = []
    scrollToBottom()
  }
}
</script>
