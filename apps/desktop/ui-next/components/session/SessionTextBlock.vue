<template>
  <!-- An assistant text block = an ordered mix of markdown HTML runs and mermaid fences.
       Each HTML run renders via SessionMarkdownHtml (imperative — owns quote highlight +
       copy buttons); each mermaid fence renders as a live <MermaidView> diagram (§3/§8).
       Lazy render while streaming: a fence renders as a diagram as soon as its closing ```
       has arrived (seg.closed); only the trailing, still-open fence shows as plain code
       (avoids flashing mermaid parse errors on the half-typed source). Its code prop is
       byte-stable once closed, so MermaidView mounts once and never re-renders as later
       text keeps streaming — no per-frame diagram work. -->
  <div
    v-if="!buffering"
    ref="rootEl"
    class="blk txt mdwrap"
    :class="{ 'tw-on': caret, respcapped: bubble }"
  >
    <template v-for="(seg, i) in segments" :key="i">
      <MermaidView v-if="seg.type === 'mermaid' && (!streaming || seg.closed)" :code="seg.code" />
      <pre v-else-if="seg.type === 'mermaid'" class="mmdstream"><code>{{ seg.code }}</code></pre>
      <SessionMarkdownHtml v-else :html="seg.html" :highlights="highlights" />
    </template>
  </div>
</template>

<script setup lang="ts">
// Assistant text block: splits the rendered markdown into ordered segments (HTML runs +
// mermaid code) and composes them. The heavy lifting (sanitized markdown, quote-highlight,
// copy buttons) lives in SessionMarkdownHtml; live diagrams in MermaidView. This component
// owns the streaming throttle so a trailing block re-parses at ~30fps, not every frame.
import type { Followup } from '~/composables/useSessionsData'

// A follow-up plus its index in `active.followups` (used for the circled label).
export type BlockHighlight = { fu: Followup; label: string }

const props = defineProps<{
  text: string
  highlights?: BlockHighlight[]
  streaming?: boolean
  // True only for the trailing block of a streaming reply → render a blinking
  // typewriter caret at the end of the text (the part currently being typed).
  caret?: boolean
  // Mark this as the final response → cap its height and scroll inside the turn card
  // (the elevated bubble is provided by the parent .abody.bubble). Set only for the
  // response, so intermediate/subagent text isn't capped.
  bubble?: boolean
}>()
const { renderMarkdown } = useMarkdown()
const settings = useSettingsStore()

// Craft streaming (ADR 0061, Pha 4): with the typewriter OFF the store hands us the
// FULL accumulated text on every delta, so we re-parse at craft's 300ms cadence
// (chunky block reveal) and hold the first paint behind a buffer gate so half-formed
// text doesn't flash. Typewriter ON keeps AWOG's smooth char-by-char reveal (~30fps
// re-parse, no buffer). Only the trailing streaming block is affected; finalized and
// intermediate blocks parse exactly once.
const craftStream = computed(() => !!props.streaming && !settings.sessions.typewriter)

// While the trailing block streams, `text` mutates on every delta. Re-lexing the FULL
// markdown each frame is the main cause of choppy streaming, so coalesce parses with a
// trailing pass that always renders the settled text: ~30fps for the typewriter,
// craft's 300ms cadence otherwise.
const throttleMs = () => (craftStream.value ? 300 : 33)
const renderSrc = ref(props.text)
const rootEl = useTemplateRef<HTMLElement>('rootEl')

// ── Streaming-render diagnostics (utils/stream-diag) ─────────────────────────────
// Records renderSrc-vs-props.text at each lifecycle transition so an intermittent
// "reply truncated until restart" can be traced from `__awogStreamDiag.dump()` in the
// DevTools console — no live debugger needed. A STALL row = this block rendered fewer
// chars than the SETTLED text at a point where it should already be complete (the loss
// signature). Discrete events only (never per-delta), and the whole tap is gated on
// `DIAG_ON` (= `import.meta.dev`) so it compiles out of a production build.
const diagKey = nextDiagId()
const diagRole = () => `role=${props.bubble ? 'resp' : props.caret ? 'tail' : 'inter'}`
function diag(ev: string, note?: string) {
  if (!DIAG_ON) return
  streamDiag({
    src: 'block',
    key: diagKey,
    ev,
    textLen: props.text.length,
    renderLen: renderSrc.value.length,
    streaming: !!props.streaming,
    connected: !!rootEl.value?.isConnected,
    note: note ?? diagRole(),
  })
}
function checkStall(where: string) {
  if (!DIAG_ON) return
  if (!props.streaming && renderSrc.value.length < props.text.length)
    diag('STALL', `at=${where} ${diagRole()}`)
}
let lastRender = 0
let trailing: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.text,
  (txt) => {
    const wait = throttleMs() - (performance.now() - lastRender)
    if (trailing) {
      clearTimeout(trailing)
      trailing = null
    }
    if (wait <= 0) {
      lastRender = performance.now()
      renderSrc.value = txt
    } else {
      trailing = setTimeout(() => {
        lastRender = performance.now()
        trailing = null
        renderSrc.value = props.text
      }, wait)
    }
  },
)
// Stream-end flush: when the trailing block stops streaming, render the SETTLED text
// synchronously instead of waiting on the throttle's trailing timer. That timer is the
// only thing that would apply the final `props.text`, and it can be cleared on unmount or
// fire after the block has been parked in <KeepAlive>'s detached store (pages/sessions
// caches 5 SessionDetail instances) — leaving `renderSrc` pinned to a mid-stream value.
// Because the instance is cached, navigating within the app never remounts it, so the
// reply stays truncated until the app is restarted (a fresh mount re-seeds `renderSrc`
// from the full text). Flushing here makes the final text authoritative the moment
// streaming ends. `props.text` is already the settled full text by then (the store snaps
// it before flipping `streaming` off).
watch(
  () => props.streaming,
  (on, was) => {
    if (!was || on) return
    const before = renderSrc.value.length
    if (trailing) {
      clearTimeout(trailing)
      trailing = null
    }
    renderSrc.value = props.text
    diag('stream-end', `${diagRole()} before=${before}`)
  },
)
// Sanitized markdown segments (html runs + mermaid code), in document order. While
// streaming, render granularly (one segment per block) so only the trailing, growing
// block re-parses/rebuilds each frame; a finalized block parses once as a merged run.
const segments = computed(() => renderMarkdown(renderSrc.value, props.streaming))

// Keep a capped, streaming response pinned to the bottom as it grows (the inner
// equivalent of the transcript's stick-to-bottom) — UNLESS the user has scrolled up
// within the bubble to read, so we never yank them back.
watch(renderSrc, () => {
  const el = rootEl.value
  if (!el || !props.bubble || !props.streaming) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (nearBottom)
    nextTick(() => rootEl.value && (rootEl.value.scrollTop = rootEl.value.scrollHeight))
})

// Buffer gate (craft shouldShowContent / BUFFER_CONFIG): hold the streaming response
// until it has enough to show — min 500ms AND (≥6 words OR a structural marker: code
// fence / list / heading / trailing '?'), or 2.5s elapsed regardless. Craft-stream only;
// while buffered the block renders nothing and the SessionProcessingIndicator below the
// turn carries the "working" cue.
const BUF_MIN_MS = 500
const BUF_MAX_MS = 2500
const BUF_MIN_WORDS = 6
const streamStart = ref(0)
const bufTick = ref(0)
let bufTimer: ReturnType<typeof setInterval> | null = null
function stopBufTimer() {
  if (bufTimer) {
    clearInterval(bufTimer)
    bufTimer = null
  }
}
watch(
  craftStream,
  (on) => {
    if (on) {
      streamStart.value = performance.now()
      bufTick.value = streamStart.value
      stopBufTimer()
      bufTimer = setInterval(() => (bufTick.value = performance.now()), 100)
    } else {
      stopBufTimer()
    }
  },
  { immediate: true },
)
const buffering = computed(() => {
  if (!craftStream.value) return false
  const txt = props.text
  if (!txt.trim()) return true
  const elapsed = bufTick.value - streamStart.value
  if (elapsed >= BUF_MAX_MS) return false
  if (elapsed < BUF_MIN_MS) return true
  const words = txt.trim().split(/\s+/).length
  const structural = /```|(^|\n)\s*[-*]\s|(^|\n)\s*\d+\.\s|(^|\n)#{1,6}\s|\?\s*$/.test(txt)
  return !(words >= BUF_MIN_WORDS || structural)
})

