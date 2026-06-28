<template>
  <div class="msgswrap">
    <!-- Fold control: one click collapses every open step/cluster in the
         transcript, the next click expands them all back. Hidden until the
         session actually has messages to fold. -->
    <Transition name="fadepop">
      <button
        v-if="messages.length"
        class="foldbtn"
        :class="{ on: allExpanded }"
        :title="
          allExpanded
            ? t('sessions.transcript.fold.collapse')
            : t('sessions.transcript.fold.expand')
        "
        :aria-pressed="allExpanded"
        @click="toggleFold"
      >
        <Icon name="foldv" style="width: 13px; height: 13px" />
      </button>
    </Transition>
    <div ref="msgsEl" class="msgs" @scroll="onScroll">
      <SessionTranscriptSkeleton v-if="loading && !messages.length" />
      <SessionWelcome v-else-if="!messages.length" />
      <!-- No `appear`: opening a session shows its history instantly; only turns
           that arrive afterwards (user send / assistant reply) fade + rise in. -->
      <TransitionGroup v-else tag="div" name="mi" class="milist">
        <SessionMessageItem
          v-for="(m, i) in messages"
          :key="i"
          :message="m"
          :fallback-when="fallbackWhen"
        />
      </TransitionGroup>
    </div>
    <!-- Jump-to-top / jump-to-bottom: each shows only when there's somewhere to go
         in that direction (both hidden when the transcript doesn't overflow). -->
    <div class="scrolljump">
      <Transition name="fadepop">
        <button
          v-if="!atTop"
          class="sjbtn"
          :title="t('sessions.transcript.scrollTop')"
          @click="jumpTop"
        >
          <Icon name="chev" class="up" style="width: 16px; height: 16px" />
        </button>
      </Transition>
      <Transition name="fadepop">
        <button
          v-if="!atBottom"
          class="sjbtn"
          :title="t('sessions.transcript.scrollBottom')"
          @click="jumpBottom"
        >
          <Icon name="chev" style="width: 16px; height: 16px" />
        </button>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
// Transcript list (renderMsgs ~1490) — .msgs container of message items, or the
// welcome / empty state when the session has no messages yet. Auto-scrolls to the
// bottom on new content while the user is at the bottom ("stick to bottom"); if
// they scroll up to read history it leaves their position alone. Floating
// jump-to-top / jump-to-bottom controls overlay the bottom-right.
import type { SessionMessage } from '~/composables/useSessionsData'

const props = defineProps<{
  messages: SessionMessage[]
  fallbackWhen: string
  // True while the session's transcript is being fetched → show the skeleton
  // instead of the empty welcome (only matters when there are no messages yet).
  loading?: boolean
}>()
const { t } = useI18n()

// Fold-all toggle: alternates collapse/expand on every click. Steps & clusters are
// collapsed by default, so the button starts in "collapsed" — first click expands.
const { collapseAll, expandAll } = useStepFold()
const allExpanded = ref(false)
function toggleFold() {
  allExpanded.value = !allExpanded.value
  if (allExpanded.value) expandAll()
  else collapseAll()
}

const msgsEl = useTemplateRef<HTMLElement>('msgsEl')
const stick = ref(true)
let prevLen = 0

// Edge flags drive the jump buttons' visibility (hidden when already at that edge).
const atTop = ref(true)
const atBottom = ref(true)
function updateEdges() {
  const el = msgsEl.value
  if (!el) return
  atTop.value = el.scrollTop <= 4
  atBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
}

function scrollToBottom() {
  const el = msgsEl.value
  if (el) el.scrollTop = el.scrollHeight
}
function jumpTop() {
  msgsEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
function jumpBottom() {
  const el = msgsEl.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}
function onScroll() {
  const el = msgsEl.value
  if (el) stick.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
  updateEdges()
}

// Cheap reactive signal: message count + the last message's content size. Changes
// on a new message AND while the last reply streams (its text/blocks grow).
const scrollSig = computed(() => {
  const last = props.messages[props.messages.length - 1]
  let n = props.messages.length * 1_000_000
  if (last) {
    if (last.role === 'assistant') {
      n += last.blocks.reduce(
        (a, b) =>
          a + ('text' in b ? b.text.length : 0) + ('detail' in b ? (b.detail?.length ?? 0) : 0),
        0,
      )
    } else {
      n += last.text.length
    }
  }
  return n
})

watch(scrollSig, () => {
  // A brand-new message (length grew) snaps to the bottom even if the user had
  // scrolled up — they just sent / received a turn boundary.
  if (props.messages.length > prevLen) stick.value = true
  prevLen = props.messages.length
  if (stick.value) nextTick(scrollToBottom)
  nextTick(updateEdges)
})
// New array reference = session switch / transcript reload → jump to the latest.
watch(
  () => props.messages,
  () => {
    stick.value = true
    prevLen = props.messages.length
    nextTick(() => {
      scrollToBottom()
      updateEdges()
    })
  },
)
onMounted(() => {
  prevLen = props.messages.length
  nextTick(() => {
    scrollToBottom()
    updateEdges()
  })
})
</script>

<style scoped>
.msgswrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Floating collapse-all / expand-all toggle, top-right of the transcript. */
.foldbtn {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  color: var(--textDim);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  opacity: 0.72;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}
.foldbtn:hover {
  opacity: 1;
  background: var(--bgHover);
  border-color: var(--borderStrong);
  color: var(--text);
}
.foldbtn.on {
  color: var(--accent);
  border-color: var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  .foldbtn {
    transition: none;
  }
}
/* Floating jump controls, stacked at the transcript's bottom-right. */
.scrolljump {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sjbtn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bgEl);
  border: 1px solid var(--border);
  color: var(--textDim);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  cursor: pointer;
}
.sjbtn:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.sjbtn .up {
  transform: rotate(180deg);
}
.sjbtn {
  transition:
    border-color 0.12s ease,
    color 0.12s ease,
    transform 0.1s ease;
}
.sjbtn:active {
  transform: scale(0.92);
}

/* New-turn enter: a freshly appended message fades + rises into place. The inner
   wrapper carries the prototype's flex column rhythm (gap matches .msgs). */
.milist {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.mi-enter-active {
  transition:
    opacity 0.26s ease,
    transform 0.26s ease;
}
.mi-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

/* Floating controls (fold / jump): fade + slight scale on show/hide instead of a
   hard pop. Exit is quicker than enter, per the motion guidelines. */
.fadepop-enter-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}
.fadepop-leave-active {
  transition:
    opacity 0.1s ease-in,
    transform 0.1s ease-in;
}
.fadepop-enter-from,
.fadepop-leave-to {
  opacity: 0;
  transform: scale(0.85);
}

@media (prefers-reduced-motion: reduce) {
  .mi-enter-active,
  .fadepop-enter-active,
  .fadepop-leave-active,
  .sjbtn {
    transition: none;
  }
  .mi-enter-from,
  .fadepop-enter-from,
  .fadepop-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
