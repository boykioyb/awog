<template>
  <div :data-message-id="message.id">
    <div
      v-if="message.role === 'system'"
      class="text-center text-[1em] uppercase tracking-wider"
      :style="{ color: t.textDim }"
    >
      ── {{ message.text }} · {{ fmt(message.at) }} ──
    </div>

    <div v-else>
      <div v-if="message.role === 'user'" class="flex flex-col items-end gap-1.5 w-full">
        <!-- Inline edit mode: swap the bubble for a composer-style textarea that
             re-sends the turn (truncating everything after this message). -->
        <div v-if="editing" class="w-full max-w-[78%] flex flex-col gap-1.5">
          <textarea
            ref="editRef"
            v-model="editDraft"
            class="w-full rounded-2xl px-4 py-2 text-[1em] leading-relaxed resize-y min-h-[3rem] outline-none"
            :style="{ background: t.bgElevated, color: t.text, border: `1px solid ${t.accent}` }"
            :placeholder="tr('session.msg.edit_placeholder')"
            @keydown.escape="cancelEdit"
            @keydown.meta.enter.prevent="saveEdit"
            @keydown.ctrl.enter.prevent="saveEdit"
          />
          <div class="flex items-center justify-end gap-2">
            <AppButton variant="ghost" size="sm" @click="cancelEdit">
              {{ tr('session.msg.edit_cancel') }}
            </AppButton>
            <AppButton size="sm" @click="saveEdit">
              {{ tr('session.msg.edit_save') }}
            </AppButton>
          </div>
        </div>

        <template v-else>
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
            <div v-if="bodyText" class="break-words">
              <!-- Slash command: compact `/prs …` chip by default; the full
                   expanded template (what the model received) toggles open. -->
              <button
                v-if="message.commandInvocation"
                type="button"
                class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[1em] font-mono transition"
                :style="{
                  background: t.bgSubtle,
                  color: t.accent,
                  border: `1px solid ${t.border}`,
                }"
                :title="
                  commandExpanded
                    ? tr('session.msg.command_collapse')
                    : tr('session.msg.command_expand')
                "
                @click="commandExpanded = !commandExpanded"
              >
                <Slash :size="12" />
                <span>{{ message.commandInvocation }}</span>
                <ChevronDown
                  :size="12"
                  :style="{
                    transform: commandExpanded ? 'none' : 'rotate(-90deg)',
                    transition: 'transform 0.15s',
                  }"
                />
              </button>
              <div
                v-if="!message.commandInvocation || commandExpanded"
                class="whitespace-pre-wrap break-words"
                :class="message.commandInvocation ? 'mt-1.5' : ''"
                :style="message.commandInvocation ? { color: t.textDim } : undefined"
              >
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
          </div>
          <SessionMessageAttachments
            v-if="message.attachments?.length"
            :attachments="message.attachments"
            @open="(att: SessionAttachment) => emit('openAttachment', att)"
          />
          <div class="text-[1em] flex items-center gap-1.5" :style="{ color: t.textFaint }">
            <span>{{ fmt(message.at) }}</span>
            <span v-if="message.modeAtSend">· sent in {{ message.modeAtSend }} mode</span>
            <AppButton
              v-if="!sessionStreaming"
              variant="ghost"
              size="xs"
              :title="tr('session.msg.edit')"
              @click="startEdit"
            >
              <Pencil :size="11" />
            </AppButton>
            <AppButton
              variant="ghost"
              size="xs"
              :title="tr('session.msg.branch')"
              @click="onBranch"
            >
              <GitBranch :size="11" />
            </AppButton>
          </div>
        </template>
      </div>

      <!-- Agent reply: body wrapped in a bubble card (white bgElevated over the
           gray canvas) so the assistant turn reads as a raised document, mirroring
           the user bubble. Identity/model/time + copy & branch actions live in the
           byline footer BELOW the bubble (outside it). -->
      <div v-if="message.role === 'agent'" class="text-[1em] leading-relaxed">
        <div
          :class="showBubble ? 'rounded-2xl px-4 py-3' : ''"
          :style="
            showBubble ? { background: t.bubbleBg, border: `1px solid ${t.border}` } : undefined
          "
        >
          <!-- TodoWrite checklists are NOT rendered inline per-message. They surface
             once in the session-level SessionTodoPanel (docked above the composer),
             which tracks the latest TodoWrite across turns so it stays visible and
             keeps updating across cancel/resume. -->

          <!-- Body. Reply text, AskUserQuestion cards, and step clusters interleave
             in chronological order. Question cards always render at their position
             (a pending question stays visible — the turn is blocked). Each step
             cluster renders its own inline collapse toggle at its position
             (SessionStepCluster), so consecutive reason→act runs fold/unfold
             independently rather than via one shared switch. -->
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
            <SessionQuestionCard
              v-else-if="block.type === 'question'"
              :step="block.step"
              class="mt-2"
            />
            <!-- Mid-turn steer: a user-note injected into the running response.
                 Always visible (it's the user's words) at the point it landed. -->
            <div
              v-else-if="block.type === 'steer'"
              class="mt-2 flex items-start gap-1.5 rounded px-2 py-1 text-[1em]"
              :style="{
                background: `${t.accent}14`,
                color: t.text,
                border: `1px solid ${t.accent}40`,
              }"
            >
              <CornerDownRight
                :size="12"
                class="flex-shrink-0"
                :style="{ color: t.accent, marginTop: '2px' }"
              />
              <span class="flex-1 min-w-0">
                <span class="text-[12px] font-medium" :style="{ color: t.accent }">
                  {{ tr('session.steer.label') }}
                </span>
                <span class="block whitespace-pre-wrap" :style="{ color: t.textDim }">
                  {{ block.step.steerText }}
                </span>
              </span>
            </div>
            <!-- Inline step cluster (Claude-Code style): its own collapse toggle
               + summary, rendered at this run's position. Each instance keeps
               independent expand state. -->
            <SessionStepCluster v-else :steps="block.steps" />
          </template>

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
        </div>
        <!-- Turn failed (provider `error` stop or a thrown runtime/network error):
             a prominent alert with the full cause + a retry button, OUTSIDE the
             bubble so it reads even when nothing streamed. -->
        <SessionErrorNotice
          v-if="message.error"
          :message-id="message.id"
          :message="message.error.message"
          :disabled="sessionStreaming"
          class="mt-2"
        />
        <!-- Byline footer: copy + branch actions, timestamp, and run stats —
             reads after the reply, OUTSIDE the bubble (mirrors the user bubble).
             While streaming it shows a live ticker instead of the actions. -->
        <div class="mt-2 flex items-center gap-2 text-[12px]" :style="{ color: t.textFaint }">
          <template v-if="message.startedAt && !message.completedAt">
            <!-- Parked on human input (a question or permission prompt): show a
                 static "waiting" state, NOT the ticking elapsed timer. -->
            <template v-if="awaitingInput">
              <Clock :size="11" />
              <span>{{ awaitingLabel }}</span>
            </template>
            <template v-else>
              <Activity :size="11" class="animate-pulse" />
              <span>Streaming… {{ formatElapsed(workingElapsed(now)) }}</span>
            </template>
          </template>
          <!-- Rewind confirm bar: replaces the action row until the user
               confirms or cancels. Text differs when a workspace snapshot will
               be restored vs a conversation-only rewind. -->
          <template v-else-if="confirmingRewind">
            <span :style="{ color: t.textDim }">{{ rewindConfirmText }}</span>
            <AppButton variant="ghost" size="xs" class="ml-1" @click="confirmingRewind = false">
              {{ tr('session.msg.edit_cancel') }}
            </AppButton>
            <AppButton variant="danger" size="xs" @click="doRewind">
              {{ tr('session.msg.rewind') }}
            </AppButton>
          </template>
          <template v-else>
            <AppButton
              v-if="message.text"
              variant="ghost"
              size="xs"
              :title="copied ? tr('session.msg.copied') : tr('session.msg.copy')"
              @click="copyMessage"
            >
              <Check v-if="copied" :size="12" />
              <Copy v-else :size="12" />
            </AppButton>
            <AppButton
              v-if="!sessionStreaming"
              variant="ghost"
              size="xs"
              :title="tr('session.msg.regenerate')"
              @click="onRegenerate"
            >
              <RefreshCw :size="12" />
            </AppButton>
            <MessageRetryMenu
              v-if="!sessionStreaming && session"
              :session="session"
              :agent-message-id="message.id"
            />
            <AppButton
              v-if="!sessionStreaming"
              variant="ghost"
              size="xs"
              :title="tr('session.msg.rewind')"
              @click="confirmingRewind = true"
            >
              <RotateCcw :size="12" />
            </AppButton>
            <AppButton
              variant="ghost"
              size="xs"
              :title="tr('session.msg.branch')"
              @click="onBranch"
            >
              <GitBranch :size="12" />
            </AppButton>
            <span v-if="message.at" class="ml-0.5">{{ fmt(message.at) }}</span>
            <span v-if="message.startedAt && message.completedAt">
              · {{ formatElapsed(workingElapsed(message.completedAt)) }}
            </span>
            <span v-if="message.usage">· {{ message.usage.outputTokens }} tok</span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Activity,
  Check,
  ChevronDown,
  Clock,
  Copy,
  CornerDownRight,
  FileText,
  GitBranch,
  Pencil,
  RefreshCw,
  RotateCcw,
  Slash,
} from 'lucide-vue-next'
import { nextTick, useTemplateRef } from 'vue'
import type {
  Session,
  SessionAttachment,
  SessionMessage,
  SessionMessagePart,
  SessionStep,
  SessionTokenKind,
} from '~/types'
import { tokenizeMessage } from '~/utils/tokenize'
import { stripFollowUpSection } from '~/utils/follow-up'
import { formatTime } from '~/utils/time'

