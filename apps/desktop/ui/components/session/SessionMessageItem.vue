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
          v-if="clusterSteps.length"
          type="button"
          class="inline-flex items-center gap-1.5 text-[12px] py-0.5 px-1.5 -ml-1.5 mb-2 rounded transition hover:bg-white/5"
          :style="{ color: t.textDim }"
          @click="expanded = !expanded"
        >
          <Info :size="11" />
          <span>{{ stepsSummary(clusterSteps) }}</span>
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

        <!-- TODO checklist (TodoWrite). Lifted OUT of the collapsible task cluster
             so the agent's plan/progress stays visible even while the tool-call
             detail is collapsed. The sidecar upserts one 'todo-list' step per turn,
             so this normally renders a single evolving checklist. -->
        <div
          v-for="todo in todoSteps"
          :key="todo.id"
          class="mb-2 rounded-md px-3 py-2 text-[12px]"
          :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
        >
          <StepItem :step="todo" />
        </div>

        <!-- Body. Reply text, AskUserQuestion cards, and step clusters interleave
             in chronological order. Question cards always render at their position
             (a pending question stays visible — the turn is blocked); step
             clusters render only when expanded. Collapsed merges the text around
             hidden steps so the reply still reads as one document. -->
        <template v-for="(block, bi) in displayBlocks" :key="bi">
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
          <!-- Inline step timeline (Claude-Code style): flat vertical list, no
               box — each step's own status icon is the bullet, a thin left rail
               groups the run. `timeline` tells StepItem to wrap long paths and
               show a one-line result summary instead of truncating. -->
          <div
            v-else
            class="mt-2 space-y-1 text-[12px] pl-3"
            :style="{ borderLeft: `2px solid ${t.border}` }"
          >
            <StepItem v-for="s in block.steps" :key="s.id" :step="s" timeline />
          </div>
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
import type {
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

// Inline step timeline — local state so multiple bubbles can stay
// collapsed/expanded independently. Default state is COLLAPSED ("đóng sẵn"): a
// turn reads as a clean document, with the summary line ("ran N commands…") as
// the toggle. Expanding reveals the Claude-Code-style step timeline (each tool
// call + interleaved reasoning, with ⎿ result summaries).
const expanded = ref(false)

// Steps that render inside the collapsible cluster: tool calls + thinking. TODO
// (note) and question steps are lifted out and rendered standalone (always
// visible), so they neither gate nor label the collapse toggle.
const clusterSteps = computed<SessionStep[]>(
  () =>
    props.message.steps?.filter((s: SessionStep) => s.kind !== 'note' && s.kind !== 'question') ??
    [],
)

const hasRunningStep = computed((): boolean =>
  clusterSteps.value.some((s: SessionStep) => s.status === 'running' || s.status === undefined),
)

const isStreaming = computed(() => !!(props.message.startedAt && !props.message.completedAt))

type TimelineBlock =
  | { type: 'text'; text: string }
  | { type: 'steps'; steps: SessionStep[] }
  | { type: 'question'; step: SessionStep }

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
    // Questions are standalone blocks; tool/thinking steps coalesce into a cluster.
    if (step.kind === 'question') {
      body.push({ type: 'question', step })
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

// What actually renders. Expanded → the full interleaved timeline. Collapsed →
// step clusters dropped and the text around them merged so the reply reads as
// one document, but text and question cards stay inline at their position (a
// pending question must remain visible even when the steps are tucked away).
const displayBlocks = computed<TimelineBlock[]>(() => {
  const blocks = timelineBlocks.value
  if (expanded.value) return blocks
  const out: TimelineBlock[] = []
  for (const b of blocks) {
    if (b.type === 'steps') continue
    if (b.type === 'text') {
      const last = out[out.length - 1]
      if (last && last.type === 'text') last.text = `${last.text}\n\n${b.text}`
      else out.push({ type: 'text', text: b.text })
      continue
    }
    out.push(b)
  }
  return out
})

// TODO checklist steps (kind === 'note'), rendered standalone above the body and
// outside the collapsible cluster so the agent's plan/progress is always visible.
// The sidecar upserts one 'todo-list' step per turn, so this is normally a single
// evolving checklist.
const todoSteps = computed<SessionStep[]>(
  () => props.message.steps?.filter((s: SessionStep) => s.kind === 'note') ?? [],
)

// Only the trailing text segment is still being typed — flag it so
// MarkdownStreamBody throttles just that one and renders the rest immediately.
const lastTextBlockIndex = computed(() => {
  const blocks = displayBlocks.value
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
