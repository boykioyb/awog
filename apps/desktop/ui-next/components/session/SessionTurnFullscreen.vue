<template>
  <!-- Teleport to body: mounted deep in the transcript subtree but rendered as a
       top-level full-window overlay (escapes any ancestor stacking context / overflow),
       mirroring PreviewModal. Click the scrim (@click.self) or Esc / the header × to close. -->
  <Teleport to="body">
    <div class="ovl on ftovl" @click.self="emit('close')">
      <div class="ftcard">
        <div class="fthead">
          <Icon name="layers" style="width: 13px; height: 13px" />
          <span class="ftname">{{ title }}</span>
          <span v-if="streaming" class="ftstream">
            <span class="ftdot" />
            {{ t('sessions.message.waiting') }}
          </span>
          <span style="flex: 1" />
          <button class="ftx" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <!-- Internal scroll region. Renders the SAME `.abody` tree as the transcript by
             reusing the parent's `grouped` computed (DRY — no grouping logic duplicated).
             Auto-scrolls to the bottom while streaming ONLY when the user is already at the
             bottom (3.c). -->
        <div ref="scrollEl" class="ftbody" @scroll="onScroll">
          <div class="abody">
            <template v-for="(g, gi) in grouped" :key="g.key">
              <SessionTurnActivities
                v-if="g.type === 'activities'"
                :entries="g.entries"
                :preview="g.preview"
              />
              <SessionTextBlock
                v-else-if="g.type === 'text'"
                :text="g.text"
                :highlights="highlightsForBlock(g.blockIndex)"
                :streaming="streaming"
                :caret="streaming && gi === grouped.length - 1"
                :bubble="false"
              />
              <SessionStepItem v-else-if="g.type === 'todo'" :block="g.step" />
              <div v-else-if="g.type === 'error'" class="merr">
                <Icon name="alert" class="merr-ic" />
                <div class="merr-msg">{{ g.text }}</div>
              </div>
              <!-- Gates render read-only here (3.d) — answer / approve in the transcript. -->
              <SessionGateCard v-else :block="g.gate" />
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Fullscreen overlay for a WHOLE assistant turn (UI-3): activities + intermediate blocks
// + gates + final response, rendered exactly like the transcript. Unlike the response-only
// PreviewModal (openFullscreen), this reuses the parent's reactive `grouped` so the overlay
// updates in realtime as the turn streams. Present-only: gates are read-only (3.d), activity
// collapse state stays as in the transcript (3.a — each SessionTurnActivities keeps its own).
import type { Grouped } from './SessionMessageItem.vue'
import type { BlockHighlight } from './SessionTextBlock.vue'

const props = defineProps<{
  title: string
  grouped: Grouped[]
  streaming: boolean
  highlightsForBlock: (blockIndex: number) => BlockHighlight[]
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

// Auto-scroll to the bottom on new stream deltas, but only when the user is already
// pinned to the bottom — if they scrolled up to read, stay put (3.c).
const scrollEl = useTemplateRef<HTMLElement>('scrollEl')
const atBottom = ref(true)
const onScroll = () => {
  const el = scrollEl.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

// Cheap trigger that still tracks realtime: the block count AND the text length of the
// last block. While the model appends deltas into the same trailing block the array
// length stays constant — watching length alone would regress realtime autoscroll (③),
// so we include the last block's text length as the streaming signal.
watch(
  () => {
    const g = props.grouped
    const last = g[g.length - 1]
    return [g.length, last && 'text' in last ? last.text.length : 0]
  },
  () => {
    if (!props.streaming || !atBottom.value) return
    nextTick(() => {
      const el = scrollEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Full-window overlay: scrim fills the window, card stretches edge-to-edge (PreviewModal
   parity). No heavy entrance animation — the shared `.ovl.on` handles a subtle fade only. */
.ftovl {
  align-items: stretch;
  padding: 0;
  cursor: default;
}
.ftcard {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bgEl);
  overflow: hidden;
}
.fthead {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.ftname {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ftstream {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--textDim);
  flex: 0 0 auto;
}
.ftdot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.5;
}
.ftx {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 6px;
  color: var(--textDim);
  cursor: pointer;
}
.ftx:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ftbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 26px 22px 60px;
}
/* Center the turn column and give it a comfortable reading width, like the transcript. */
.abody {
  display: flex;
  flex-direction: column;
  gap: 9px;
  width: 100%;
  max-width: 880px;
  margin: 0 auto;
}
/* Turn-error alert (read-only in the overlay — no retry button here). */
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
.merr-msg {
  color: var(--text);
  line-height: 1.5;
  overflow-wrap: anywhere;
  min-width: 0;
}
</style>
