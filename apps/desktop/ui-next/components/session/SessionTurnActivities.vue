<template>
  <div class="tacts" :class="{ col: collapsed }">
    <!-- Group header (proto ProtoStepGroup parity): chevron + count pill +
         "Steps completed" + failed/running counts + one-line live preview of
         what the turn is doing. Click toggles the activity body. -->
    <button type="button" class="tacth" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
      <Icon
        name="chev"
        class="tchev"
        :class="{ off: collapsed }"
        style="width: var(--icon-sm); height: var(--icon-sm)"
      />
      <span class="tbadge">{{ entries.length }}</span>
      <span class="tlbl">{{ t('sessions.turn.stepsCompleted') }}</span>
      <span v-if="failedCount > 0" class="tfail">
        {{ t('sessions.turn.errorCount', { count: failedCount }) }}
      </span>
      <span v-if="runningCount > 0" class="trun">
        <span class="trunspin" />
        {{ t('sessions.bg.summary.running', { n: runningCount }) }}
      </span>
      <span v-if="!isFallbackPreview" class="tprev">{{ preview }}</span>
    </button>
    <Collapse :open="!collapsed">
      <!-- Body: tree indent — a left hairline rail groups the run as one unit. -->
      <div class="tbody">
        <template v-for="e in entries" :key="e.key">
          <SessionStepItem v-if="e.kind === 'step'" :block="e.step" />
          <!-- Extended-thinking: collapsible reasoning, italic muted body —
               each block toggles independently by its stable key. -->
          <div
            v-else-if="e.kind === 'thinking'"
            class="tkblk"
            :class="{ col: !thinkOpen.has(e.key) }"
          >
            <button
              type="button"
              class="tkh"
              :aria-expanded="thinkOpen.has(e.key)"
              @click="toggleThink(e.key)"
            >
              <Icon
                name="chev"
                class="tkchev"
                :class="{ off: !thinkOpen.has(e.key) }"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
              <Icon
                name="brain"
                class="thinkic"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              {{ t('sessions.thinking') }}
            </button>
            <div v-if="thinkOpen.has(e.key)" class="tkb">{{ e.text }}</div>
          </div>
          <!-- Intermediate commentary (text the model wrote before a tool). Dimmed so it
               reads as an activity, not the final answer. `streaming` is threaded through
               so the stream-end flush fires here too: without it these blocks keep
               props.streaming=false, the flush watch never runs, and a run whose renderSrc
               was pinned mid-stream stays truncated until the app restarts (same defect the
               response block's flush fixes). -->
          <div v-else class="tinter">
            <SessionTextBlock :text="e.text" :streaming="streaming" />
          </div>
        </template>
      </div>
    </Collapse>
  </div>
</template>

<script setup lang="ts">
// The collapsible "N steps · <preview>" activity section of an assistant turn
// (ADR 0061, Pha 3). Generalises the old SessionCluster: instead of only plain tool
// steps, it collapses tool steps + extended-thinking + intermediate commentary text
// into one unit, matching craft's TurnCard body. Collapsed by default (AWOG steps
// are closed by default) and follows the transcript-wide fold-all broadcast.
import type { StepBlock } from '~/composables/useSessionsData'

// A pre-narrowed render entry so the template never narrows a union via property
// access (vue-tsc friendly). Built by SessionMessageItem's grouping.
export type ActivityEntry =
  | { key: string; kind: 'step'; step: StepBlock }
  | { key: string; kind: 'thinking'; text: string }
  | { key: string; kind: 'text'; text: string }

const props = defineProps<{ entries: ActivityEntry[]; preview: string; streaming?: boolean }>()
const { t } = useI18n()

// Header counts (proto ProtoStepGroup parity): failed tint destructive, live
// running count gets a spinner.
const failedCount = computed(
  () => props.entries.filter((e) => e.kind === 'step' && e.step.status === 'error').length,
)
const runningCount = computed(
  () => props.entries.filter((e) => e.kind === 'step' && e.step.status === 'running').length,
)

// When the turn settles, getPreviewText falls back to the label the header
// already renders ("Steps completed" + optional error suffix — the latter is
// also shown by .tfail). Printing it again in .tprev reads as a duplicated
// label, so hide the preview whenever it IS that fallback.
const isFallbackPreview = computed(() =>
  props.preview.startsWith(t('sessions.turn.stepsCompleted')),
)

// Collapsed-by-default: header click toggles the body (.tacts.col hides .tbody).
const collapsed = ref(true)

// Follow the transcript-wide collapse-all / expand-all broadcast (manual clicks
// still toggle locally until the next broadcast). Mirrors SessionStepItem's fold wiring.
const fold = useStepFold()
watch(
  () => fold.signal.seq,
  () => {
    collapsed.value = fold.signal.mode !== 'expand'
  },
)

// Per-thinking-block expansion, keyed by the entry's stable key so multiple thinking
// blocks toggle independently and keep state across streaming re-groups.
const thinkOpen = reactive(new Set<string>())
function toggleThink(key: string) {
  if (thinkOpen.has(key)) thinkOpen.delete(key)
  else thinkOpen.add(key)
}
</script>

<style scoped>
/* Flat section (no grey fill) — the hairline + indent read the run as one unit,
   consistent with the flat activity list. */
.tacts {
  background: transparent;
}
/* Header is a real <button> (proto parity): same hover-wash row shape as the
   step rows, so the whole group reads as one control. */
.tacth {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: left;
  color: var(--muted-foreground);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
.tacth:hover {
  background: var(--accent-wash);
}
.tchev {
  flex: 0 0 auto;
  color: rgb(from var(--muted-foreground) r g b / 60%);
  transition: transform 0.15s ease;
}
.tchev.off {
  transform: rotate(-90deg);
}
/* Count pill — proto `h-4 min-w-[18px] rounded border font-mono text-[11px]`. */
.tbadge {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 0 4px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  font-family: var(--code); /* mono-ok: numeric counter */
  font-size: 11px;
  line-height: 12px;
  color: var(--muted-foreground);
}
/* Label + counters keep natural width — never shrink/wrap. `.tprev` (flex:1,
   min-width:0) is the only piece allowed to ellipsize, so a long unbreakable
   preview (a one-line shell command) can't squeeze "N bước" into a word column. */
.tlbl {
  flex: 0 0 auto;
  white-space: nowrap;
}
.tfail {
  flex: 0 0 auto;
  white-space: nowrap;
  color: var(--destructive);
}
/* Live running count — primary text + a thin arc ring (never an animated glyph). */
.trun {
  flex: 0 0 auto;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--primary);
}
.trunspin {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1.5px solid transparent;
  border-top-color: var(--primary);
  animation: trun-rot 0.8s linear infinite;
}
@keyframes trun-rot {
  to {
    transform: rotate(360deg);
  }
}
/* Live preview text — one line, ellipsised, half-strength (craft's fading
   preview). */
.tprev {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
  color: rgb(from var(--muted-foreground) r g b / 60%);
}
.tbody {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  /* Indent the activity rows so they read as nested under the "N · preview" header
     (craft TurnCard tree indent). A hairline rail on the left groups the run as one
     unit; the ~11px left margin lines the rail up under the header chevron. */
  margin-left: 11px;
  padding-left: 12px;
  border-left: 1px solid var(--border);
}
/* Extended-thinking block — proto idiom: the header is a plain row like a step
   (chevron + glyph + italic label); the RAIL belongs to the expanded body only,
   indented under the icon column (proto `ml-6 border-l-2 pl-2.5`). Scoped `.tk*`
   replaces the shared global .think/.thh/.thb so siblings keep their styles. */
.tkh {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-style: italic;
  text-align: left;
  color: var(--muted-foreground);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
.tkh:hover {
  background: var(--accent-wash);
}
.tkchev {
  flex: 0 0 auto;
  color: rgb(from var(--muted-foreground) r g b / 50%);
  transition: transform 0.15s ease;
}
.tkchev.off {
  transform: rotate(-90deg);
}
.thinkic {
  flex: 0 0 auto;
  color: var(--muted-foreground);
}
.tkb {
  margin: 2px 0 4px 24px;
  border-left: 2px solid var(--border);
  padding-left: 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  font-style: italic;
  color: var(--muted-foreground);
  white-space: pre-wrap;
}
/* Intermediate commentary: dimmed so it reads as activity noise, not the answer.
   Same inset as a step row (proto `px-1.5 py-1`) so the text lines up with the
   tool names above/below it. */
.tinter {
  opacity: 0.75;
  padding: 4px 6px;
}
@media (prefers-reduced-motion: reduce) {
  .tacth,
  .tchev,
  .tkh,
  .tkchev {
    transition: none;
  }
  .trunspin {
    animation: none;
  }
}
</style>
