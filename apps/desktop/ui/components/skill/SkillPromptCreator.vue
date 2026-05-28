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
        <div class="text-[12px] font-medium" :style="{ color: t.text }">New skill</div>
        <span class="text-[10px]" :style="{ color: t.textDim }">
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

      <div ref="logRef" class="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[280px]">
        <div
          v-if="messages.length === 0 && !streamingText"
          class="text-[12px] py-4"
          :style="{ color: t.textDim }"
        >
          Describe the skill you want — for example
          <span :style="{ color: t.text }">"Review PRs against our TypeScript style guide"</span>
          or
          <span :style="{ color: t.text }">"Plan a sprint from a Linear epic"</span>
          . The LLM will pick a slug + location and write the SKILL.md folder.
        </div>

        <div v-for="(msg, i) in messages" :key="i" class="space-y-1">
          <div
            v-if="msg.role === 'user'"
            class="rounded-xl px-3 py-2 text-[12px] leading-relaxed ml-auto whitespace-pre-wrap"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
              maxWidth: '85%',
              width: 'fit-content',
            }"
          >
            {{ msg.text }}
          </div>
          <div v-else class="space-y-1.5">
            <!-- eslint-disable vue/no-v-html — renderMarkdown (marked html:false) escape HTML thô -->
            <div
              v-if="msg.text"
              class="awog-md text-[12px]"
              :style="{ color: t.text, '--awog-accent': t.accent }"
              v-html="renderMarkdown(msg.text)"
            />
            <!-- eslint-enable vue/no-v-html -->
            <div v-if="msg.steps?.length" class="space-y-0.5 pl-2">
              <div
                v-for="step in msg.steps"
                :key="step.id"
                class="text-[10px] inline-flex items-center gap-1.5"
                :style="{ color: t.textDim }"
              >
                <component
                  :is="
                    step.status === 'error' ? AlertCircle : step.status === 'done' ? Check : Loader2
                  "
                  :size="10"
                  :class="
                    step.status === 'running' || step.status === undefined ? 'animate-spin' : ''
                  "
                  :style="{
                    color:
                      step.status === 'error'
                        ? t.danger
                        : step.status === 'done'
                          ? t.success
                          : t.textDim,
                  }"
                />
                <span class="font-mono">{{ step.label }}</span>
                <span v-if="step.target" class="font-mono truncate" :style="{ color: t.textFaint }">
                  · {{ step.target }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="streamingText || streamingSteps.length > 0" class="space-y-1.5">
          <!-- eslint-disable vue/no-v-html — renderMarkdown (marked html:false) escape HTML thô -->
          <div
            v-if="streamingText"
            class="awog-md text-[12px]"
            :style="{ color: t.text, '--awog-accent': t.accent }"
            v-html="renderMarkdown(streamingText)"
          />
          <!-- eslint-enable vue/no-v-html -->
          <div v-if="streamingSteps.length > 0" class="space-y-0.5 pl-2">
            <div
              v-for="step in streamingSteps"
              :key="step.id"
              class="text-[10px] inline-flex items-center gap-1.5"
              :style="{ color: t.textDim }"
            >
              <component
                :is="
                  step.status === 'error' ? AlertCircle : step.status === 'done' ? Check : Loader2
                "
                :size="10"
                :class="
                  step.status === 'running' || step.status === undefined ? 'animate-spin' : ''
                "
                :style="{
                  color:
                    step.status === 'error'
                      ? t.danger
                      : step.status === 'done'
                        ? t.success
                        : t.textDim,
                }"
              />
              <span class="font-mono">{{ step.label }}</span>
              <span v-if="step.target" class="font-mono truncate" :style="{ color: t.textFaint }">
                · {{ step.target }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="error" class="text-[11px]" :style="{ color: t.danger }">{{ error }}</div>
      </div>

      <div class="px-4 pb-4">
        <div
          class="rounded-2xl p-3 flex flex-col gap-2.5"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <textarea
            v-model="promptText"
            :rows="2"
            :disabled="isStreaming"
            :placeholder="
              messages.length === 0
                ? 'Describe what this skill should do…'
                : 'Iterate further (or close when happy)…'
            "
            class="w-full bg-transparent text-[12px] leading-relaxed resize-none focus:outline-none"
            :style="{ color: t.text }"
            @keydown.enter.exact.prevent="onSend"
          />
          <div class="flex items-center justify-between">
            <div class="text-[10px]" :style="{ color: t.textFaint }">
              <template v-if="messages.length === 0">
                Enter to send · Shift+Enter for newline
              </template>
              <template v-else>{{ messages.length }} turn(s) · close to refresh skills</template>
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
import { AlertCircle, ArrowUp, Check, Loader2, Sparkles, X } from 'lucide-vue-next'
import type { SessionStep } from '~/types'
import { renderMarkdown } from '~/utils/markdown'

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

const messages = ref<ChatMsg[]>([])
const promptText = ref('')
const streamingText = ref('')
const streamingSteps = ref<SessionStep[]>([])
const error = ref<string | null>(null)
const isStreaming = ref(false)
const currentMessageId = ref<string | null>(null)

const logRef = ref<HTMLElement | null>(null)

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
  nextTick(() => {
    const el = logRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

const onClose = () => {
  emit('close')
}

const onBackdropClick = () => {
  if (isStreaming.value) return // don't drop in-flight requests
  onClose()
}

const upsertStreamingStep = (step: SessionStep) => {
  const idx = streamingSteps.value.findIndex((s) => s.id === step.id)
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
      ? 'Sidecar offline — chat unavailable. Run the Tauri app.'
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
  const history = messages.value.slice(0, -1).map((m) => ({ role: m.role, text: m.text }))

  try {
    await sidecar.request('skills.author', {
      messageId,
      history,
      userText: text,
      accountId: account.id,
      projectIds: ws.projects.map((p) => p.id),
    })
    // Finalise: move the streaming buffer into a permanent agent message.
    messages.value = [
      ...messages.value,
      { role: 'agent', text: streamingText.value, steps: [...streamingSteps.value] },
    ]
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
