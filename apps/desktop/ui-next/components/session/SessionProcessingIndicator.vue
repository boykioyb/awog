<template>
  <div
    class="mt-0.5 flex items-center gap-2 px-3 py-1 text-muted-foreground"
    role="status"
    aria-live="polite"
  >
    <span class="grid size-3 flex-none place-items-center">
      <Icon name="refresh" class="size-3 animate-spin motion-reduce:animate-none" />
    </span>
    <span class="inline-flex min-h-4.5 items-center">
      <!-- Crossfade khi đổi chữ (mode="out-in": chữ cũ mờ đi, chữ mới hiện lên). -->
      <Transition
        mode="out-in"
        enter-active-class="transition-opacity duration-400 ease-in-out motion-reduce:transition-none"
        leave-active-class="transition-opacity duration-400 ease-in-out motion-reduce:transition-none"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <span :key="displayWord">{{ displayWord }}</span>
      </Transition>
      <span v-if="elapsedSec >= 1" class="ml-1.5 text-sm opacity-60 tabular-nums">
        {{ elapsedLabel }}
      </span>
    </span>
  </div>
</template>

<script setup lang="ts">
// Session-level "working" indicator — port of craft's ProcessingIndicator
// (ChatDisplay.tsx:329-405). Shown below the in-flight turn while the model is
// generating: a cycling status word (a new random word every 10s, crossfaded) plus
// a live elapsed clock seeded from the turn's `startedAt`. When `statusMessage` is
// supplied (e.g. compaction) it overrides the cycling word and freezes it, matching
// craft. Màu đi qua utility ngữ nghĩa của Tailwind.
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