// Diag lifecycle taps: mount seeds the baseline; (de)activate captures the <KeepAlive>
// park/restore window (the prime suspect — a block parked mid-stream stayed truncated);
// unmount flags a block that dies while still behind the settled text.
if (DIAG_ON) {
  onMounted(() => diag('mount'))
  onActivated(() => {
    diag('activated')
    checkStall('activated')
  })
  onDeactivated(() => {
    diag('deactivated')
    checkStall('deactivated')
  })
}
onBeforeUnmount(() => {
  checkStall('unmount')
  diag('unmount')
  if (trailing) clearTimeout(trailing)
  stopBufTimer()
})
</script>

<style scoped>
/* Cap a long response and scroll it inside the bubble (craft MAX_HEIGHT 540) so a huge
   answer doesn't dominate the transcript. Applied whether streaming or done: while
   streaming the inner scroll is auto-pinned to the bottom (see the renderSrc watch), so
   there's no jarring shrink-to-cap on completion. Full text stays a click away via the
   fullscreen action. */
.respcapped {
  max-height: 540px;
  overflow-y: auto;
}
/* Gap between consecutive segments (a diagram + a prose run, etc.). Within a run, the
   prose styles in SessionMarkdownHtml own the internal spacing. */
.mdwrap > * + * {
  margin-top: 10px;
}
/* Two finishing touches while a reply is being typed (.tw-on — set only on the
   trailing block):
   1) FADE-IN — a soft mask at the bottom edge so freshly-revealed text emerges
      gradually instead of snapping in. Dropped when streaming ends (.tw-on gone).
   2) BLOCK CARET — a blinking accent block pinned inline to the end of the last
      rendered markdown element, like a terminal cursor. */
