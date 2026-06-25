<template>
  <!-- system divider -->
  <div v-if="message.role === 'system'" :data-mi="msgIndex" class="sysdiv">
    <span class="sl" />
    <Icon name="refresh" style="width: 12px; height: 12px" />
    {{ message.text }}
    <span class="sl" />
  </div>

  <!-- user bubble -->
  <div v-else-if="message.role === 'user'" :data-mi="msgIndex" class="urow">
    <div class="mu">
      <div v-if="message.quotes && message.quotes.length" class="uquotes">
        <div v-for="(q, k) in message.quotes" :key="k" class="uq">
          <span class="fwn">{{ CIRCLED[k] }}</span>
          <div>
            <div class="uqx">{{ q.excerpt }}</div>
            <div v-if="q.note" class="uqn">{{ q.note }}</div>
          </div>
        </div>
      </div>
      <template v-for="(line, k) in message.text.split('\n')" :key="k">
        <br v-if="k > 0" />
        {{ line }}
      </template>
      <div v-if="message.att && message.att.length" class="uatt">
        <SessionAttachmentChip v-for="(a, k) in message.att" :key="k" :att="a" />
      </div>
    </div>
    <div class="mmeta">
      <template v-if="streaming">
        <span class="strdot" :class="{ pulse: streamingActive }" />
        <template v-if="streamingActive">
          {{ t('sessions.message.streaming') }} {{ elapsedLabel }}
        </template>
        <template v-else>{{ t('sessions.message.waiting') }}</template>
      </template>
      <template v-else>
        {{ fmt(message.at) }} · {{ tokLabel }} tok
        <template v-if="elapsedLabel">· {{ elapsedLabel }}</template>
      </template>
    </div>
    <div class="hoveract">
      <span class="ha" :title="t('sessions.message.copy')" @click="copyText">
        <Icon name="copy" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.fork')" @click="fork">
        <Icon name="fork" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.edit')" @click="editMsg">
        <Icon name="edit" style="width: 13px; height: 13px" />
      </span>
    </div>
  </div>

  <!-- assistant -->
  <div v-else :data-mi="msgIndex" class="maw">
    <div v-if="anchors.length" class="fwanchors">
      <span
        v-for="a in anchors"
        :key="a.label"
        class="fwanchor"
        role="button"
        :title="t('sessions.transcript.anchor.tooltip')"
        style="cursor: pointer"
        @click="scrollToMessage(msgIndex)"
      >
        {{ a.label }}
      </span>
    </div>
    <template v-for="(g, gi) in grouped" :key="g.key">
      <SessionCluster v-if="g.type === 'cluster'" :steps="g.steps" />
      <SessionStepItem v-else-if="g.type === 'step'" :block="g.step" />
      <SessionTextBlock
        v-else-if="g.type === 'text'"
        :text="g.text"
        :highlights="highlightsForBlock(g.blockIndex)"
      />
      <div
        v-else-if="g.type === 'thinking'"
        class="blk think"
        :class="{ col: !thinkExpanded.has(gi) }"
      >
        <div class="thh" @click="toggleThink(gi)">
          <Icon name="chev" style="width: 12px; height: 12px" />
          <Icon name="brain" class="thinkic" style="width: 13px; height: 13px" />
          {{ t('sessions.thinking') }}
        </div>
        <div class="thb">{{ g.text }}</div>
      </div>
      <SessionGateCard v-else :block="g.gate" />
    </template>
    <div class="mmeta">
      <template v-if="streaming">
        <span class="strdot" :class="{ pulse: streamingActive }" />
        <template v-if="streamingActive">
          {{ t('sessions.message.streaming') }} {{ elapsedLabel }}
        </template>
        <template v-else>{{ t('sessions.message.waiting') }}</template>
      </template>
      <template v-else>
        {{ fmt(message.at) }} · {{ tokLabel }} tok
        <template v-if="elapsedLabel">· {{ elapsedLabel }}</template>
      </template>
    </div>
    <div class="hoveract">
      <span class="ha" :title="t('sessions.message.copy')" @click="copyText">
        <Icon name="copy" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.quote')" @click="quote">
        <Icon name="quote" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.regen')" @click="regen">
        <Icon name="refresh" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.retryModel')" @click="retry">
        <Icon name="settings" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.rewind')" @click="rewind">
        <Icon name="rewind" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.branch')" @click="branch">
        <Icon name="branch" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.forkShort')" @click="fork">
        <Icon name="fork" style="width: 13px; height: 13px" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// One transcript message (renderMsgs ~1490): system divider, user bubble (.mu) with