const props = defineProps<{
  message: SessionMessage
  session: Session
  now: number
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const settingsStore = useSettingsStore()
const store = useSessionsStore()

// True while this message's session has a live streaming turn — the edit /
// regenerate / retry actions truncate the transcript, so they hide mid-turn to
// avoid racing the in-flight reply.
const sessionStreaming = computed(() => store.isSessionStreaming(props.session.id))

// Toggle (Settings → Appearance): wrap the reply body in a bubble card vs render
// it as a plain inline document. Default on; `!== false` keeps older persisted
// appearance blobs (no field) bubbled.
const assistantBubble = computed(() => settingsStore.appearance.assistantBubble !== false)

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

// Each inline step cluster owns its collapse state (SessionStepCluster), default
// COLLAPSED ("đóng sẵn") and independent per run — so the turn reads as a clean
// document and consecutive reason→act runs fold/unfold on their own.

const isStreaming = computed(() => !!(props.message.startedAt && !props.message.completedAt))

type TimelineBlock =
  | { type: 'text'; text: string }
  | { type: 'steps'; steps: SessionStep[] }
  | { type: 'question'; step: SessionStep }
  // A mid-turn steer the user injected (kind: 'steer'). Always-visible inline
  // user-note in the agent timeline at the point it landed.
  | { type: 'steer'; step: SessionStep }

// Coalesce the authoritative ordered parts (ADR 0032) into render blocks: each
// text part is a text block; consecutive step parts collapse into one cluster.
// Thinking parts interleave in arrival order — each reasoning block sits right
// before the tool/step it produced (Pi streams thinking ahead of each tool call),
// so the cluster reads "reason → act" per step instead of one merged block.
const blocksFromParts = (parts: SessionMessagePart[]): TimelineBlock[] => {
  const body: TimelineBlock[] = []
  for (const p of parts) {
    // TODO (note) steps render standalone above the body — never in the timeline.
    if (p.kind === 'note') continue
    // Question steps get their own block so the card renders inline at the point
    // it was asked (always visible — the turn is blocked until answered).
    if (p.kind === 'question') {
      body.push({ type: 'question', step: p })
      continue
    }
    // Steer notes render inline (always visible) at the point they landed.
    if (p.kind === 'steer') {
      body.push({ type: 'steer', step: p })
      continue
    }
    if (p.kind === 'text') {
      if (p.text.trim()) body.push({ type: 'text', text: p.text })
      continue
    }
    // thinking + tool steps share the timeline; consecutive ones collapse into
    // one cluster so reasoning lines up with the action it preceded.
    const last = body[body.length - 1]
    if (last && last.type === 'steps') last.steps.push(p)
    else body.push({ type: 'steps', steps: [p] })
  }
  return body
}

// Reply turns mix narration text with tool calls. When the sidecar-built ordered
// `parts` are present (finalized / reloaded turn) we render them directly. Absent
// (legacy message / live stream before finalize) we derive the order from `text`
// + each step's stamped textOffset: split the reply text at those offsets and
// coalesce runs of consecutive steps into one cluster. Whitespace-only gaps are
// dropped (the cluster/text margins handle spacing).
const timelineBlocks = computed<TimelineBlock[]>(() => {
  const parts = props.message.parts
  if (parts?.length) return blocksFromParts(parts)

  const text = props.message.text ?? ''
  const allSteps = props.message.steps ?? []
  if (!allSteps.length) return text ? [{ type: 'text', text }] : []

  // Interleave by stamped text offset: thinking/tool steps and question cards
  // sort to where they fired (reasoning just before its tool → "reason → act";
  // a question card at the point it was asked). TODO (note) steps render
  // standalone above the body, so keep only those out of the timeline.
  const steps = allSteps.filter((s: SessionStep) => s.kind !== 'note')
  if (!steps.length) return text ? [{ type: 'text', text }] : []

  const len = text.length
  const ordered = steps
    .map((s, i) => ({ s, i, off: Math.min(Math.max(s.textOffset ?? len, 0), len) }))
    .sort((a, b) => a.off - b.off || a.i - b.i)
  const body: TimelineBlock[] = []
  let cursor = 0
  const pushStep = (step: SessionStep) => {
    // Questions + steer notes are standalone blocks; tool/thinking steps coalesce.
    if (step.kind === 'question') {
      body.push({ type: 'question', step })
      return
    }
    if (step.kind === 'steer') {
      body.push({ type: 'steer', step })
      return
    }
    const last = body[body.length - 1]
    if (last && last.type === 'steps') last.steps.push(step)
    else body.push({ type: 'steps', steps: [step] })
  }
  ordered.forEach(({ s, off }) => {
    if (off > cursor) {
      const seg = text.slice(cursor, off)
      if (seg.trim()) body.push({ type: 'text', text: seg })
      cursor = off
    }
    pushStep(s)
  })
  if (cursor < len) {
    const seg = text.slice(cursor)
    if (seg.trim()) body.push({ type: 'text', text: seg })
  }
  return body
})

// Whether the reply has anything to render yet. Early in a streaming turn there's
// no text/steps/artifacts — without this gate the bubble paints as an empty box
// until the first token lands. The bubble chrome only shows once there's content;
// the "Streaming…" ticker lives in the byline below, outside the bubble.
// (TodoWrite `note` steps don't count — they render in SessionTodoPanel, not here.)
const hasBubbleContent = computed(
  () =>
    timelineBlocks.value.length > 0 ||
    (props.message.artifacts?.length ?? 0) > 0 ||
    store.pendingPermission?.messageId === props.message.id,
)
const showBubble = computed(() => assistantBubble.value && hasBubbleContent.value)

// The turn is parked on human input, not actually streaming: it called
// AskUserQuestion (an unanswered `kind:'question'` step) or it is blocked on a
// permission prompt. While parked the byline must NOT tick "Streaming… {elapsed}"
// — the clock would run for as long as the user takes to answer (minutes). Show
// a paused "waiting" state instead; it flips back to streaming once answered.
const awaitingQuestion = computed(() =>
  (props.message.steps ?? []).some((s: SessionStep) => s.kind === 'question' && !s.answers),
)
const awaitingPermission = computed(() => store.pendingPermission?.messageId === props.message.id)
const awaitingInput = computed(() => awaitingQuestion.value || awaitingPermission.value)
const awaitingLabel = computed(() =>
  awaitingPermission.value
    ? tr('session.msg.awaiting_permission')
    : tr('session.msg.awaiting_answer'),
)

// Elapsed working time = wall-clock minus time PARKED on human input
// (waitingMs), so a turn that waited 8m for an answer doesn't read as 8m of
// work. Guarded ≥ 0 against clock skew. `end` is `now` (live) or completedAt.
const workingElapsed = (end: number): number =>
  Math.max(0, end - (props.message.startedAt ?? end) - (props.message.waitingMs ?? 0))

// Only the trailing text segment is still being typed — flag it so
// MarkdownStreamBody throttles just that one and renders the rest immediately.
const lastTextBlockIndex = computed(() => {
  const blocks = timelineBlocks.value
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.type === 'text') return i
  }
  return -1
})

