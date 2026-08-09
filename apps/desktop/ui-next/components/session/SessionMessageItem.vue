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
      <!-- Slash command: show the compact invocation, not the expanded body
           (full body sent to the model lives in message.text, shown on hover). -->
      <span v-if="message.command" class="ucmd" :title="message.text">
        <Icon name="commands" style="width: 12px; height: 12px" />
        <span class="ucmd-name">/{{ message.command.name }}</span>
        <span v-if="message.command.args" class="ucmd-args">{{ message.command.args }}</span>
      </span>
      <template v-else>
        <SessionLinkedText :text="message.text" />
      </template>
      <div v-if="message.att && message.att.length" class="uatt">
        <SessionAttachmentChip
          v-for="(a, k) in message.att"
          :key="k"
          :att="a"
          :siblings="message.att"
        />
      </div>
    </div>
    <!-- Footer (standardized with the assistant): byline + persistent actions below the
         bubble, right-aligned — replaces the old floating hover pill. -->
    <div class="mmeta mmetarow">
      <span class="mmetatxt">{{ fmt(message.at) }} · {{ tokLabel }} tok</span>
      <div class="hoveract bottom">
        <span class="ha" :title="t('sessions.message.copy')" @click="copyText">
          <Icon name="copy" style="width: 13px; height: 13px" />
        </span>
        <span class="ha" :title="t('sessions.message.fullscreen')" @click="openFullscreen">
          <Icon name="maximize" style="width: 13px; height: 13px" />
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
    <!-- The whole assistant turn sits in ONE elevated bubble (craft-style card): the
         collapsed activity section ("N steps") + the final response together, so they
         read as one unit. The response caps its own height + scrolls inside the card. -->
    <div class="abody" :class="{ bubble: showBubble }">
      <template v-for="(g, gi) in grouped" :key="g.key">
        <!-- Collapsible activity section (tools + thinking + intermediate commentary),
             craft TurnCard body. -->
        <SessionTurnActivities
          v-if="g.type === 'activities'"
          :entries="g.entries"
          :preview="g.preview"
          :streaming="streaming"
        />
        <!-- The prominent final answer (craft's ResponseCard) — bubbled per the
             assistantBubble pref. Carries §8 quote highlights + caret. -->
        <SessionTextBlock
          v-else-if="g.type === 'text'"
          :text="g.text"
          :highlights="highlightsForBlock(g.blockIndex)"
          :streaming="streaming"
          :caret="streaming && gi === grouped.length - 1"
          :bubble="showBubble"
        />
        <!-- Latest TodoWrite checklist, rendered inline once the docked banner yields. -->
        <SessionStepItem v-else-if="g.type === 'todo'" :block="g.step" />
        <!-- Turn error (stopReason 'error') — surface the provider message + a one-click
             retry (re-run this turn) instead of a silent empty bubble. -->
        <div v-else-if="g.type === 'error'" class="merr">
          <Icon name="alert" class="merr-ic" />
          <div class="merr-main">
            <div class="merr-msg">{{ g.text }}</div>
            <button class="merr-retry" :title="t('sessions.message.retry')" @click="regen">
              <Icon name="refresh" style="width: 12px; height: 12px" />
              {{ t('sessions.message.retry') }}
            </button>
          </div>
        </div>
        <SessionGateCard v-else :block="g.gate" />
      </template>
      <!-- Action footer INSIDE the card (craft ResponseCard footer): HIDDEN while
           actively generating (the SessionProcessingIndicator below the turn is the cue
           then). Parked on a gate → static "Waiting…"; done → byline (left) + always-
           visible actions (right), a full-width bar at the card's bottom edge. -->
      <div v-if="!streamingActive" class="mmeta mmetarow" :class="{ footer: !streaming }">
        <span class="mmetatxt">
          <template v-if="streaming">
            <span class="strdot" />
            <span class="strshimmer">{{ t('sessions.message.waiting') }}</span>
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
    <SessionTurnFullscreen
      v-if="turnFullscreenOpen"
      :title="fullscreenTitle"
      :grouped="grouped"
      :streaming="streaming"
      :highlights-for-block="highlightsForBlock"
      @close="turnFullscreenOpen = false"
    />
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
} from '~/composables/useSessionsData'
import type { BlockHighlight } from './SessionTextBlock.vue'
import type { ActivityEntry } from './SessionTurnActivities.vue'
import type { PreviewRef } from '~/composables/usePreview'
import {
  finalResponseIndex,
  responseIndex,
  deriveTurnPhase,
  getPreviewText,
  blockRole,
} from '~/utils/session-turns'

