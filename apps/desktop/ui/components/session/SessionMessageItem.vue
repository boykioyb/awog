<template>
  <div>
    <div
      v-if="message.role === 'system'"
      class="text-center text-[1em] uppercase tracking-wider"
      :style="{ color: t.textDim }"
    >
      ── {{ message.text }} · {{ fmt(message.at) }} ──
    </div>

    <div v-else>
      <div v-if="message.role === 'user'" class="flex flex-col items-end gap-1.5">
        <div
          v-if="message.followUps?.length || bodyText"
          class="rounded-2xl px-4 py-2 text-[1em] leading-relaxed break-words"
          :style="{
            background: t.bgElevated,
            color: t.text,
            border: `1px solid ${t.border}`,
            maxWidth: '78%',
          }"
        >
          <!-- Quotes the user attached via "Quote & follow up": numbered cards,
               not the raw `> …` markdown that the model still receives in text. -->
          <SessionFollowUpQuotes
            v-if="message.followUps?.length"
            :follow-ups="message.followUps"
            :class="bodyText ? 'mb-2' : ''"
          />
          <div v-if="bodyText" class="whitespace-pre-wrap break-words">
            <template v-for="(seg, i) in tokenizeMessage(bodyText)" :key="i">
              <span
                v-if="seg.kind === 'token'"
                :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
              >
                {{ seg.text }}
              </span>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
        </div>
        <SessionMessageAttachments
          v-if="message.attachments?.length"
          :attachments="message.attachments"
          @open="(att: SessionAttachment) => emit('openAttachment', att)"
        />
        <div class="text-[1em] flex items-center gap-1.5" :style="{ color: t.textFaint }">
          <span>{{ fmt(message.at) }}</span>
          <span v-if="message.modeAtSend">· sent in {{ message.modeAtSend }} mode</span>
          <button
            type="button"
            class="awog-copy-btn"
            :style="{ color: t.textFaint }"
            title="Branch from this message"
            @click="onBranch"
          >
            <GitBranch :size="11" />
          </button>
        </div>
      </div>

      <!-- Agent reply renders as a plain document (no bubble, no ASSISTANT
           header). Identity/model/time + copy & branch actions live in the
           byline footer below the reply. -->
      <div v-if="message.role === 'agent'" class="text-[1em] leading-relaxed">
        <!-- Steps summary + collapse toggle. Sits above the body so the
             control reads before the interleaved command/text flow. -->
        <button
          v-if="message.steps?.length"
          type="button"
          class="inline-flex items-center gap-1.5 text-[12px] py-0.5 px-1.5 -ml-1.5 mb-2 rounded transition hover:bg-white/5"
          :style="{ color: t.textDim }"
          @click="expanded = !expanded"
        >
          <Info :size="11" />
          <span>{{ stepsSummary(message.steps) }}</span>
          <Activity
            v-if="hasRunningStep"
            :size="10"
            class="animate-pulse"
            :style="{ color: t.accent }"
          />
          <ChevronDown
            :size="10"
            :style="{
              transform: expanded ? 'none' : 'rotate(-90deg)',
              transition: 'transform 0.15s',
            }"
          />
        </button>

        <!-- Body. With steps expanded we interleave reply-text segments and
             step clusters in chronological order (each step carries the text
             offset where its tool fired). Collapsed → plain reply text only.
             No steps → plain reply text. -->
        <template v-if="message.steps?.length && expanded">
          <template v-for="(block, bi) in timelineBlocks" :key="bi">
            <MarkdownStreamBody
              v-if="block.type === 'text'"
              :text="block.text"
              :streaming="isStreaming && bi === lastTextBlockIndex"
              class="awog-md text-[1em]"
              :class="bi > 0 ? 'mt-2' : ''"
              :style="{ color: t.text, '--awog-accent': t.accent }"
              :data-agent-message-id="message.id"
            />
            <!-- Inline step cluster. Replaces the previous single steps box so
                 the subagent drawer (slides in from the right) stays visible and
                 commands line up with the text they ran between. -->
            <div
              v-else
              class="mt-2 rounded-md px-3 py-2 space-y-1 text-[12px]"
              :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
            >
              <StepItem v-for="s in block.steps" :key="s.id" :step="s" />
            </div>
          </template>
        </template>

        <MarkdownStreamBody
          v-else-if="message.text"
          :text="message.text"
          :streaming="isStreaming"
          class="awog-md text-[1em]"
          :style="{ color: t.text, '--awog-accent': t.accent }"
          :data-agent-message-id="message.id"
        />

        <SessionInlinePermission
          v-if="store.pendingPermission?.messageId === message.id"
          :message-id="message.id"
          class="mt-2"
        />

        <div v-if="message.artifacts?.length" class="mt-2 space-y-1.5">
          <div
            v-for="art in message.artifacts"
            :key="art.name"
            class="rounded"
            :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
          >
            <div
              class="px-2.5 py-1.5 flex items-center gap-1.5 text-[1em]"
              :style="{ borderBottom: art.preview ? `1px solid ${t.border}` : 'none' }"
            >
              <FileText :size="11" :style="{ color: t.textDim }" />
              <span class="font-mono" :style="{ color: t.text }">{{ art.name }}</span>
            </div>
            <pre
              v-if="art.preview"
              class="text-[1em] px-2.5 py-2 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap"
              :style="{ color: t.textMuted, maxHeight: '160px' }"
              >{{ art.preview }}</pre
            >
          </div>
        </div>

        <!-- Byline footer: copy + branch actions, timestamp, and run stats —
             reads after the reply (replaces the removed ASSISTANT header).
             While streaming it shows a live ticker instead of the actions. -->
        <div class="mt-2 flex items-center gap-2 text-[12px]" :style="{ color: t.textFaint }">
          <template v-if="message.startedAt && !message.completedAt">
            <Activity :size="11" class="animate-pulse" />
            <span>Streaming… {{ formatElapsed(now - message.startedAt) }}</span>
          </template>
          <template v-else>
            <button
              v-if="message.text"
              type="button"
              class="awog-copy-btn"
              :style="{ color: copied ? t.success : t.textFaint }"
              :title="copied ? 'Copied' : 'Copy message'"
              @click="copyMessage"
            >
              <Check v-if="copied" :size="12" />
              <Copy v-else :size="12" />
            </button>
            <button
              type="button"
              class="awog-copy-btn"
              :style="{ color: t.textFaint }"
              title="Branch from this message"
              @click="onBranch"
            >
              <GitBranch :size="12" />
            </button>
            <span v-if="message.at" class="ml-0.5">{{ fmt(message.at) }}</span>
            <span v-if="message.startedAt && message.completedAt">
              · {{ formatElapsed(message.completedAt - message.startedAt) }}
            </span>
            <span v-if="message.usage">· {{ message.usage.outputTokens }} tok</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Activity, Check, ChevronDown, Copy, FileText, GitBranch, Info } from 'lucide-vue-next'