.tw-on {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 0.95em), rgba(0, 0, 0, 0.28));
  mask-image: linear-gradient(to bottom, #000 calc(100% - 0.95em), rgba(0, 0, 0, 0.28));
}
.tw-on :deep(.mdinline:last-child > :last-child)::after {
  content: '';
  display: inline-block;
  width: 0.5em;
  height: 1.1em;
  margin-left: 2px;
  /* design-token-ok: streaming caret — same reason as .cursor in prototype.css. */
  border-radius: 2px;
  background: var(--accent);
  vertical-align: -0.2em;
  animation: tw-caret 1.05s infinite;
}
/* Hard on/off blink (terminal-style), not a smooth pulse. */
@keyframes tw-caret {
  0%,
  50% {
    opacity: 0.9;
  }
  50.01%,
  100% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tw-on {
    -webkit-mask-image: none;
    mask-image: none;
  }
  .tw-on :deep(.mdinline:last-child > :last-child)::after {
    animation: none;
    opacity: 0.65;
  }
}
/* Streaming placeholder for an as-yet-incomplete mermaid fence — a plain code card. */
.mmdstream {
  margin: 0;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow-x: auto;
  /* mono-ok: raw mermaid source while the fence is still streaming */
  font-family: var(--code);
  font-size: 0.92em;
  line-height: 1.5;
  white-space: pre;
}
</style>