const props = defineProps<{ message: SessionMessage; fallbackWhen: string; msgIndex: number }>()
const { t } = useI18n()
const settings = useSettingsStore()
const store = useSessionsStore()

// The latest TodoWrite step renders inline as a transcript step once the docked banner
// yields (all done / turn ended). `inlineTodoStep` is that block (or null while it's
// still in the banner) — matched by reference below so only it shows inline.
const { inlineTodoStep } = useSessionTodo(() => store.active)

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
export type Grouped =
  | { key: string; type: 'activities'; entries: ActivityEntry[]; preview: string }
  | { key: string; type: 'text'; text: string; blockIndex: number }
  | { key: string; type: 'todo'; step: StepBlock }
  | { key: string; type: 'error'; text: string }
  | { key: string; type: 'gate'; gate: AssistantBlock }

const blockKey = (b: AssistantBlock, bi: number): string =>
  'eid' in b && b.eid ? b.eid : `${b.kind}-${bi}`

// groupBlocks (craft TurnCard parity, ADR 0061): bucket the turn's blocks via
// blockRole — consecutive "activity" blocks (tool steps + thinking + intermediate
// commentary) collapse into one SessionTurnActivities section; the final response
// text, gates (plan/question/perm/steer), errors and the inline TodoWrite checklist
// render standalone in place. `key` is a STABLE per-group identity (engine eid where
// available, else kind+position) so a component is NOT destroyed+recreated when the
// grouping reshapes mid-stream (which would reset its collapsed state).
const grouped = computed<Grouped[]>(() => {
  if (props.message.role !== 'assistant') return []
  const blocks = props.message.blocks
  // While a tool-using turn still streams, a trailing text stays inside the activities
  // (it may be commentary before the next tool) — don't promote it to the response yet.
  const finalIdx = responseIndex(blocks, !!props.message.streaming)
  const phase = deriveTurnPhase(props.message)
  const out: Grouped[] = []
  let run: ActivityEntry[] = []
  let runBlocks: AssistantBlock[] = []
  let runKey = ''
  const flush = () => {
    if (!run.length) return
    out.push({
      key: `acts-${runKey}`,
      type: 'activities',
      entries: run,
      preview: getPreviewText(runBlocks, phase, (k, p) => t(k, p ?? {})),
    })
    run = []
    runBlocks = []
    runKey = ''
  }
  blocks.forEach((b, bi) => {
    // TodoWrite note steps carry the checklist for the docked SessionTodoPanel. Render
    // the LATEST one inline as its own step ONLY once the live banner has yielded (turn
    // ended / all items done) — never while the banner shows it, and never the older
    // intermediate snapshots. When skipped, don't flush so surrounding activities stay grouped.
    if (b.kind === 'step' && b.todos !== undefined) {
      if (b === inlineTodoStep.value) {
        flush()
        out.push({ key: blockKey(b, bi), type: 'todo', step: b })
      }
      return
    }
    // Collapsible activity = tool step + thinking + intermediate commentary text.
    if (blockRole(b, bi, finalIdx) === 'activity') {
      if (!run.length) runKey = blockKey(b, bi)
      if (b.kind === 'step') run.push({ key: blockKey(b, bi), kind: 'step', step: b })
      else if (b.kind === 'thinking')
        run.push({ key: blockKey(b, bi), kind: 'thinking', text: b.text })
      else if (b.kind === 'text') run.push({ key: `text-${bi}`, kind: 'text', text: b.text })
      runBlocks.push(b)
      return
    }
    flush()
    if (b.kind === 'error') out.push({ key: blockKey(b, bi), type: 'error', text: b.text })
    else if (b.kind === 'text')
      out.push({ key: `text-${bi}`, type: 'text', text: b.text, blockIndex: bi })
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

// Message actions (mock-backed via the sessions store). The transcript passes each
// item its absolute index in the active session's message list (row.i) so buttons
// act at the right point — avoids an O(msgs) indexOf per item that also depended on
// the whole msgs array (re-running on every streaming delta).
const { CIRCLED } = useSessionsData()
const { scrollToMessage } = useSessionScroll()
const msgIndex = computed(() => props.msgIndex)

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

// ── Action-footer visibility ─────────────────────────────────────────────────
// Actions (copy/quote/fork/regen…) are shown only once the turn is done: they aren't
// valid mid-stream, and the footer would collide with the working indicator. When
// done they're persistent (no hover needed) — see the `.footer` styles.
const showBottomActions = computed(() => !streaming.value)

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

// §8 — highlights for one text block, derived purely from state so regenerate/rewind
// and store.removeQuote re-render correctly (no stale local copy, automatic renumber).
//
// A follow-up with an explicit `blockIndex` targets only that block; one without (the
// selection-quote path always omits it) is offered to EVERY text block and painted by
// whichever block's RENDERED text actually contains the excerpt (locateMarks). We can't
// pre-resolve the block here by `b.text.includes(excerpt)`: `b.text` is raw markdown while
// the excerpt is the whitespace-normalized RENDERED selection, so any quote crossing inline
// formatting (**bold**, `code`, links) or a soft line break would never match → no
// highlight. locateMarks matches on rendered text per block and simply skips blocks that
// don't contain the excerpt, so deferring to it is both correct and simpler.
const highlightsForBlock = (blockIndex: number): BlockHighlight[] =>
  ownFollowups.value
    .filter((x) => x.fu.blockIndex == null || x.fu.blockIndex === blockIndex)
    .map((x) => ({ fu: x.fu, label: x.label }))

// Presentable message text for copy / fullscreen / edit. For an assistant turn this is
// ONLY the final response (the answer) — intermediate commentary lives in the collapsed
// activity section and must NOT leak into fullscreen/copy. Falls back to all text runs
// joined when the turn has no clean final response (e.g. it ended on a tool). User /
// system messages are their raw text.
const plainText = computed(() => {
  const m = props.message
  if (m.role !== 'assistant') return m.text
  const idx = finalResponseIndex(m.blocks)
  const resp = idx >= 0 ? m.blocks[idx] : undefined
  if (resp && resp.kind === 'text') return resp.text
  return m.blocks
    .filter((b): b is TextBlock => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n')
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

// Full screen → open the message body in the shared full-window PreviewModal
// (usePreview, the SAME instance mounted in SessionDetail) as rendered markdown:
// a read-only viewer with outline + scroll, the comfortable way to read a long
// reply. No-op on an empty body.
// Markdown images in a reply are workspace-relative (`![shot](tasks/…/x.png)`), the same
// base the transcript resolves them against. The modal renders the text through its OWN
// pipeline, so hand it the session's workspace root — without it every inline image
// resolves against the app:// origin and renders as a broken icon.
const { open: openPreview } = usePreview()
const filePreview = useFilePreview()
const openFullscreen = () => {
  const text = plainText.value
  if (!text.trim()) return
  const name = store.active?.title?.trim() || t('sessions.message.fullscreenName')
  void filePreview.root().then((root) => {
    const item: PreviewRef = { name, kind: 'markdown', text }
    if (root) item.workspaceRoot = root
    openPreview(item)
  })
}

// UI-3 — fullscreen the WHOLE turn (activities + gates + final response), rendered live
// via SessionTurnFullscreen (reuses `grouped` for realtime streaming). Distinct from
// openFullscreen above, which shows only the final response text in the PreviewModal.
const turnFullscreenOpen = ref(false)
const openTurnFullscreen = () => {
  turnFullscreenOpen.value = true
}
const fullscreenTitle = computed(
  () => store.active?.title?.trim() || t('sessions.message.fullscreenName'),
)
// Guard: if the turn is emptied out (rewind/fork/delete) while open, close the overlay so
// it never renders a stale/empty tree.
watch(
  () => grouped.value.length,
  (n) => {
    if (n === 0) turnFullscreenOpen.value = false
  },
)

// One action set, rendered twice (floating pill at the top + inline on the meta
// row at the bottom) so the actions are reachable without scrolling a long reply.
const msgActions = computed(() => [
  { icon: 'copy', title: t('sessions.message.copy'), run: copyText },
  // Response-only fullscreen (PreviewModal) — only earns a slot when there's prose to read.
  ...(plainText.value.trim()
    ? [{ icon: 'maximize', title: t('sessions.message.fullscreen'), run: openFullscreen }]
    : []),
  // Whole-turn fullscreen (activities + gates + response) — always shown for an assistant
  // turn, incl. tool-only turns that have no final response (AC3.9).
  { icon: 'layers', title: t('sessions.message.fullscreenTurn'), run: openTurnFullscreen },
  { icon: 'quote', title: t('sessions.message.quote'), run: quote },
  { icon: 'refresh', title: t('sessions.message.regen'), run: regen },
  { icon: 'settings', title: t('sessions.message.retryModel'), run: retry },
  { icon: 'rewind', title: t('sessions.message.rewind'), run: rewind },
  { icon: 'branch', title: t('sessions.message.branch'), run: branch },
  { icon: 'fork', title: t('sessions.message.forkShort'), run: fork },
])
</script>

<style scoped>
/* Slash-command invocation chip in the user bubble — compact `/name args` pill in
   place of the expanded body (which is still sent to the model). */
.ucmd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 9px;
  border-radius: 8px;
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
  color: var(--accent);
  font-family: var(--code);
  vertical-align: middle;
}
.ucmd-name {
  font-weight: 650;
}
.ucmd-args {
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Message actions live in a PERSISTENT footer row (byline + actions) for both the
   assistant turn card and the user bubble — no floating hover pill. */
.maw,
.urow {
  position: relative;
}
/* Bubble width: the prototype caps .mu at max-width:74%, but that % resolves against
   .urow — which shrinks to its widest child. For a short message the meta line
   ("04:02 PM · 3 tok") is wider than the text, so the bubble got capped to 74% of the
   TIMESTAMP width and even "review lại" wrapped. Let the bubble size to its own
   content instead; long messages are still capped by .urow's max-width:80% of the
   transcript. */
.mu {
  max-width: 100%;
  /* Break long unbreakable tokens (file:// paths, URLs, underscored filenames) so they
     wrap inside the bubble instead of spilling past its right edge. overflow-wrap is
     inherited, so this covers the plain-text + link segments SessionLinkedText renders
     directly into .mu. min-width:0 lets the flex bubble actually shrink to wrap. */
  min-width: 0;
  overflow-wrap: anywhere;
}
/* The action set sits inline on the footer row (assistant + user) — no floating pill
   chrome, pushed to the right next to the byline. PERSISTENT (opacity:1, overriding the
   prototype's hover-only fade) so the controls are discoverable without hovering. */
.hoveract.bottom {
  position: static;
  top: auto;
  right: auto;
  margin-left: auto;
  padding: 0;
  background: none;
  border: none;
  box-shadow: none;
  opacity: 1;
}
/* Meta row holds the byline (left) + inline action set (right). */
.mmetarow {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* Footer variant (turn done): a hairline top rule + breathing room separates the
   action row from the reply, matching craft's ResponseCard footer. */
/* Action footer. In a bubble it's a full-width bar flush to the card's bottom edge
   (negative margins cancel the card padding; the card's overflow:hidden clips it to the
   radius) with a hairline top divider — craft's ResponseCard footer. Without a bubble it
   degrades to a plain inset row. Actions stay persistent (see .maw .hoveract.bottom). */
.mmetarow.footer {
  margin-top: 2px;
  padding: 0 4px;
}
.abody.bubble .mmetarow.footer {
  margin: 0 -14px -11px;
  padding: 7px 12px;
  border-top: 1px solid var(--border);
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
/* Unified turn card (Settings → Sessions · Assistant bubble): wraps the collapsed
   activity section + the final response in one elevated, left-tailed card. */
.abody.bubble {
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: 16px;
  border-bottom-left-radius: 5px;
  padding: 11px 14px;
  /* Clip the full-bleed footer bar to the card's rounded corners. */
  overflow: hidden;
}
/* Byline dot — shown only when a turn is parked on a gate (next to "Waiting…"). */
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

/* Turn-error alert: danger-tinted box with the provider message + a retry button. */
.merr {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 4px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--dangerDim, rgba(239, 68, 68, 0.12));
  border: 1px solid var(--dangerBorder, rgba(239, 68, 68, 0.35));
}
.merr-ic {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--danger);
}
.merr-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
.merr-msg {
  color: var(--text);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.merr-retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 7px;
  background: transparent;
  border: 1px solid var(--dangerBorder, var(--border));
  color: var(--danger);
  cursor: pointer;
  font-size: 0.9231rem;
}
.merr-retry:hover {
  background: var(--dangerDim, var(--bgHover));
}
</style>