import type { SessionAttachment, SessionMessage, SessionStep, SessionTokenKind } from '~/types'
import { tokenizeMessage } from '~/utils/tokenize'
import { stripFollowUpSection } from '~/utils/follow-up'
import { formatTime } from '~/utils/time'

const props = defineProps<{
  message: SessionMessage
  now: number
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const settingsStore = useSettingsStore()
const store = useSessionsStore()

const fmt = (at: string | undefined) => formatTime(at, settingsStore.defaults?.timezone)

// The user's own free-text, with any serialized follow-up quote section peeled
// off (those render as cards above). No follow-ups → the message text verbatim.
const bodyText = computed(() =>
  props.message.followUps?.length
    ? stripFollowUpSection(props.message.text, props.message.followUps)
    : props.message.text,
)

const tokenColor = (kind: SessionTokenKind) => {
  if (kind === 'agent') return t.value.warning
  if (kind === 'skill') return t.value.accent
  if (kind === 'file') return t.value.info
  return t.value.success
}

// Inline collapsible step list — local state so multiple bubbles can stay
// collapsed/expanded independently. Default state is EXPANDED: when a message
// arrives with steps the user should see them immediately (live progress +
// retrospective audit).
const expanded = ref(true)

const hasRunningStep = computed((): boolean =>
  (props.message.steps ?? []).some(
    (s: SessionStep) => s.status === 'running' || s.status === undefined,
  ),
)

const isStreaming = computed(() => !!(props.message.startedAt && !props.message.completedAt))

type TimelineBlock = { type: 'text'; text: string } | { type: 'steps'; steps: SessionStep[] }

// Reply turns mix narration text with tool calls. Each top-level step carries
// the text offset where its tool fired (stamped by the sessions store), so we
// rebuild the chronological order here: split the reply text at those offsets
// and coalesce runs of consecutive steps into one cluster. Whitespace-only
// gaps are dropped (the cluster/text margins handle spacing).
const timelineBlocks = computed<TimelineBlock[]>(() => {
  const text = props.message.text ?? ''
  const steps = props.message.steps ?? []
  if (!steps.length) return text ? [{ type: 'text', text }] : []
  const len = text.length
  const ordered = steps
    .map((s, i) => ({ s, i, off: Math.min(Math.max(s.textOffset ?? len, 0), len) }))
    .sort((a, b) => a.off - b.off || a.i - b.i)
  const blocks: TimelineBlock[] = []
  let cursor = 0
  const pushStep = (step: SessionStep) => {
    const last = blocks[blocks.length - 1]
    if (last && last.type === 'steps') last.steps.push(step)
    else blocks.push({ type: 'steps', steps: [step] })
  }
  ordered.forEach(({ s, off }) => {
    if (off > cursor) {
      const seg = text.slice(cursor, off)
      if (seg.trim()) blocks.push({ type: 'text', text: seg })
      cursor = off
    }
    pushStep(s)
  })
  if (cursor < len) {
    const seg = text.slice(cursor)
    if (seg.trim()) blocks.push({ type: 'text', text: seg })
  }
  return blocks
})

// Only the trailing text segment is still being typed — flag it so
// MarkdownStreamBody throttles just that one and renders the rest immediately.
const lastTextBlockIndex = computed(() => {
  const blocks = timelineBlocks.value
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.type === 'text') return i
  }
  return -1
})

// Claude-Code-style summary for the collapse toggle label:
// "ran 9 commands · read 3 files · used 6 tools". Aggregates steps by tool.
const stepsSummary = (steps: SessionStep[]): string => {
  let cmds = 0
  let reads = 0
  let writes = 0
  let searches = 0
  let subagents = 0
  let others = 0
  steps.forEach((s: SessionStep) => {
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

// Fork the conversation from this message into a new session and switch to it.
// The original session is left untouched.
const onBranch = () => {
  store.branchFromMessage(props.message.id)
}

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// Local copy state per item — independent so concurrent copies don't clobber.
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const copyMessage = async () => {
  try {
    await navigator.clipboard.writeText(props.message.text ?? '')
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // ignore — clipboard may be denied in restricted contexts
  }
}

// `now` flows in from the parent (single setInterval for all streaming
// messages) — template reads it via props.now expression.
const now = computed(() => props.now)
</script>