// Fork the conversation from this message into a new session and switch to it.
// The original session is left untouched.
const onBranch = () => {
  store.branchFromMessage(props.message.id)
}

// ── Edit & resend (user message) ────────────────────────────────────────────
// Editing a user message truncates the transcript back to before it, then
// re-sends the edited text as a fresh turn. The textarea seeds from bodyText
// (the follow-up quote section is stripped), so an edited resend drops the
// quote cards — accepted for v1.
const editing = ref(false)
const editDraft = ref('')
const editRef = useTemplateRef<HTMLTextAreaElement>('editRef')

// Slash-command turns render as a compact `/name …` chip; expanding reveals the
// full template text (`bodyText`) that the model received. Collapsed by default.
const commandExpanded = ref(false)

const startEdit = () => {
  editDraft.value = bodyText.value
  editing.value = true
  void nextTick(() => {
    const el = editRef.value
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  })
}

const cancelEdit = () => {
  editing.value = false
  editDraft.value = ''
}

const saveEdit = () => {
  const next = editDraft.value.trim()
  editing.value = false
  if (!next) return
  void store.editAndResend(props.message.id, next)
}

// Regenerate this assistant reply (same model). Re-runs the user turn above it.
const onRegenerate = () => {
  void store.regenerate(props.message.id)
}

// ── Rewind (ADR 0038) ───────────────────────────────────────────────────────
// Rewind truncates the conversation back to this message and (when a snapshot
// exists for it) restores the workspace files to that turn's state.
const confirmingRewind = ref(false)
const rewindConfirmText = computed(() =>
  store.hasSnapshot(props.session.id, props.message.id)
    ? tr('session.msg.rewind_confirm_files')
    : tr('session.msg.rewind_confirm_plain'),
)
const doRewind = () => {
  confirmingRewind.value = false
  void store.rewindTo(props.message.id)
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
