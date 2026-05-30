<template>
  <div>
    <div
      v-if="message.role === 'system'"
      class="text-center text-[0.71em] uppercase tracking-wider"
      :style="{ color: t.textDim }"
    >
      ── {{ message.text }} · {{ fmt(message.at) }} ──
    </div>

    <div v-else>
      <div v-if="message.role === 'user'" class="flex flex-col items-end gap-1.5">
        <div
          v-if="message.text"
          class="rounded-2xl px-4 py-2 text-[0.93em] leading-relaxed whitespace-pre-wrap"
          :style="{
            background: t.bgElevated,
            color: t.text,
            border: `1px solid ${t.border}`,
            maxWidth: '78%',
          }"
        >
          <template v-for="(seg, i) in tokenizeMessage(message.text)" :key="i">
            <span
              v-if="seg.kind === 'token'"
              :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
            >
              {{ seg.text }}
            </span>
            <template v-else>{{ seg.text }}</template>
          </template>
        </div>
        <SessionMessageAttachments
          v-if="message.attachments?.length"
          :attachments="message.attachments"
          @open="(att: SessionAttachment) => emit('openAttachment', att)"
        />
        <div class="text-[0.64em] flex items-center gap-1.5" :style="{ color: t.textFaint }">
          <span>{{ fmt(message.at) }}</span>
          <span v-if="message.modeAtSend">· sent in {{ message.modeAtSend }} mode</span>
        </div>
      </div>

      <div
        v-if="message.role === 'agent'"
        class="rounded-2xl px-4 py-3 text-[0.93em] leading-relaxed"
        :style="{
          background: t.bgElevated,
          border: `1px solid ${t.border}`,
          maxWidth: '92%',
        }"
      >
        <div
          class="flex items-center gap-1.5 mb-2 text-[0.71em] uppercase tracking-wider"
          :style="{ color: t.textFaint }"
        >
          <Sparkles :size="10" :style="{ color: t.accent }" />
          <span :style="{ color: t.textDim }">Assistant</span>
          <template v-if="message.modelUsed">
            <span>·</span>
            <span class="font-mono normal-case tracking-normal">{{ message.modelUsed }}</span>
          </template>
          <template v-if="message.at">
            <span>·</span>
            <span class="normal-case tracking-normal">{{ fmt(message.at) }}</span>
          </template>
          <span class="flex-1" />
          <button
            v-if="message.text"
            type="button"
            class="awog-copy-btn"
            :style="{ color: copied ? t.success : t.textDim }"
            :title="copied ? 'Copied' : 'Copy message'"
            @click="copyMessage"
          >
            <Check v-if="copied" :size="12" />
            <Copy v-else :size="12" />
          </button>
        </div>

        <MarkdownStreamBody
          v-if="message.text"
          :text="message.text"
          :streaming="!!(message.startedAt && !message.completedAt)"
          class="awog-md text-[0.93em]"
          :style="{ color: t.text, '--awog-accent': t.accent }"
          :data-agent-message-id="message.id"
        />

        <button
          v-if="message.steps?.length"
          type="button"
          class="inline-flex items-center gap-1.5 text-[0.79em] py-0.5 px-1.5 -ml-1.5 rounded transition hover:bg-white/5"
          :class="message.text ? 'mt-2' : ''"
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

        <!-- Inline collapsible step list. Replaces the previous centered
             modal so the subagent drawer (slides in from the right) remains
             visible and the user can compare steps + drawer reply
             side-by-side. -->
        <SessionMessageSteps v-if="message.steps?.length && expanded" :steps="message.steps" />

        <SessionInlinePermission
          v-if="store.pendingPermission?.messageId === message.id"
          :message-id="message.id"
          class="mt-2"
        />

        <div
          v-if="message.startedAt"
          class="mt-2 pt-2 text-[0.71em] flex items-center gap-2"
          :style="{ color: t.textFaint, borderTop: `1px dashed ${t.border}` }"
        >
          <template v-if="message.completedAt">
            <span>{{ formatElapsed(message.completedAt - message.startedAt) }}</span>
            <span v-if="message.usage">· {{ message.usage.outputTokens }} tok</span>
          </template>
          <template v-else>
            <Activity :size="10" class="animate-pulse" />
            <span>Streaming… {{ formatElapsed(now - message.startedAt) }}</span>
          </template>
        </div>

        <div v-if="message.artifacts?.length" class="mt-2 space-y-1.5">
          <div
            v-for="art in message.artifacts"
            :key="art.name"
            class="rounded"
            :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
          >
            <div
              class="px-2.5 py-1.5 flex items-center gap-1.5 text-[0.79em]"
              :style="{ borderBottom: art.preview ? `1px solid ${t.border}` : 'none' }"
            >
              <FileText :size="11" :style="{ color: t.textDim }" />
              <span class="font-mono" :style="{ color: t.text }">{{ art.name }}</span>
            </div>
            <pre
              v-if="art.preview"
              class="text-[0.79em] px-2.5 py-2 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap"
              :style="{ color: t.textMuted, maxHeight: '160px' }"
              >{{ art.preview }}</pre
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Activity, Check, ChevronDown, Copy, FileText, Info, Sparkles } from 'lucide-vue-next'
import type { SessionAttachment, SessionMessage, SessionStep, SessionTokenKind } from '~/types'
import { tokenizeMessage } from '~/utils/tokenize'
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

// Same aggregation logic as SessionMessageSteps' inner summary — kept local
// here for the toggle-button label. Two callsites only (Rule of Three).
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