// attachments + hover actions, or assistant (.maw) with grouped blocks + hover actions.
import type {
  SessionMessage,
  AssistantBlock,
  StepBlock,
  TextBlock,
  Followup,
} from '~/composables/useSessionsMock'
import type { BlockHighlight } from './SessionTextBlock.vue'

const props = defineProps<{ message: SessionMessage; fallbackWhen: string }>()
const { t } = useI18n()

// Pre-narrowed render units so the template never narrows a union via property
// access (vue-tsc friendly): each variant carries its concrete block type. `key`
// is a STABLE per-group identity (engine block eid where available, else a
// kind+position fallback) — used as the v-for key so a step/cluster component is
// NOT destroyed+recreated when the grouping reshapes mid-stream (which would reset
// its collapsed state → "clicking does nothing" while a turn streams).
type Grouped =
  | { key: string; type: 'cluster'; steps: StepBlock[] }
  | { key: string; type: 'step'; step: StepBlock }
  | { key: string; type: 'text'; text: string; blockIndex: number }
  | { key: string; type: 'thinking'; text: string }
  | { key: string; type: 'gate'; gate: AssistantBlock }

const blockKey = (b: AssistantBlock, bi: number): string =>
  'eid' in b && b.eid ? b.eid : `${b.kind}-${bi}`

// groupBlocks (~1452): collapse consecutive plain steps (no sub) into a cluster.
// Text groups carry their original `message.blocks` index so §8 highlights can be
// matched back to the exact block they were quoted from.
const grouped = computed<Grouped[]>(() => {
  if (props.message.role !== 'assistant') return []
  const out: Grouped[] = []
  let run: StepBlock[] = []
  let runBi = -1
  const flush = () => {
    if (!run.length) return
    const first = run[0]
    if (run.length === 1 && first)
      out.push({ key: blockKey(first, runBi), type: 'step', step: first })
    else out.push({ key: `cluster-${first?.eid ?? runBi}`, type: 'cluster', steps: run })
    run = []
    runBi = -1
  }
  props.message.blocks.forEach((b, bi) => {
    if (b.kind === 'step' && !b.sub) {
      if (!run.length) runBi = bi
      run.push(b)
      return
    }
    flush()
    if (b.kind === 'step') out.push({ key: blockKey(b, bi), type: 'step', step: b })
    else if (b.kind === 'text')
      out.push({ key: `text-${bi}`, type: 'text', text: b.text, blockIndex: bi })
    else if (b.kind === 'thinking')
      out.push({ key: blockKey(b, bi), type: 'thinking', text: b.text })
    else out.push({ key: blockKey(b, bi), type: 'gate', gate: b })
  })
  flush()
  return out
})

// Rough token estimate (mtok ~1493): char count / 3, formatted with k suffix.
const tokLabel = computed(() => {
  const m = props.message
  let chars = 0
  if (m.role === 'user' || m.role === 'system') chars = m.text.length
  else
    chars = m.blocks
      .map((b) => ('text' in b ? b.text : '') + ('detail' in b ? b.detail || '' : ''))
      .join('').length
  const n = Math.round((chars || 1) / 3)
  return n > 999 ? (n / 1000).toFixed(0) + 'k' : String(n)
})

// Thinking blocks collapse-by-default; track expanded group indices in a reactive Set
// (.think.col hides .thb). Keyed by `gi` so multiple thinking blocks toggle independently.
const thinkExpanded = reactive(new Set<number>())
const toggleThink = (gi: number) => {
  if (thinkExpanded.has(gi)) thinkExpanded.delete(gi)
  else thinkExpanded.add(gi)
}

// Message actions (mock-backed via the sessions store). The item finds its own index
// in the active session's message list so each button acts at the right point.
const store = useSessionsStore()
const { CIRCLED } = useSessionsMock()
const { scrollToMessage } = useSessionScroll()
const msgIndex = computed(() => store.active?.msgs.indexOf(props.message) ?? -1)

// ── Streaming indicator + time (mirrors the old flow) ───────────────────────────
// While the turn streams, the byline shows a live "Streaming… {elapsed}" ticker
// (or a static "waiting" when parked on a gate); when done it shows the message
// clock time + total elapsed.
const asAssistant = computed(() => (props.message.role === 'assistant' ? props.message : null))
const streaming = computed(() => asAssistant.value?.streaming ?? false)
const streamingActive = computed(() => streaming.value && store.active?.status === 'streaming')

