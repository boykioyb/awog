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
        <Icon name="foldv" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </Transition>
    <!-- Chapter menu (#24): only once the model marked at least two phases — a
         table of contents with one entry is noise, not navigation. -->
    <Transition name="fadepop">
      <SessionChapterNav v-if="chapters.length > 1" :chapters="chapters" />
    </Transition>
    <div ref="msgsEl" class="msgs" @scroll="onScroll">
      <SessionTranscriptSkeleton v-if="loading && !messages.length" />
      <SessionWelcome v-else-if="!messages.length" />
      <template v-else>
        <!-- Centered message column (ProtoTranscript: mx-auto max-w-[860px] px-5
             py-4 gap-5). `.msgs` stays the scrollport with the shared --padX
             gutter; the column caps at 860px. All windowing logic is unchanged —
             same sentinel, same TransitionGroup, same keys. -->
        <div class="msgcol">
          <!-- Only the most recent turns mount on open — a long session's history is
               heavy to render (markdown + highlight + mermaid per message), so mounting
               all of it made switching sessions janky. Older turns reveal on demand as
               the user scrolls up (auto sentinel), or all at once via jump-to-top. -->
          <LoadMoreSentinel
            v-if="hiddenCount > 0"
            class="loadolder"
            :remaining="hiddenCount"
            auto
            @load="loadOlder"
          />
          <!-- No `appear`: opening a session shows its history instantly; only turns
               that arrive afterwards (user send / assistant reply) fade + rise in. -->
          <TransitionGroup tag="div" name="mi" class="milist">
            <SessionMessageItem
              v-for="row in visible"
              :key="row.i"
              :message="row.m"
              :msg-index="row.i"
              :fallback-when="fallbackWhen"
              :readonly="readonly"
            />
          </TransitionGroup>
          <!-- Session-level "working" indicator (craft ProcessingIndicator parity):
               cycling status word + elapsed, shown below the in-flight turn while the
               model is actively generating (hidden when parked on a question/permission
               gate — SessionMessageItem shows "Waiting…" for that). -->
          <SessionProcessingIndicator
            v-if="working"
            :started-at="workingStartedAt"
            class="msgind"
          />
        </div>
      </template>
    </div>
    <!-- Nhảy giữa các câu hỏi của user: ↑ câu trước · vị trí n/N · ↓ câu sau. Đứng
         riêng, cao hơn cụm lên-đầu/xuống-cuối một khoảng cố định, để không bị đẩy
         lên xuống khi hai nút kia hiện/ẩn theo mép cuộn. -->
    <Transition name="fadepop">
      <div
        v-if="userIdx.length > 1"
        class="qnav"
        role="group"
        :aria-label="t('sessions.transcript.qnav.label')"
      >
        <button
          class="qbtn"
          type="button"
          :disabled="prevQ === null"
          :title="t('sessions.transcript.qnav.prev')"
          :aria-label="t('sessions.transcript.qnav.prev')"
          @click="jumpQuestion(-1)"
        >
          <ArrowUp :size="14" />
        </button>
        <span
          class="qpos"
          :title="t('sessions.transcript.qnav.pos', { n: qPos || '–', total: userIdx.length })"
        >
          {{ qPos || '–' }}/{{ userIdx.length }}
        </span>
        <button
          class="qbtn"
          type="button"
          :disabled="nextQ === null"
          :title="t('sessions.transcript.qnav.next')"
          :aria-label="t('sessions.transcript.qnav.next')"
          @click="jumpQuestion(1)"
        >
          <ArrowDown :size="14" />
        </button>
      </div>
    </Transition>
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
          <Icon name="chev" class="up" style="width: var(--icon-md); height: var(--icon-md)" />
        </button>
      </Transition>
      <Transition name="fadepop">
        <button
          v-if="!atBottom"
          class="sjbtn"
          :title="t('sessions.transcript.scrollBottom')"
          @click="jumpBottom"
        >
          <Icon name="chev" style="width: var(--icon-md); height: var(--icon-md)" />
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
import { ArrowDown, ArrowUp } from 'lucide-vue-next'
import { questionAnswered, type SessionMessage } from '~/composables/useSessionsData'
import type { ChapterEntry } from './SessionChapterNav.vue'

const props = defineProps<{
  messages: SessionMessage[]
  fallbackWhen: string
  // True while the session's transcript is being fetched → show the skeleton
  // instead of the empty welcome (only matters when there are no messages yet).
  loading?: boolean
  // Hold the reader's position while a new turn arrives instead of snapping to the
  // bottom. Set while the find bar is open (searching mid-run must not yank the
  // viewport away from the match the user is looking at).
  suppressAutoScroll?: boolean
  // Bề mặt chỉ-đọc (board thread render comment thành message) — forward xuống
  // SessionMessageItem: giấu SessionMsgActions vì chúng tác động lên transcript
  // của phiên trong scope, không phải các message được truyền vào.
  readonly?: boolean
}>()
const { t } = useI18n()

// ── "Working" state for the session-level ProcessingIndicator ──
// Derived from the last assistant message (mirrors SessionMessageItem's byline logic,
// which reads the message's own blocks rather than the laggy session status). The
// indicator shows only while the model is actively generating; when the turn is parked
// on an unanswered question or a pending permission the byline shows "Waiting…" instead.
const lastAssistant = computed(() => {
  const m = props.messages[props.messages.length - 1]
  return m && m.role === 'assistant' ? m : null
})
const parked = computed(() => {
  const m = lastAssistant.value
  if (!m) return false
  return m.blocks.some(
    (b) =>
      (b.kind === 'question' && !questionAnswered(b)) ||
      (b.kind === 'perm' && b.status === 'pending'),
  )
})
const working = computed(() => !!lastAssistant.value?.streaming && !parked.value)
const workingStartedAt = computed(() => lastAssistant.value?.startedAt)

// ── Chapters (#24) ──
// Every chapter block in the transcript, tagged with the ABSOLUTE index of the
// message it sits in — that index is what the jump contract takes. Derived from the
// same `messages` the transcript renders, so a chapter is listed whether or not its
// turn is currently inside the render window.
const chapters = computed<ChapterEntry[]>(() => {
  const out: ChapterEntry[] = []
  props.messages.forEach((m, i) => {
    if (m.role !== 'assistant') return
    for (const b of m.blocks) if (b.kind === 'chapter') out.push({ title: b.title, msgIndex: i })
  })
  return out
})

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

// ── Render window (long-session perf) ──
// Mount only the most recent turns on open; a "turn" begins at each user message.
// `windowStart` is the ABSOLUTE index into `messages` where rendering begins — kept
// stable across streaming appends (recomputed only on a new/shrunk transcript) so a
// reply arriving never slides older turns off the top under the reader's cursor.
const INITIAL_TURNS = 5
const STEP_TURNS = 5
const windowStart = ref(0)

// Indices of user messages (turn boundaries) with index < `upto`.
function userTurnIndices(upto: number): number[] {
  const out: number[] = []
  const end = Math.min(upto, props.messages.length)
  for (let i = 0; i < end; i++) if (props.messages[i]?.role === 'user') out.push(i)
  return out
}
// Start index that shows the last `turns` turns (0 = show all when fewer exist).
function startForLastTurns(turns: number): number {
  const idx = userTurnIndices(props.messages.length)
  return idx.length <= turns ? 0 : (idx[idx.length - turns] ?? 0)
}

// Older messages hidden above the window (drives the load-older sentinel + jump-top).
const hiddenCount = computed(() => Math.min(windowStart.value, props.messages.length))
// The rendered slice, each tagged with its absolute index so keys stay stable when
// the window grows (existing items keep their key → no re-mount, only prepend).
const visible = computed(() => {
  const start = hiddenCount.value
  return props.messages.slice(start).map((m, k) => ({ m, i: start + k }))
})

// Reveal STEP_TURNS more older turns, anchoring the viewport so the content the user
// is reading stays put (prepended turns push it down; add the height delta back).
async function loadOlder() {
  const el = msgsEl.value
  const prevH = el?.scrollHeight ?? 0
  const prevTop = el?.scrollTop ?? 0
  const before = userTurnIndices(windowStart.value)
  windowStart.value = before.length <= STEP_TURNS ? 0 : (before[before.length - STEP_TURNS] ?? 0)
  await nextTick()
  if (el) el.scrollTop = prevTop + (el.scrollHeight - prevH)
}

// Edge flags drive the jump buttons' visibility (hidden when already at that edge).
const atTop = ref(true)
const atBottom = ref(true)
function updateEdges() {
  const el = msgsEl.value
  if (!el) return
  // While older turns are still windowed out, keep "jump to top" available (the
  // rendered top isn't the real top) → clicking it reveals all then scrolls up.
  atTop.value = el.scrollTop <= 4 && hiddenCount.value === 0
  atBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
  measureQuestions()
}

// ── Nhảy giữa các câu hỏi của user ──
// "Câu hiện tại" = câu hỏi cuối cùng có mép trên đã đi qua mép trên khung đọc (cộng
// một lề nhỏ) — tức là câu đang đọc câu trả lời của nó. ↑ về câu có mép trên NẰM
// TRÊN khung (nên lần bấm đầu khi đang giữa câu trả lời là về đầu chính câu đó, như
// mọi trình chat), ↓ tới câu có mép trên NẰM DƯỚI.
const Q_EDGE = 24
const userIdx = computed(() => {
  const out: number[] = []
  props.messages.forEach((m, i) => {
    if (m.role === 'user') out.push(i)
  })
  return out
})
const curQ = ref<number | null>(null)
const prevQ = ref<number | null>(null)
const nextQ = ref<number | null>(null)
// Vị trí 1-based của câu hiện tại trong danh sách câu hỏi; 0 = đang ở trên câu đầu.
const qPos = computed(() => (curQ.value === null ? 0 : userIdx.value.indexOf(curQ.value) + 1))

function measureQuestions(): void {
  const el = msgsEl.value
  if (!el) return
  const viewTop = el.getBoundingClientRect().top
  // Câu hỏi bị cửa sổ render cắt khỏi DOM thì chắc chắn nằm TRÊN khung.
  let cur: number | null = null
  let prev: number | null = null
  let next: number | null = null
  for (const i of userIdx.value) {
    if (i < hiddenCount.value) {
      cur = i
      prev = i
    }
  }
  // Một lần nhảy đặt câu hỏi ở mép trên + 12px ⇒ vùng [0, Q_EDGE] là "đang đứng ở câu
  // này": không tính là câu trước cũng không là câu sau, nếu không bấm ↓ lần nữa sẽ
  // nhảy lại đúng câu đang đứng.
  for (const row of el.querySelectorAll<HTMLElement>('.urow[data-mi]')) {
    const i = Number(row.dataset.mi)
    const top = row.getBoundingClientRect().top - viewTop
    // Ở đáy thì câu cuối không lên được tới mép trên — vẫn coi là "đang ở" nếu nó
    // đã hiện trong khung.
    if (top <= Q_EDGE || (atBottom.value && top < el.clientHeight)) cur = i
    if (top < 0) prev = i
    else if (top > Q_EDGE && next === null) next = i
  }
  curQ.value = cur
  prevQ.value = prev
  // Đã chạm đáy thì câu "sau" dù còn nằm dưới mép trên cũng không cuộn tới được nữa.
  nextQ.value = atBottom.value ? null : next
}

// Trong lúc cuộn mượt đang chạy, đo lại vị trí vẫn thấy câu vừa nhắm ở dưới mép ⇒ bấm
// liên tiếp sẽ nhắm lại đúng câu đó. Nên trong cửa sổ này, bước tiếp theo tính từ
// câu vừa nhắm chứ không từ hình học.
const JUMP_SETTLE_MS = 700
let lastJump: { target: number; at: number } | null = null

async function jumpQuestion(dir: -1 | 1): Promise<void> {
  const list = userIdx.value
  let target: number | null
  if (lastJump && Date.now() - lastJump.at < JUMP_SETTLE_MS) {
    const k = list.indexOf(lastJump.target) + dir
    target = k >= 0 && k < list.length ? (list[k] ?? null) : null
  } else {
    target = dir < 0 ? prevQ.value : nextQ.value
  }
  if (target === null) return
  lastJump = { target, at: Date.now() }
  await revealMessage(target)
  const el = msgsEl.value
  const row = el?.querySelector<HTMLElement>(`.urow[data-mi="${target}"]`)
  if (!el || !row) return
  const delta = row.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
  el.scrollTo({ top: el.scrollTop + delta, behavior: 'smooth' })
}

// Start of the turn containing `i` = the largest user-message index ≤ i (0 when the
// message sits before the first user turn).
function turnStartFor(i: number): number {
  const idx = userTurnIndices(i + 1)
  return idx[idx.length - 1] ?? 0
}

// Grow the window until message `i` is mounted, for a deliberate jump (bookmark,
// find, follow-up anchor) — see useSessionScroll / ADR 0074 §Q2. Opens exactly to
// the turn boundary containing the target, never the whole history like jumpTop.
async function revealMessage(i: number): Promise<void> {
  if (!Number.isInteger(i) || i < 0 || i >= props.messages.length) return
  const target = turnStartFor(i)
  // The window only ever GROWS: shrinking it would unmount what the reader is on.
  if (target >= windowStart.value) return
  // Same viewport anchoring as loadOlder: prepended turns push the content down, so
  // add the height delta back before anyone scrolls on purpose (no double jump).
  const el = msgsEl.value
  const prevH = el?.scrollHeight ?? 0
  const prevTop = el?.scrollTop ?? 0
  windowStart.value = target
  await nextTick()
  if (el) el.scrollTop = prevTop + (el.scrollHeight - prevH)
  updateEdges()
}

function scrollToBottom() {
  const el = msgsEl.value
  if (el) el.scrollTop = el.scrollHeight
}
async function jumpTop() {
  // "Go to the very beginning" is an explicit request → reveal any windowed-out
  // older turns first (mounting all is fine here), then scroll to the true top.
  if (windowStart.value > 0) {
    windowStart.value = 0
    await nextTick()
  }
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
  // scrolled up — they just sent / received a turn boundary. Unless the surface asked
  // us not to (find bar open).
  if (props.messages.length > prevLen) {
    if (!props.suppressAutoScroll) stick.value = true
  }
  // Transcript SHRANK in place (fork / regenerate truncation) → re-window to the
  // latest turns so `windowStart` can't dangle past the new end.
  else if (props.messages.length < prevLen) windowStart.value = startForLastTurns(INITIAL_TURNS)
  prevLen = props.messages.length
  if (stick.value) nextTick(scrollToBottom)
  nextTick(updateEdges)
})
// New array reference = session switch / transcript reload → window to the latest
// turns and jump to the bottom.
watch(
  () => props.messages,
  () => {
    stick.value = true
    prevLen = props.messages.length
    windowStart.value = startForLastTurns(INITIAL_TURNS)
    nextTick(() => {
      scrollToBottom()
      updateEdges()
    })
  },
)
function windowAndScrollToBottom() {
  prevLen = props.messages.length
  windowStart.value = startForLastTurns(INITIAL_TURNS)
  nextTick(() => {
    scrollToBottom()
    updateEdges()
  })
}
onMounted(windowAndScrollToBottom)
// Re-opening a session restores its SessionDetail from <KeepAlive> instead of
// remounting, so onMounted doesn't re-run — without this the transcript would keep
// its old scroll position. Re-window to the latest turns + jump to the bottom on every
// re-activation so opening a session always lands at the newest message.
onActivated(windowAndScrollToBottom)

