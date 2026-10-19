<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <!-- Fold control: one click collapses every open step/cluster in the
         transcript, the next click expands them all back. Hidden until the
         session actually has messages to fold. Chip nổi mờ trên nội dung, góc
         trên-phải; "on" = mọi step đang mở → wash sáng lên. -->
    <Transition v-bind="FADEPOP">
      <Button
        v-if="messages.length"
        variant="outline"
        size="iconSm"
        class="absolute top-2.5 right-4 z-4 bg-popover text-muted-foreground shadow-sm hover:text-foreground hover:opacity-100 motion-reduce:transition-none"
        :class="allExpanded ? 'bg-accent text-accent-foreground opacity-100' : 'opacity-70'"
        :title="
          allExpanded
            ? t('sessions.transcript.fold.collapse')
            : t('sessions.transcript.fold.expand')
        "
        :aria-pressed="allExpanded"
        @click="toggleFold"
      >
        <Icon name="foldv" class="size-3.5" />
      </Button>
    </Transition>
    <!-- Chapter menu (#24): only once the model marked at least two phases — a
         table of contents with one entry is noise, not navigation. -->
    <Transition v-bind="FADEPOP">
      <SessionChapterNav v-if="chapters.length > 1" :chapters="chapters" />
    </Transition>
    <!-- Scrollport của transcript, lề ngang `--padX` chung với composer/ngăn kéo câu hỏi. -->
    <div
      ref="msgsEl"
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-(--padX) py-5"
      @scroll="onScroll"
    >
      <SessionTranscriptSkeleton v-if="loading && !messages.length" />
      <SessionWelcome v-else-if="!messages.length" />
      <template v-else>
        <!-- Centered message column (ProtoTranscript: căn giữa, trần 860px, px-5
             py-4 gap-5). The scrollport above keeps the shared --padX gutter; the
             column caps at 860px. Scroll/windowing reads the scrollport — this
             wrapper is its only flex item so scrollHeight/scrollTop are unchanged.
             All windowing logic is unchanged — same sentinel, same TransitionGroup,
             same keys. -->
        <div class="mx-auto flex w-full max-w-215 flex-col gap-5">
          <!-- Only the most recent turns mount on open — a long session's history is
               heavy to render (markdown + highlight + mermaid per message), so mounting
               all of it made switching sessions janky. Older turns reveal on demand as
               the user scrolls up (auto sentinel), or all at once via jump-to-top. -->
          <LoadMoreSentinel
            v-if="hiddenCount > 0"
            class="mt-2 self-center"
            :remaining="hiddenCount"
            auto
            @load="loadOlder"
          />
          <!-- No `appear`: opening a session shows its history instantly; only turns
               that arrive afterwards (user send / assistant reply) fade + rise in
               (mờ → rõ + trồi 8px, 0.26s). Hai message cách nhau 20px. -->
          <TransitionGroup
            tag="div"
            enter-active-class="animate-in fade-in-0 slide-in-from-bottom-2 duration-260 motion-reduce:animate-none"
            class="flex w-full flex-col gap-5"
          >
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
          <SessionProcessingIndicator v-if="working" :started-at="workingStartedAt" />
        </div>
      </template>
    </div>
    <!-- Cột nút nổi góc dưới-phải — MỘT cột flex cho cả hai cụm để chúng không bao
         giờ đè nhau (trước đây hai khối neo `bottom-*` riêng, tính theo rem nên lệch
         khi cỡ chữ gốc không phải 16px). Mọi nút cùng một kiểu: tròn, viền, 32px.
           1. Nhảy giữa các câu hỏi của user: ↑ câu trước · n/N · ↓ câu sau.
           2. Lên đầu / xuống cuối: LUÔN giữ chỗ (chỉ mờ + tắt click khi không có chỗ
              để đi) nên cụm 1 đứng yên, không bị đẩy lên xuống theo mép cuộn. -->
    <div
      class="pointer-events-none absolute right-4 bottom-4 z-4 flex flex-col items-center gap-1.5"
    >
      <Transition v-bind="FADEPOP">
        <div
          v-if="userIdx.length > 1"
          class="pointer-events-auto flex w-ctrl-sm flex-col items-center rounded-full border bg-popover py-0.5 shadow-sm"
          role="group"
          :aria-label="t('sessions.transcript.qnav.label')"
        >
          <Button
            variant="ghost"
            size="iconSm"
            :class="QNAV_BTN"
            type="button"
            :disabled="prevQ === null"
            :title="t('sessions.transcript.qnav.prev')"
            :aria-label="t('sessions.transcript.qnav.prev')"
            @click="jumpQuestion(-1)"
          >
            <ArrowUp />
          </Button>
          <span
            class="text-xs text-muted-foreground tabular-nums select-none"
            :title="t('sessions.transcript.qnav.pos', { n: qPos || '–', total: userIdx.length })"
          >
            {{ qPos || '–' }}/{{ userIdx.length }}
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            :class="QNAV_BTN"
            type="button"
            :disabled="nextQ === null"
            :title="t('sessions.transcript.qnav.next')"
            :aria-label="t('sessions.transcript.qnav.next')"
            @click="jumpQuestion(1)"
          >
            <ArrowDown />
          </Button>
        </div>
      </Transition>
      <Button
        variant="outline"
        size="iconMd"
        :class="[JUMP_BTN, atTop && JUMP_OFF]"
        :title="t('sessions.transcript.scrollTop')"
        :aria-hidden="atTop || undefined"
        :tabindex="atTop ? -1 : undefined"
        @click="jumpTop"
      >
        <Icon name="chev" class="size-4 rotate-180" />
      </Button>
      <Button
        variant="outline"
        size="iconMd"
        :class="[JUMP_BTN, atBottom && JUMP_OFF]"
        :title="t('sessions.transcript.scrollBottom')"
        :aria-hidden="atBottom || undefined"
        :tabindex="atBottom ? -1 : undefined"
        @click="jumpBottom"
      >
        <Icon name="chev" class="size-4" />
      </Button>
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

// Nút nổi (fold / nhảy): mờ + co nhẹ khi hiện/ẩn thay vì bật cứng; ra nhanh hơn vào.
const FADEPOP = {
  enterActiveClass:
    'animate-in fade-in-0 zoom-in-85 duration-160 ease-out motion-reduce:animate-none',
  leaveActiveClass:
    'animate-out fade-out-0 zoom-out-85 duration-100 ease-in motion-reduce:animate-none',
} as const
// Nút lên đầu / xuống cuối: tròn, viền, nền popover — cùng khung 32px với cụm qnav.
const JUMP_BTN =
  'pointer-events-auto rounded-full bg-popover text-muted-foreground shadow-sm transition-[opacity,scale] duration-150 hover:text-foreground active:scale-92 motion-reduce:transition-none'
// Không có chỗ để đi: mờ hẳn + bỏ click nhưng VẪN giữ chỗ trong cột.
const JUMP_OFF = 'pointer-events-none scale-85 opacity-0'
// ↑/↓ trong cụm qnav: tròn, icon size-4 như nút lên đầu / xuống cuối.
const QNAV_BTN =
  'size-ctrl-xs rounded-full text-muted-foreground hover:text-foreground active:scale-92 disabled:opacity-35 [&_svg]:size-4'

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
  for (const row of el.querySelectorAll<HTMLElement>('[data-role="user"][data-mi]')) {
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
  const row = el?.querySelector<HTMLElement>(`[data-role="user"][data-mi="${target}"]`)
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