const nowTick = ref(Date.now())
let elapsedTimer: ReturnType<typeof setInterval> | null = null
watch(
  streaming,
  (on) => {
    if (on && !elapsedTimer) {
      nowTick.value = Date.now()
      elapsedTimer = setInterval(() => (nowTick.value = Date.now()), 1000)
    } else if (!on && elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
})

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
// Working elapsed: streaming → ticks to now; done → frozen at completedAt. Empty
// for non-assistant messages (no startedAt).
const elapsedLabel = computed(() => {
  const start = asAssistant.value?.startedAt
  if (start == null) return ''
  const end = asAssistant.value?.completedAt ?? nowTick.value
  return formatElapsed(Math.max(0, end - start))
})
// Message clock time from an ISO `at`; non-ISO (legacy literal) passes through,
// empty → the session's fallback "when".
function fmt(at?: string): string {
  if (!at) return props.fallbackWhen
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return at
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Follow-ups quoted FROM this message, paired with their global index (→ circled
// label). State-derived: removing one (store.removeQuote) automatically drops + renumbers.
type IndexedFollowup = { fu: Followup; idx: number; label: string }
const ownFollowups = computed<IndexedFollowup[]>(() =>
  (store.active?.followups ?? [])
    .map((fu, idx) => ({ fu, idx, label: CIRCLED[idx] ?? String(idx + 1) }))
    .filter((x) => x.fu.src === msgIndex.value),
)

// Anchor badges: circled numbers for follow-up quotes whose source is THIS message.
const anchors = computed(() => ownFollowups.value.map((x) => ({ label: x.label })))

// Resolve each own-follow-up to exactly ONE target text-block index. Explicit
// `blockIndex` wins; otherwise the first text block whose text contains the excerpt
// (so a repeated excerpt marks once, not in every block). `-1` = no target.
const followupTargets = computed<{ fu: Followup; label: string; blockIndex: number }[]>(() => {
  const blocks = props.message.role === 'assistant' ? props.message.blocks : []
  return ownFollowups.value.map((x) => {
    if (x.fu.blockIndex != null) return { fu: x.fu, label: x.label, blockIndex: x.fu.blockIndex }
    const needle = (x.fu.excerpt || '').trim()
    const bi = needle ? blocks.findIndex((b) => b.kind === 'text' && b.text.includes(needle)) : -1
    return { fu: x.fu, label: x.label, blockIndex: bi }
  })
})

// §8 — highlights for one text block, derived purely from state so regenerate/rewind
// and store.removeQuote re-render correctly (no stale local copy, automatic renumber).
const highlightsForBlock = (blockIndex: number): BlockHighlight[] =>
  followupTargets.value
    .filter((x) => x.blockIndex === blockIndex)
    .map((x) => ({ fu: x.fu, label: x.label }))

// Plain text — user: raw; assistant: concatenated text blocks.
const plainText = computed(() => {
  const m = props.message
  if (m.role === 'assistant')
    return m.blocks
      .filter((b): b is TextBlock => b.kind === 'text')
      .map((b) => b.text)
      .join('\n\n')
  return m.text
})

function act(fn: (id: number, i: number) => void) {
  if (store.activeId != null && msgIndex.value >= 0) fn(store.activeId, msgIndex.value)
}
const copyText = () => void navigator.clipboard.writeText(plainText.value)
const quote = () => act(store.addQuote)
// Edit → open the focused prompt-edit overlay (§9); on confirm seed the composer
// with the edited text. Cancel (null) leaves the composer untouched.
const { openPromptEdit } = useCommandPalette()
const editMsg = async () => {
  const next = await openPromptEdit(plainText.value)
  if (next != null) store.seedComposer(next)
}
const regen = () => act(store.regenerate)
const retry = () => act(store.retryModel)
const rewind = () => act(store.rewind)
const fork = () => act((id, i) => store.fork(id, i, 'fork'))
const branch = () => act((id, i) => store.fork(id, i, 'branch'))
</script>

<style scoped>
/* Brain glyph on the Thinking header — subtle, consistent with the step icons. */
.thinkic {
  flex: 0 0 auto;
  color: var(--textDim);
}
/* Streaming byline dot: pulses while actively generating, static when parked. */
.strdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  margin-right: 5px;
  vertical-align: middle;
  opacity: 0.5;
}
.strdot.pulse {
  opacity: 1;
  animation: strpulse 1.4s ease-in-out infinite;
}
@keyframes strpulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .strdot.pulse {
    animation: none;
  }
}
</style>
