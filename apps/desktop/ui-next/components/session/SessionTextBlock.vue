<template>
  <!-- An assistant text block = an ordered mix of markdown HTML runs and mermaid fences.
       Each HTML run renders via SessionMarkdownHtml (imperative — owns quote highlight +
       copy buttons); each mermaid fence renders as a live <MermaidView> diagram (§3/§8).
       While the message is still streaming a mermaid fence is incomplete, so it shows as
       plain code until finalized (avoids flashing mermaid parse errors mid-stream). -->
  <div class="blk txt mdwrap" :class="{ 'tw-on': caret }">
    <template v-for="(seg, i) in segments" :key="i">
      <MermaidView v-if="seg.type === 'mermaid' && !streaming" :code="seg.code" />
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
import type { Followup } from '~/composables/useSessionsMock'

// A follow-up plus its index in `active.followups` (used for the circled label).
export type BlockHighlight = { fu: Followup; label: string }

const props = defineProps<{
  text: string
  highlights?: BlockHighlight[]
  streaming?: boolean
  // True only for the trailing block of a streaming reply → render a blinking
  // typewriter caret at the end of the text (the part currently being typed).
  caret?: boolean
}>()
const { renderMarkdown } = useMarkdown()

// While the trailing block streams, `text` mutates every typewriter frame (~16ms).
// Re-lexing the FULL markdown each frame is the main cause of choppy streaming, so coalesce
// parses to ~30fps with a trailing pass that always renders the settled text. Finalized
// blocks never change `text`, so the watch is idle and they parse exactly once.
const RENDER_THROTTLE = 33
const renderSrc = ref(props.text)
let lastRender = 0
let trailing: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.text,
  (txt) => {
    const wait = RENDER_THROTTLE - (performance.now() - lastRender)
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
// Sanitized markdown segments (html runs + mermaid code), in document order. While
// streaming, render granularly (one segment per block) so only the trailing, growing
// block re-parses/rebuilds each frame; a finalized block parses once as a merged run.
const segments = computed(() => renderMarkdown(renderSrc.value, props.streaming))

onBeforeUnmount(() => {
  if (trailing) clearTimeout(trailing)
})
</script>

<style scoped>
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
  border-radius: 8px;
  overflow-x: auto;
  font-family: var(--code);
  font-size: 0.92em;
  line-height: 1.5;
  white-space: pre;
}
</style>
