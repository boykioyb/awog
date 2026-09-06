<template>
  <div class="procind" role="status" aria-live="polite">
    <span class="procspin">
      <Icon name="refresh" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </span>
    <span class="procwrap">
      <Transition name="pxfade" mode="out-in">
        <span :key="displayWord" class="procword">{{ displayWord }}</span>
      </Transition>
      <span v-if="elapsedSec >= 1" class="procelapsed">{{ elapsedLabel }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
// Session-level "working" indicator — port of craft's ProcessingIndicator
// (ChatDisplay.tsx:329-405). Shown below the in-flight turn while the model is
// generating: a cycling status word (a new random word every 10s, crossfaded) plus
// a live elapsed clock seeded from the turn's `startedAt`. When `statusMessage` is
// supplied (e.g. compaction) it overrides the cycling word and freezes it, matching
// craft. Colours go through the ui-next CSS theme tokens (var(--…)).
const props = defineProps<{ startedAt?: number; statusMessage?: string }>()
const { t } = useI18n()

// Curated subset of craft's PROCESSING_MESSAGE_KEYS (chat.processing.*) — the keys
// that carry naturally into Vietnamese. Same trailing key names as craft for
// traceability. Add words in i18n/locales/{en,vi}/sessions.json under sessions.processing.*.
const WORD_KEYS = [
  'sessions.processing.thinking',
  'sessions.processing.pondering',
  'sessions.processing.contemplating',
  'sessions.processing.reasoning',
  'sessions.processing.processing',
  'sessions.processing.computing',
  'sessions.processing.considering',
  'sessions.processing.reflecting',
  'sessions.processing.deliberating',
  'sessions.processing.ruminating',
  'sessions.processing.musing',
  'sessions.processing.workingOnIt',
  'sessions.processing.onIt',
  'sessions.processing.crunching',
  'sessions.processing.brewing',
  'sessions.processing.connectingDots',
  'sessions.processing.mullingItOver',
  'sessions.processing.deepInThought',
  'sessions.processing.hmm',
  'sessions.processing.letMeSee',
  'sessions.processing.oneMoment',
  'sessions.processing.holdOn',
  'sessions.processing.hangTight',
  'sessions.processing.gettingThere',
  'sessions.processing.almost',
  'sessions.processing.working',
  'sessions.processing.cooking',
  'sessions.processing.percolating',
  'sessions.processing.simmering',
] as const

// Pick a random index, optionally excluding the current one so the word always
// visibly changes on each cycle (craft does the same).
function randIndex(exclude = -1): number {
  if (WORD_KEYS.length <= 1) return 0
  let i = Math.floor(Math.random() * WORD_KEYS.length)
  while (i === exclude) i = Math.floor(Math.random() * WORD_KEYS.length)
  return i
}

const wordIndex = ref(randIndex())
const nowTick = ref(Date.now())

let elapsedTimer: ReturnType<typeof setInterval> | null = null
let cycleTimer: ReturnType<typeof setInterval> | null = null

function startCycle() {
  if (cycleTimer || props.statusMessage) return
  cycleTimer = setInterval(() => {
    wordIndex.value = randIndex(wordIndex.value)
  }, 10000)
}
function stopCycle() {
  if (cycleTimer) {
    clearInterval(cycleTimer)
    cycleTimer = null
  }
}

// Pin/unpin word cycling when an explicit status message comes and goes.
watch(
  () => props.statusMessage,
  (msg) => (msg ? stopCycle() : startCycle()),
)

onMounted(() => {
  nowTick.value = Date.now()
  elapsedTimer = setInterval(() => (nowTick.value = Date.now()), 1000)
  startCycle()
})
onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
  stopCycle()
})

const displayWord = computed(() =>
  props.statusMessage ? props.statusMessage : t(WORD_KEYS[wordIndex.value] as string),
)

const elapsedSec = computed(() => {
  if (props.startedAt == null) return 0
  return Math.max(0, Math.floor((nowTick.value - props.startedAt) / 1000))
})
// Craft formatting: "45s" under a minute, "1:02" for a minute or more.
const elapsedLabel = computed(() => {
  const s = elapsedSec.value
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
</script>

<style scoped>
.procind {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  margin-top: 2px;
  color: var(--textDim);
}
.procspin {
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
.procspin .icn {
  animation: procspin 0.9s linear infinite;
}
@keyframes procspin {
  to {
    transform: rotate(360deg);
  }
}
.procwrap {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
}
.procword {
  font-size: 1em;
}
.procelapsed {
  margin-left: 6px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

/* Crossfade on word change (mode="out-in": old fades out, new fades in). */
.pxfade-enter-active,
.pxfade-leave-active {
  transition: opacity 0.4s ease-in-out;
}
.pxfade-enter-from,
.pxfade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .procspin .icn {
    animation: none;
  }
  .pxfade-enter-active,
  .pxfade-leave-active {
    transition: none;
  }
}
</style>
