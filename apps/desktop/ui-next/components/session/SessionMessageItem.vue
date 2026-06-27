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
          <span class="strshimmer">{{ t('sessions.message.streaming') }}</span>
          {{ elapsedLabel }}
        </template>
        <template v-else>
          <span class="strshimmer">{{ t('sessions.message.waiting') }}</span>
        </template>
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
      <span class="ha" :title="t('sessions.message.edit')" @click="editMsg">
        <Icon name="edit" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.resend')" @click="resend">
        <Icon name="send" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.rewind')" @click="rewind">
        <Icon name="rewind" style="width: 13px; height: 13px" />
      </span>
      <span class="ha" :title="t('sessions.message.fork')" @click="fork">
        <Icon name="fork" style="width: 13px; height: 13px" />
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
    <div ref="bodyEl" class="abody" :class="{ bubble: showBubble }">
      <template v-for="(g, gi) in grouped" :key="g.key">
        <SessionCluster v-if="g.type === 'cluster'" :steps="g.steps" />
        <SessionStepItem v-else-if="g.type === 'step'" :block="g.step" />
        <SessionTextBlock
          v-else-if="g.type === 'text'"
          :text="g.text"
          :highlights="highlightsForBlock(g.blockIndex)"
          :streaming="streaming"
          :caret="streaming && gi === grouped.length - 1"
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
    </div>
    <!-- Floating pill at the top-right of the reply: only earns its place on a TALL
         reply (>500px) where the bottom action row would otherwise be a scroll away.
         Never while streaming (would collide with the byline; actions aren't valid yet). -->
    <div v-if="showTopActions" class="hoveract top">
      <span v-for="a in msgActions" :key="a.icon" class="ha" :title="a.title" @click="a.run">
        <Icon :name="a.icon" style="width: 13px; height: 13px" />
      </span>
    </div>
    <!-- Meta row at the bottom: timestamp/byline on the left, the same actions inline
         on the right — reachable at the end of a long reply without scrolling up. -->
    <div class="mmeta mmetarow">
      <span class="mmetatxt">
        <template v-if="streaming">
          <span class="strdot" :class="{ pulse: streamingActive }" />
          <template v-if="streamingActive">
            <span class="strshimmer">{{ t('sessions.message.streaming') }}</span>
            {{ elapsedLabel }}
          </template>
          <template v-else>
            <span class="strshimmer">{{ t('sessions.message.waiting') }}</span>
          </template>
        </template>
        <template v-else>
          {{ fmt(message.at) }} · {{ tokLabel }} tok
          <template v-if="elapsedLabel">· {{ elapsedLabel }}</template>
        </template>
      </span>
      <div v-if="showBottomActions" class="hoveract bottom">
        <span v-for="a in msgActions" :key="a.icon" class="ha" :title="a.title" @click="a.run">
          <Icon :name="a.icon" style="width: 13px; height: 13px" />
        </span>
      </div>
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
const settings = useSettingsStore()

// Assistant-bubble pref (Settings → Sessions): wrap the reply body in an elevated
// bubble card. Only when there's content (don't paint an empty box mid-stream).
const showBubble = computed(
  () =>
    settings.sessions.assistantBubble &&
    props.message.role === 'assistant' &&
    grouped.value.length > 0,
)

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
// Parked on a real gate = an unanswered question or a pending permission in THIS
// message. Only then do we show the static "Waiting…"; otherwise a streaming turn
// is actively generating (incl. tool calls) → "Streaming…". Deriving this from the
// message's own blocks (not the laggy session status) avoids a stuck "Waiting…"
// after a tool/gate auto-resolves and the model is working again.
const parkedOnGate = computed(() => {
  const m = asAssistant.value
  if (!m) return false
  return m.blocks.some(
    (b) =>
      (b.kind === 'question' && !questionAnswered(b)) ||
      (b.kind === 'perm' && b.status === 'pending'),
  )
})
const streamingActive = computed(() => streaming.value && !parkedOnGate.value)

// ── Action-toolbar visibility ────────────────────────────────────────────────
// Never on an in-flight reply: the actions (quote/fork/regen…) aren't valid until
// the turn finishes, and the floating top pill would collide with the "Streaming…"
// byline (the empty body collapses both onto the same line). The TOP pill is also
// gated on a tall reply — on a short one the inline bottom row is right there, so a
// second floating copy is just clutter.
const TALL_REPLY_PX = 500
const bodyEl = useTemplateRef<HTMLElement>('bodyEl')
const bodyHeight = ref(0)
let bodyRO: ResizeObserver | null = null
const showBottomActions = computed(() => !streaming.value)
const showTopActions = computed(() => !streaming.value && bodyHeight.value > TALL_REPLY_PX)

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
// Track the rendered reply height (drives showTopActions). The body grows as the
// reply streams in, so observe it rather than measure once. Only assistant rows
// have `.abody`; for others bodyEl is null and the top pill stays hidden anyway.
onMounted(() => {
  const el = bodyEl.value
  if (!el) return
  bodyRO = new ResizeObserver(() => {
    bodyHeight.value = el.offsetHeight
  })
  bodyRO.observe(el)
})
onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
  bodyRO?.disconnect()
  bodyRO = null
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
// Edit → open the focused prompt-edit overlay (§9); on confirm, edit & resend this
// user turn (truncate it + everything after, re-run with the new text). Cancel
// (null) leaves the turn untouched.
const { openPromptEdit } = useCommandPalette()
const editMsg = async () => {
  const next = await openPromptEdit(plainText.value)
  if (next == null) return
  if (store.activeId != null && msgIndex.value >= 0) {
    void store.resend(store.activeId, msgIndex.value, next)
  }
}
// Resend → re-run this user turn unchanged (one click, no overlay).
const resend = () => act(store.resend)
const regen = () => act(store.regenerate)
const retry = () => act(store.retryModel)
const rewind = () => act(store.rewind)
const fork = () => act((id, i) => store.fork(id, i, 'fork'))
const branch = () => act((id, i) => store.fork(id, i, 'branch'))

// One action set, rendered twice (floating pill at the top + inline on the meta
// row at the bottom) so the actions are reachable without scrolling a long reply.
const msgActions = computed(() => [
  { icon: 'copy', title: t('sessions.message.copy'), run: copyText },
  { icon: 'quote', title: t('sessions.message.quote'), run: quote },
  { icon: 'refresh', title: t('sessions.message.regen'), run: regen },
  { icon: 'settings', title: t('sessions.message.retryModel'), run: retry },
  { icon: 'rewind', title: t('sessions.message.rewind'), run: rewind },
  { icon: 'branch', title: t('sessions.message.branch'), run: branch },
  { icon: 'fork', title: t('sessions.message.forkShort'), run: fork },
])
</script>

<style scoped>
/* Hover actions: a cohesive floating toolbar (pill) overlaying the message's top
   corner on hover — no reserved row below every message (the old invisible 26px row
   was the big inter-message gap). Position-relative host + absolute toolbar. */
.maw,
.urow {
  position: relative;
}
.hoveract {
  position: absolute;
  top: -9px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 1px 3px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}
.maw .hoveract {
  right: 0;
}
/* User bubble is right-aligned (.urow align-self:flex-end), so its hover pill must
   hug the bubble's top-right — not float off at the row's far-left edge. */
.urow .hoveract {
  right: 0;
}
/* Bubble width: the prototype caps .mu at max-width:74%, but that % resolves against
   .urow — which shrinks to its widest child. For a short message the meta line
   ("04:02 PM · 3 tok") is wider than the text, so the bubble got capped to 74% of the
   TIMESTAMP width and even "review lại" wrapped. Let the bubble size to its own
   content instead; long messages are still capped by .urow's max-width:80% of the
   transcript. */
.mu {
  max-width: 100%;
}
/* The bottom copy (assistant only) sits inline on the meta row — same actions, no
   floating pill chrome, right-aligned next to the byline so it hugs the reply end. */
.maw .hoveract.bottom {
  position: static;
  top: auto;
  right: auto;
  margin-left: auto;
  padding: 0;
  background: none;
  border: none;
  box-shadow: none;
}
/* Meta row holds the byline (left) + inline action set (right). */
.mmetarow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mmetatxt {
  min-width: 0;
}
/* Ghost icon buttons inside the toolbar: borderless, fill on hover. */
.hoveract .ha {
  display: grid;
  place-items: center;
  width: 24px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--textDim);
}
.hoveract .ha:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* Assistant reply body. Always a flex column (keeps the per-block gap); the
   `bubble` variant (Settings → Sessions · Assistant bubble) wraps it in an
   elevated card mirroring the user bubble, left-tailed. */
.abody {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.abody.bubble {
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 16px;
  border-bottom-left-radius: 5px;
  padding: 11px 14px;
}
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
