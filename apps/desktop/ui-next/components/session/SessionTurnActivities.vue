<template>
  <div class="tacts" :class="{ col: collapsed }">
    <!-- Collapsed header (craft TurnCard parity): chevron + step-count badge + a live
         preview of what the turn is doing. Click toggles the activity body. -->
    <div class="tacth" @click="collapsed = !collapsed">
      <Icon name="chev" class="tchev" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="tbadge">{{ entries.length }}</span>
      <span class="tprev">{{ preview }}</span>
    </div>
    <Collapse :open="!collapsed">
      <div class="tbody">
        <template v-for="e in entries" :key="e.key">
          <SessionStepItem v-if="e.kind === 'step'" :block="e.step" />
          <!-- Extended-thinking: collapsible reasoning (global .think prototype styles),
               each block toggles independently by its stable key. -->
          <div
            v-else-if="e.kind === 'thinking'"
            class="blk think"
            :class="{ col: !thinkOpen.has(e.key) }"
          >
            <div class="thh" @click="toggleThink(e.key)">
              <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
              <Icon
                name="brain"
                class="thinkic"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              {{ t('sessions.thinking') }}
            </div>
            <div class="thb">{{ e.text }}</div>
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

defineProps<{ entries: ActivityEntry[]; preview: string; streaming?: boolean }>()
const { t } = useI18n()

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
/* Header is the clickable toggle; same hover feedback as step rows. */
.tacth {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: var(--r-sm);
  cursor: pointer;
  color: var(--textDim);
  transition: background 0.12s ease;
}
.tacth:hover {
  background: var(--bgHover);
}
.tchev {
  flex: 0 0 auto;
  color: var(--textFaint);
  transition: transform 0.15s ease;
}
.tacts.col .tchev {
  transform: rotate(-90deg);
}
/* Count badge: fixed 12px pill (font-size rule — badges don't scale with body text). */
.tbadge {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 0 5px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  font-size: 12px;
  font-family: var(--font-mono, ui-monospace, monospace);
  line-height: 1;
  color: var(--textDim);
}
/* Live preview text — one line, ellipsised (matches craft's cross-fading preview). */
.tprev {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tbody {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 2px;
  /* Indent the activity rows so they read as nested under the "N · preview" header
     (craft TurnCard tree indent). A hairline rail on the left groups the run as one
     unit; the ~7px left margin lines the rail up under the header chevron. */
  margin-left: 7px;
  padding-left: 13px;
  border-left: 1px solid var(--border);
}
/* Neutralize the prototype's `.think.col .thb{display:none}` inside the Collapse
   wrapper (the toggle here is thinkOpen, applied via .think.col directly, so the
   prototype rule still drives the per-block reveal — keep it). */
.thinkic {
  flex: 0 0 auto;
  color: var(--textDim);
}
/* Intermediate commentary: dimmed so it reads as activity noise, not the answer. */
.tinter {
  opacity: 0.75;
  padding: 2px 0;
}
@media (prefers-reduced-motion: reduce) {
  .tchev {
    transition: none;
  }
}
</style>