// Publish this transcript to its surface (SessionDetail / SshSessionPanel) so jump
// callers below that surface reach THIS instance and query inside THIS root — never
// a same-session copy living in a hidden SSH tab (ADR 0075). Scope is structural, so
// mount/unmount is enough: no onActivated/onDeactivated pair.
const { registerTranscriptRevealer } = useSessionScroll()
let unregisterRevealer: (() => void) | null = null
onMounted(() => {
  unregisterRevealer = registerTranscriptRevealer({
    root: () => msgsEl.value,
    reveal: revealMessage,
  })
})
onUnmounted(() => {
  unregisterRevealer?.()
  unregisterRevealer = null
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
/* Floating collapse-all / expand-all toggle, top-right of the transcript — một
   chip popover mờ trên nội dung; "on" = toàn bộ step đang mở → wash sáng lên
   (idiom `bg-accent text-accent-foreground` của proto). */
.foldbtn {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  background: var(--popover);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  box-shadow: var(--shadow-sm);
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
  background: var(--accent-wash);
  color: var(--foreground);
}
.foldbtn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.foldbtn.on {
  opacity: 1;
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
@media (prefers-reduced-motion: reduce) {
  .foldbtn {
    transition: none;
  }
}
/* Floating jump controls, stacked at the transcript's bottom-right — pill tròn,
   hover = accent-wash trung tính (giống ghost button). */
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
  border-radius: var(--r-pill);
  background: var(--popover);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}
.sjbtn:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
.sjbtn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.sjbtn .up {
  transform: rotate(180deg);
}
.sjbtn {
  transition:
    border-color 0.12s ease,
    color 0.12s ease,
    background 0.12s ease,
    transform 0.1s ease;
}
.sjbtn:active {
  transform: scale(0.92);
}

/* Nhảy giữa các câu hỏi — pill dọc cùng ngôn ngữ với `.sjbtn`, neo CỐ ĐỊNH phía trên
   cụm lên-đầu/xuống-cuối (2 nút 32px + gap 6px + lề 10px) để không nhảy chỗ khi
   hai nút đó hiện/ẩn. */
.qnav {
  position: absolute;
  right: 16px;
  bottom: 96px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 32px;
  padding: 2px 0;
  border-radius: var(--r-pill);
  background: var(--popover);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
}
.qbtn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-pill);
  color: var(--muted-foreground);
  cursor: pointer;
  transition:
    color 0.12s ease,
    background 0.12s ease,
    transform 0.1s ease;
}
.qbtn:hover:not(:disabled) {
  background: var(--accent-wash);
  color: var(--foreground);
}
.qbtn:active:not(:disabled) {
  transform: scale(0.92);
}
.qbtn:disabled {
  opacity: 0.35;
  cursor: default;
}
.qbtn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.qpos {
  font-size: 10px; /* design-token-ok: nhãn đếm n/N phải vừa pill rộng 32px */
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
  user-select: none;
}
@media (prefers-reduced-motion: reduce) {
  .qbtn {
    transition: none;
  }
}

/* Load-older sentinel sits centered above the windowed transcript (align-self is a
   no-op if .msgs isn't a flex column — harmless either way). */
.loadolder {
  align-self: center;
  margin-top: 8px;
}

/* Cột message căn giữa theo proto (`mx-auto max-w-[860px] px-5 py-4 gap-5`):
   `.msgs` giữ scrollport + gutter `--padX` chung của cột chat, `.msgcol` chỉ giới
   hạn bề rộng nội dung. Scroll/windowing đọc `.msgs` — wrapper này là flex item
   duy nhất của nó nên scrollHeight/scrollTop không đổi. */
.msgcol {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
/* Chỉ số "đang soạn" neo sát mép trái cột — header message giờ là hàng riêng,
   body tràn full width nên không còn cột avatar để thụt vào (proto `pl-9` bỏ). */
.msgind {
  margin-left: 0;
}
/* New-turn enter: a freshly appended message fades + rises into place. Gap giữa
   hai message = 20px (proto `gap-5` trên cột). */
.milist {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
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
