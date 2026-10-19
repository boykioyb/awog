<template>
  <!-- system divider — header (avatar + byline) là một hàng riêng, nội dung
       tràn full width ngang mép avatar thay vì thụt vào sau cột avatar. -->
  <div
    v-if="message.role === 'system'"
    :data-mi="msgIndex"
    class="group/msg relative flex flex-col gap-1.5 self-stretch"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span :class="AVATAR"><Wrench class="size-3.5" /></span>
      <div class="flex items-baseline gap-2">
        <span class="text-base font-medium text-foreground">
          {{ t('sessionsSearch.role.system') }}
        </span>
        <span class="text-xs text-muted-foreground tabular-nums">{{ fmt(message.at) }}</span>
        <Badge v-if="message.via" variant="outline" :class="VIA">{{ viaLabel }}</Badge>
      </div>
    </div>
    <div class="flex items-center justify-center gap-2 self-stretch text-xs text-dim">
      <Separator class="w-auto flex-1" />
      <Icon name="refresh" class="size-3 text-faint" />
      <SessionLinkedText :text="systemText" />
      <Separator class="w-auto flex-1" />
    </div>
  </div>

  <!-- user bubble — proto bubble-mode render: no avatar/byline, body right-aligned.
       Hàng user cap 75% cột (proto `max-w-[75%]`). `data-role="user"` là móc để
       SessionTranscript tìm các câu hỏi của user (nhảy giữa câu hỏi). -->
  <div
    v-else-if="message.role === 'user'"
    :data-mi="msgIndex"
    data-role="user"
    class="group/msg relative flex max-w-3/4 flex-col items-end gap-1.25 self-end"
  >
    <!-- Bubble tự co theo nội dung (không cap % theo `.urow` — hàng co về con rộng nhất,
         nên tin ngắn bị cap theo bề rộng dòng giờ). Bẻ token dài liền mạch (path,
         URL) để xuống dòng trong bubble; `min-w-0` cho bubble flex co được.
         Idiom shadcn: nền wash trung tính, chữ accent-foreground, không viền; bo
         `rounded-2xl` với góc trên-phải nhỏ làm đuôi (proto `rounded-tr-md`).
         hook-ok: `.mu` được useSessionFind.ts đọc (querySelector) để tô kết quả tìm -->
    <div class="mu" :class="BUBBLE">
      <div v-if="message.quotes && message.quotes.length" class="mb-1.75 flex flex-col gap-1.5">
        <!-- Quote trích từ reply, đầu bubble: wash con mix theo màu chữ để đọc được
             ở cả hai theme. -->
        <div
          v-for="(q, k) in message.quotes"
          :key="k"
          class="flex gap-2 rounded-sm border-l-2 border-primary bg-accent-foreground/5 px-2.25 py-1.5 text-left text-sm"
        >
          <span class="flex-none text-primary">{{ CIRCLED[k] }}</span>
          <div>
            <div class="line-clamp-4 text-muted-foreground">{{ q.excerpt }}</div>
            <div v-if="q.note" class="mt-0.75 text-foreground">{{ q.note }}</div>
          </div>
        </div>
      </div>
      <!-- Slash command: show the compact invocation, not the expanded body
           (full body sent to the model lives in message.text, shown on hover).
           Chip chỉ chứa `/name`; args là văn xuôi ở dòng dưới, render như text thường
           của bubble để đọc lại được đầy đủ (R-C1/R-C4). Chip giữ tint primary: nó là
           "lệnh đã nhận", không phải văn xuôi. -->
      <template v-if="message.command">
        <!-- mono-ok: tên lệnh là chuỗi người dùng gõ/copy vào CLI -->
        <span
          class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.25 py-0.75 font-mono text-primary"
          :title="message.text"
        >
          <Icon name="commands" class="size-3 flex-none" />
          <!-- Tên không bẻ dòng, dài hơn bubble thì cắt `…` (R-C2/R-C3). -->
          <span class="min-w-0 truncate font-semibold">/{{ message.command.name }}</span>
        </span>
        <!-- Args kế thừa cỡ/leading/màu + wrap của bubble — cố ý giống text thường (R-C4). -->
        <div v-if="message.command.args" class="mt-1.5">
          <SessionLinkedText :text="message.command.args" />
        </div>
      </template>
      <!-- Tin đến từ NGOÀI phiên (phiên khác gửi, người dùng chuyển tiếp, PR đang
           theo dõi): thân tin nằm trong một khối hàng rào kèm lời dẫn dành cho model.
           In nguyên văn thì người đọc phải lội qua cả bộ khung + một thẻ nonce 48 bit
           mà với mắt người không mang thông tin nào. -->
      <template v-else-if="fenced">
        <SessionFencedMessage v-for="(f, k) in fenced" :key="k" :msg="f" />
      </template>
      <template v-else>
        <SessionLinkedText :text="message.text" />
      </template>
      <div v-if="message.att && message.att.length" class="mt-2 flex flex-wrap gap-1.5">
        <SessionAttachmentChip
          v-for="(a, k) in message.att"
          :key="k"
          :att="a"
          :siblings="message.att"
        />
      </div>
    </div>
    <!-- Footer dưới bubble (proto `flex-row-reverse` trên row + cluster): meta
         nằm sát mép phải bubble, cụm action ghost dãn ra trái — ⋯ ngoài cùng.
         `readonly` (board thread render comment dưới dạng message) giấu cụm
         action — resend/rewind/fork/edit của nó nhắm vào transcript của phiên
         thật qua scope, trên message giả lập sẽ thao tác nhầm phiên. -->
    <div :class="META_ROW" class="flex-row-reverse">
      <span class="min-w-0">{{ fmt(message.at) }} · {{ tokLabel }} tok</span>
      <!-- Tin nhập từ CLI (Open in CLI → syncCli) mang cờ `via` — chip mờ nhỏ,
           metadata chứ không phải nhãn lớn. -->
      <Badge v-if="message.via" variant="outline" :class="VIA">{{ viaLabel }}</Badge>
      <!-- Readonly (board thread) vẫn hiện cụm action — chỉ là subset an toàn
           (copy / fullscreen): các computed lọc hành động ghi-phiên ra rồi. -->
      <SessionMsgActions
        v-if="userPrimary.length"
        :class="ACTIONS_HOVER"
        class="flex-row-reverse"
        :primary="userPrimary"
        :overflow="userOverflow"
      />
    </div>
  </div>

  <!-- assistant — header (avatar + byline) là một hàng riêng, phần thân
       (anchors → body card → meta/actions) tràn full width ngang mép avatar. -->
  <div
    v-else
    :data-mi="msgIndex"
    class="group/msg relative flex max-w-full flex-col gap-1.5 self-stretch"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span :class="AVATAR" class="border-transparent bg-primary text-primary-foreground">
        <Bot class="size-3.5" />
      </span>
      <div class="flex items-baseline gap-2">
        <span class="text-base font-medium text-foreground">{{ turnAuthor }}</span>
        <span class="text-xs text-muted-foreground tabular-nums">{{ fmt(message.at) }}</span>
      </div>
    </div>
    <div class="flex min-w-0 flex-col gap-1.5">
      <div v-if="anchors.length" class="mb-1.25 flex gap-1">
        <span
          v-for="a in anchors"
          :key="a.label"
          class="grid size-4.5 cursor-pointer place-items-center rounded-full border border-selected-border text-xs text-primary tabular-nums"
          role="button"
          :title="t('sessions.transcript.anchor.tooltip')"
          @click="void scrollToMessage(msgIndex)"
        >
          {{ a.label }}
        </span>
      </div>
      <!-- The whole assistant turn sits in ONE elevated bubble (craft-style card): the
           collapsed activity section ("N steps") + the final response together, so they
           read as one unit. The response caps its own height + scrolls inside the card.
           Luôn là cột flex (giữ gap giữa block); biến thể bubble (Settings → Sessions ·
           Assistant bubble) bọc nó trong card `rounded-xl border bg-card shadow-sm`. -->
      <div
        class="flex flex-col gap-2"
        :class="{
          'overflow-hidden rounded-xl border bg-card px-3.5 py-2.75 shadow-sm': showBubble,
        }"
      >
        <template v-for="(g, gi) in grouped" :key="g.key">
          <!-- Collapsible activity section (tools + thinking + intermediate commentary),
               craft TurnCard body. -->
          <SessionTurnActivities
            v-if="g.type === 'activities'"
            :entries="g.entries"
            :preview="g.preview"
            :streaming="streaming"
            :msg-eid="message.eid"
          />
          <!-- The prominent final answer (craft's ResponseCard) — bubbled per the
               assistantBubble pref. Carries §8 quote highlights + caret. -->
          <SessionTextBlock
            v-else-if="g.type === 'text'"
            :text="g.text"
            :highlights="highlightsForBlock(g.blockIndex)"
            :streaming="streaming"
            :caret="streaming && gi === grouped.length - 1"
            :bubble="showBubble"
          />
          <!-- Latest TodoWrite checklist, rendered inline once the docked banner yields. -->
          <SessionStepItem v-else-if="g.type === 'todo'" :block="g.step" :msg-eid="message.eid" />
          <!-- Trang agent vừa mở (browser_tool navigate/tab_new): thẻ xem trước. -->
          <SessionBrowserCard v-else-if="g.type === 'browser'" :block="g.step" />
          <!-- Turn error (stopReason 'error') — surface the provider message + a one-click
               retry (re-run this turn) instead of a silent empty bubble. -->
          <div
            v-else-if="g.type === 'error'"
            class="my-1 flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2.5"
          >
            <Icon name="alert" class="mt-px size-4 flex-none text-destructive" />
            <div class="flex min-w-0 flex-col items-start gap-2">
              <div class="leading-(--lh-md) wrap-anywhere text-foreground">{{ g.text }}</div>
              <Button
                variant="outline"
                size="xs"
                class="gap-1.5 border-destructive/40 text-sm font-normal text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3"
                :title="t('sessions.message.retry')"
                @click="regen"
              >
                <Icon name="refresh" />
                {{ t('sessions.message.retry') }}
              </Button>
            </div>
          </div>
          <!-- Model-initiated surfaces (#24/#26/#27/#34). They ride in as blocks like a
               gate does, but each renders its own card; the gate card is the fallback. -->
          <SessionChapterMark
            v-else-if="g.type === 'gate' && g.gate.kind === 'chapter'"
            :block="g.gate"
          />
          <SessionSharedFiles
            v-else-if="g.type === 'gate' && g.gate.kind === 'files'"
            :block="g.gate"
          />
          <SessionTaskSuggestion
            v-else-if="g.type === 'gate' && g.gate.kind === 'suggestion'"
            :block="g.gate"
          />
          <SessionFollowupSuggestions
            v-else-if="g.type === 'gate' && g.gate.kind === 'followups'"
            :block="g.gate"
            :is-last="isLastMessage"
          />
          <SessionFindings
            v-else-if="g.type === 'gate' && g.gate.kind === 'findings'"
            :block="g.gate"
          />
          <!-- Câu hỏi đang mở trong ngăn kéo phía trên ô soạn: ở đây chỉ còn MỘT dòng
               (bấm ⇒ bung ngăn kéo) thay vì thẻ đầy đủ thứ hai cho cùng câu hỏi. Đóng
               ngăn kéo (X) thì thẻ đầy đủ quay về đây để trả lời tại chỗ. Cùng tông
               cảnh báo của thẻ câu hỏi. -->
          <Button
            v-else-if="questionInDrawer(g.gate)"
            type="button"
            variant="outline"
            class="my-1 h-auto w-full min-w-0 justify-start gap-2 border-warning/35 bg-warning/8 px-2.5 py-1.5 text-left text-sm font-normal text-warning shadow-none hover:bg-warning/14 hover:text-warning [&_svg]:size-3.5"
            @click="openQuestion(g.gate)"
          >
            <Icon name="alert" />
            <span class="flex-none font-semibold">
              {{ t('sessions.message.questionInDrawer') }}
            </span>
            <span class="min-w-0 truncate text-dim">{{ questionSummary(g.gate) }}</span>
          </Button>
          <SessionGateCard v-else :block="g.gate" />
        </template>
        <!-- Chưa có block nào mà turn đang stream → ba chấm typing trong bubble
             (cả turn thật lúc chờ token đầu lẫn ghost "đang soạn" của channel). -->
        <div
          v-if="streaming && grouped.length === 0"
          class="inline-flex w-fit items-center gap-1.25 px-px py-0.5"
          role="status"
          :aria-label="t('sessions.transcript.typing')"
        >
          <span class="mtype-dot size-1.5 rounded-full bg-muted-foreground" />
          <span
            class="mtype-dot size-1.5 rounded-full bg-muted-foreground [animation-delay:150ms]"
          />
          <span
            class="mtype-dot size-1.5 rounded-full bg-muted-foreground [animation-delay:300ms]"
          />
        </div>
      </div>
      <!-- Meta + actions row UNDER the body (proto parity — no longer a footer bar
           inside the card): HIDDEN while actively generating (the
           SessionProcessingIndicator below the turn is the cue then). Parked on a
           gate → static "Waiting…"; done → `time · tok · elapsed` + hover actions. -->
      <div v-if="!streamingActive" :class="META_ROW">
        <span class="min-w-0">
          <!-- Park trên MỘT CÂU HỎI thì lượt không "đang chạy" theo nghĩa người dùng
               phải ngồi chờ — nó chờ NGƯỜI. Nên: chữ tĩnh (không shimmer, không chấm
               nhấp nháy) + nút mở lại popup, thay cho "Đang chờ…" của gate quyền. -->
          <template v-if="streaming && parkedOnQuestion">
            <span class="text-muted-foreground">{{ t('sessions.message.awaitingAnswer') }}</span>
            <Button
              variant="outline"
              size="xs"
              class="ml-2 h-auto rounded-sm border-primary/35 px-2 py-px text-xs font-normal text-primary shadow-none hover:bg-primary/10 hover:text-primary"
              @click="reopenQuestion"
            >
              {{ t('sessions.message.answerNow') }}
            </Button>
          </template>
          <template v-else-if="streaming">
            <!-- Chấm byline — chỉ hiện khi lượt park trên gate (cạnh "Đang chờ…"). -->
            <span
              class="mr-1.25 inline-block size-2 rounded-full bg-primary align-middle opacity-50"
            />
            <span>{{ t('sessions.message.waiting') }}</span>
          </template>
          <template v-else>
            {{ fmt(message.at) }} · {{ tokLabel }} tok
            <template v-if="elapsedLabel">· {{ elapsedLabel }}</template>
          </template>
        </span>
        <Badge v-if="message.via" variant="outline" :class="VIA">{{ viaLabel }}</Badge>
        <SessionMsgActions
          v-if="showBottomActions && (asstPrimary.length || asstOverflow.length)"
          :class="ACTIONS_HOVER"
          :primary="asstPrimary"
          :overflow="asstOverflow"
        />
      </div>
    </div>
    <SessionTurnFullscreen
      v-if="turnFullscreenOpen"
      :title="fullscreenTitle"
      :grouped="grouped"
      :streaming="streaming"
      :msg-eid="message.eid"
      :highlights-for-block="highlightsForBlock"
      @close="turnFullscreenOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
// One transcript message (renderMsgs ~1490). Proto skeleton (ProtoTranscript):
// system → avatar (Wrench) + byline + divider; user → right-aligned .mu bubble +
// footer; assistant → Bot avatar + column (byline → anchors → .abody groups →
// meta + SessionMsgActions). Activities/steps render BEFORE the text body inside
// `.abody` (grouped order preserved).
import type {
  SessionMessage,
  AssistantBlock,
  StepBlock,
  TextBlock,
  Followup,
} from '~/composables/useSessionsData'
import { MAX_BOOKMARKS, PROVIDER_DISPLAY } from '~/composables/useSessionsData'
import { Bot, Wrench } from 'lucide-vue-next'
import type { BlockHighlight } from './SessionTextBlock.vue'
import type { ActivityEntry } from './SessionTurnActivities.vue'
import type { PreviewRef } from '~/composables/usePreview'
import type { ConfirmOptions } from '~/composables/useConfirm'
import type { MsgAction, MsgSep } from './SessionMsgActions.vue'
import {
  finalResponseIndex,
  responseIndex,
  deriveTurnPhase,
  getPreviewText,
  blockRole,
  displayBlockOrder,
} from '~/utils/session-turns'
import { parseFencedMessages } from '~/utils/fenced-message'
import { QUESTION_DRAWER_KEY } from '~/composables/useSessionQuestionModal'

const props = withDefaults(
  defineProps<{
    message: SessionMessage
    fallbackWhen: string
    msgIndex: number
    // Bề mặt chỉ-đọc (board thread render comment dưới dạng message): cụm
    // SessionMsgActions tự lọc xuống subset AN TOÀN (copy / xem fullscreen) —
    // resend/rewind/fork/edit/regen/bookmark/quote tác động lên transcript của
    // phiên trong scope nên không được hiện trên message giả lập từ comment.
    readonly?: boolean
  }>(),
  { readonly: false },
)
const { t } = useI18n()

// ── Class dùng chung giữa ba nhánh role ──
// Avatar 24px (proto `size-6 rounded-md border`); mặc định muted (system), agent đè
// thành ô primary ở template.
const AVATAR =
  'flex size-6 flex-none items-center justify-center rounded-md border bg-muted text-muted-foreground'
// Chip "via <cli>" — tin được sessions.syncCli nhập từ một agent CLI ngoài ("Open in
// CLI"), đánh dấu nó không đi qua composer của AWOG. Viên nhỏ + mờ (faint, phụ so với
// byline), không phải nhãn hành động.
const VIA = 'flex-none py-px font-normal whitespace-nowrap text-faint'
// Hàng meta `time · tok · elapsed` + chip via + cụm action, sát mép cột nội dung.
const META_ROW = 'flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums'
// Cụm action chỉ hiện khi rê/tab vào message (proto `group/msg:hover` / focus-within).
const ACTIONS_HOVER =
  'opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100'
// Bubble user — utility đầy đủ để không còn dựa vào `.mu` của skin cũ (class đó chỉ
// còn là móc cho useSessionFind).
const BUBBLE =
  'min-w-0 max-w-full self-end rounded-2xl rounded-tr-sm border border-transparent bg-accent px-3 py-2 text-base wrap-anywhere text-accent-foreground shadow-sm'
const settings = useSettingsStore()
const store = useSessionsStore()
// Phiên mà message này thuộc về. Ở chế độ đơn = phiên đang mở; ở chế độ LƯỚI = phiên của
// ô chứa nó. Trích dẫn / badge ① / highlight đều phải đọc theo phiên NÀY, không phải
// `store.active` — xem useSessionScope.
const scope = useSessionScope()
// Xuất bản trả lời này thành báo cáo hạ tầng (mốc 6.6). Transcript là ĐIỂM NỐI duy
// nhất giữa "agent viết xong" và hộp xuất — màn Báo cáo không thể là nó, vì lúc bấm
// "Hỏi agent" thì chưa có gì để xuất. Xem đầu `useInfraReportPublish.ts`.
const { publishReport: publishAsReport } = useInfraReportPublish()

// The latest TodoWrite step renders inline as a transcript step once the docked banner
// yields (all done / turn ended). `inlineTodoStep` is that block (or null while it's
// still in the banner) — matched by reference below so only it shows inline.
const { inlineTodoStep } = useSessionTodo(() => store.active)

// Tin hộp thư: `null` với mọi message user tự gõ (đường thường), mảng khối khi TOÀN
// BỘ text là khối hàng rào. Parser fail closed nên chỉ cần null-check ở đây — còn sót
// một chữ ngoài hàng rào là nó trả null và bubble in nguyên văn như cũ.
const fenced = computed(() =>
  props.message.role === 'user' ? parseFencedMessages(props.message.text) : null,
)

// Tin nhập từ một CLI ngoài ("Open in CLI" → sessions.syncCli gắn `via`) — chip
// mờ trên hàng meta cho mọi role (user / assistant / system-divider).
const viaLabel = computed(() =>
  props.message.via ? t('sessions.cli.via', { cli: props.message.via }) : '',
)

// Divider text of a `system` message. A native-compaction marker localises its own
// figures ("120k → 3k tokens", the after-figure is absent when the CLI did not report
// it); every other system message shows its stored text.
const systemText = computed(() => {
  const m = props.message
  if (m.role !== 'system') return ''
  const c = m.compaction
  if (!c) return m.text
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
  const range =
    c.postTokens !== undefined ? `${k(c.preTokens)} → ${k(c.postTokens)}` : k(c.preTokens)
  return t(`sessions.compaction.marker.${c.trigger}`, { range })
})

// Byline author của lượt assistant — proto "claude · Sonnet 4.5" = harness · model.
// Agent AWOG (session.agent, thành viên team) thắng provider display name; đọc qua
// `scope.session` (KHÔNG `store.active`) để ô lưới lấy đúng phiên của nó.
// Phần model đọc `message.modelUsed` — model ĐÃ sinh lượt này — chứ không phải
// `s.model` (model đang chọn): đổi model giữa phiên không được viết lại nhãn của
// các lượt cũ. Tin persist trước khi có field này rơi về `s.model` như cũ.
const turnAuthor = computed(() => {
  // Field `author` (chỉ-hiển-thị, không persist) trên AssistantMessage thắng —
  // bề mặt đa tác giả (board thread render comment thành message) truyền
  // title của session đã viết thay vì agent/provider của phiên trong scope.
  if (props.message.role === 'assistant' && props.message.author) return props.message.author
  const s = scope.session.value
  if (!s) return t('sessionsSearch.role.agent')
  const agent = s.agent?.id ?? PROVIDER_DISPLAY[store.providerOf(s)] ?? ''
  const model = props.message.role === 'assistant' ? props.message.modelUsed : undefined
  return [agent, model ?? s.model].filter(Boolean).join(' · ')
})

// Assistant-bubble pref (Settings → Sessions): wrap the reply body in an elevated
// bubble card. Còn cho phép một bubble RỖNG khi đang stream — nó chứa ba chấm
// typing (`.mtyping`) nên không phải hộp trống: đây là trạng thái "đang soạn"
// của cả turn thật lẫn ghost placeholder kênh ê-kíp.
const showBubble = computed(
  () =>
    settings.sessions.assistantBubble &&
    props.message.role === 'assistant' &&
    (grouped.value.length > 0 || streaming.value),
)

// Pre-narrowed render units so the template never narrows a union via property
// access (vue-tsc friendly): each variant carries its concrete block type. `key`
// is a STABLE per-group identity (engine block eid where available, else a
// kind+position fallback) — used as the v-for key so a step/cluster component is
// NOT destroyed+recreated when the grouping reshapes mid-stream (which would reset
// its collapsed state → "clicking does nothing" while a turn streams).
export type Grouped =
  | { key: string; type: 'activities'; entries: ActivityEntry[]; preview: string }
  | { key: string; type: 'text'; text: string; blockIndex: number }
  | { key: string; type: 'todo'; step: StepBlock }
  | { key: string; type: 'browser'; step: StepBlock }
  | { key: string; type: 'error'; text: string }
  | { key: string; type: 'gate'; gate: AssistantBlock }

const blockKey = (b: AssistantBlock, bi: number): string =>
  'eid' in b && b.eid ? b.eid : `${b.kind}-${bi}`

// groupBlocks (craft TurnCard parity, ADR 0061): bucket the turn's blocks via
// blockRole — consecutive "activity" blocks (tool steps + thinking + intermediate
// commentary) collapse into one SessionTurnActivities section; the final response
// text, gates (plan/question/perm/steer), errors and the inline TodoWrite checklist
// render standalone in place. `key` is a STABLE per-group identity (engine eid where
// available, else kind+position) so a component is NOT destroyed+recreated when the
// grouping reshapes mid-stream (which would reset its collapsed state).
const grouped = computed<Grouped[]>(() => {
  if (props.message.role !== 'assistant') return []
  const blocks = props.message.blocks
  // While a tool-using turn still streams, a trailing text stays inside the activities
  // (it may be commentary before the next tool) — don't promote it to the response yet.
  const finalIdx = responseIndex(blocks, !!props.message.streaming)
  const phase = deriveTurnPhase(props.message)
  const out: Grouped[] = []
  let run: ActivityEntry[] = []
  let runBlocks: AssistantBlock[] = []
  let runKey = ''
  const flush = () => {
    if (!run.length) return
    out.push({
      key: `acts-${runKey}`,
      type: 'activities',
      entries: run,
      preview: getPreviewText(runBlocks, phase, (k, p) => t(k, p ?? {})),
    })
    run = []
    runBlocks = []
    runKey = ''
  }
  // Engine ghi `parts` theo thứ tự event đến: một step/surface event chen giữa
  // dòng text sẽ chẻ câu đang viết thành hai run ("…viết, k" | tool | "iểm ra
  // khác…", "…`casebook" | surface | "/case/…") — model thật sự bắn tool_use
  // giữa từ/câu. Đuôi lẻ ngắn rơi vào nhóm activities thu gọn → nhìn như text
  // bị cắt mất. Khi text group visible trước kết thúc bằng WORD-CHAR (chưa hết
  // câu: không khoảng trắng/dấu kết ở mép phải) VÀ block sau mở đầu là
  // continuation (chữ thường — giữa từ, hoặc dấu nối —/punct — giữa câu; KHÔNG
  // phải chữ hoa hay block structure mới), hai mảnh là cùng một mạch prose —
  // dán ngược về group trướ thay vì đẩy vào run. Không flush: step sau vẫn vào
  // cùng nhóm activities đang mở.
  const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
  // Continuation opener: chữ thường (`iểm…`, `ửa…`), hoặc whitespace + dấu nối
  // (` —`, `/`, `,`, `)`, `(`…) — em/en dash là U+2013/14 nên không đụng list
  // marker `- `. Chữ hoa / số / `#-*+>[` mở block mới → không phải continuation.
  const CONT_OPENER = /^\s*(?:\p{Ll}|[—–,;:.)!?(/'%"`~])/u
  const midWordTail = (tail: string): Extract<Grouped, { type: 'text' }> | null => {
    const prev = out.findLast((g) => g.type === 'text')
    return prev && WORD_CHAR.test(prev.text.at(-1) ?? '') && CONT_OPENER.test(tail) ? prev : null
  }
  // Duyệt theo thứ tự HIỂN THỊ (ADR 0096 D3): `followups` dồn xuống cuối, `bi` vẫn là
  // chỉ số gốc nên blockIndex/key/blockRole không đổi.
  for (const bi of displayBlockOrder(blocks)) {
    const b = blocks[bi]
    if (!b) continue
    // Chip chỉ là lời mời khi lượt đã kết thúc. Cổng đặt ở đây chứ không ở
    // SessionFollowupSuggestions: group chip ẩn mà vẫn đứng cuối sẽ cướp caret của
    // text đang stream và làm autoscroll của fullscreen đọc nhầm group cuối.
    if (b.kind === 'followups' && props.message.streaming) continue
    // Text run bắt đầu giữa từ = đuôi của prose trước bị step chẻ — dán về
    // group text trước (không flush: step phía sau vẫn vào run đang mở).
    if (b.kind === 'text') {
      const prev = midWordTail(b.text)
      if (prev) {
        prev.text += b.text
        continue
      }
    }
    // TodoWrite note steps carry the checklist for the docked SessionTodoPanel. Render
    // the LATEST one inline as its own step ONLY once the live banner has yielded (turn
    // ended / all items done) — never while the banner shows it, and never the older
    // intermediate snapshots. When skipped, don't flush so surrounding activities stay grouped.
    if (b.kind === 'step' && b.todos !== undefined) {
      if (b === inlineTodoStep.value) {
        flush()
        out.push({ key: blockKey(b, bi), type: 'todo', step: b })
      }
      continue
    }
    // Trang agent vừa mở bằng browser_tool → thẻ xem trước đứng riêng, hiện ngay không
    // cần mở nhóm "N steps" (kiểu Claude Desktop). Step lỗi (tải trang thất bại) thì
    // không có gì để xem trước nên quay về hàng step thường trong nhóm activities.
    if (b.kind === 'step' && b.page && b.status !== 'error') {
      flush()
      out.push({ key: blockKey(b, bi), type: 'browser', step: b })
      continue
    }
    // Collapsible activity = tool step + thinking + intermediate commentary text.
    if (blockRole(b, bi, finalIdx) === 'activity') {
      if (!run.length) runKey = blockKey(b, bi)
      if (b.kind === 'step') run.push({ key: blockKey(b, bi), kind: 'step', step: b })
      else if (b.kind === 'thinking')
        run.push({ key: blockKey(b, bi), kind: 'thinking', text: b.text })
      else if (b.kind === 'text') run.push({ key: `text-${bi}`, kind: 'text', text: b.text })
      runBlocks.push(b)
      continue
    }
    flush()
    if (b.kind === 'error') out.push({ key: blockKey(b, bi), type: 'error', text: b.text })
    else if (b.kind === 'text')
      out.push({ key: `text-${bi}`, type: 'text', text: b.text, blockIndex: bi })
    else out.push({ key: blockKey(b, bi), type: 'gate', gate: b })
  }
  flush()
  return out
})

// Rough token estimate (mtok ~1493): char count / 3, formatted with k suffix.
const tokLabel = computed(() => {
  const m = props.message
  let chars = 0
  if (m.role === 'user' || m.role === 'system') chars = m.text.length
  else
    chars = m.blocks
      .map((b) => ('text' in b ? b.text : '') + ('detail' in b ? b.detail || '' : ''))
      .join('').length
  const n = Math.round((chars || 1) / 3)
  return n > 999 ? (n / 1000).toFixed(0) + 'k' : String(n)
})

// Message actions (via the sessions store). The transcript passes each
// item its absolute index in the active session's message list (row.i) so buttons
// act at the right point — avoids an O(msgs) indexOf per item that also depended on
// the whole msgs array (re-running on every streaming delta).
const { CIRCLED } = useSessionsData()
const { scrollToMessage } = useSessionScroll()
const msgIndex = computed(() => props.msgIndex)

// Follow-up chips (#34) are an offer about what to ask NEXT, so they belong to the
// end of the conversation only — an older turn's chips would send the session
// somewhere it has already been. Computed here (the item knows its own index)
// rather than in the chip, which then stays a dumb renderer.
const isLastMessage = computed(() => props.msgIndex === (store.active?.msgs.length ?? 0) - 1)

// ── Streaming indicator + time (mirrors the old flow) ───────────────────────────
// While the turn streams, the byline shows a live "Streaming… {elapsed}" ticker
// (or a static "waiting" when parked on a gate); when done it shows the message
// clock time + total elapsed.
const asAssistant = computed(() => (props.message.role === 'assistant' ? props.message : null))
const streaming = computed(() => asAssistant.value?.streaming ?? false)
// Parked on a real gate = an unanswered question or a pending permission in THIS
// message. Only then do we show the static "Waiting…"; otherwise a streaming turn
// is actively generating (incl. tool calls) → "Streaming…". Deriving this from the
// message's own blocks (not the laggy session status) avoids a stuck "Waiting…"
// after a tool/gate auto-resolves and the model is working again.
const parkedOnGate = computed(() => {
  const m = asAssistant.value
  if (!m) return false
  return m.blocks.some(
    (b) =>
      (b.kind === 'question' && !questionAnswered(b)) ||
      (b.kind === 'perm' && b.status === 'pending'),
  )
})
const streamingActive = computed(() => streaming.value && !parkedOnGate.value)
// Câu hỏi chưa trả lời trong CHÍNH lượt này (gate quyền không tính: quyền là chặn
// một hành động, còn câu hỏi là mời người dùng quyết định lúc nào cũng được).
const pendingQuestion = computed(() => {
  const m = asAssistant.value
  if (!m) return null
  for (const b of m.blocks) {
    if (b.kind === 'question' && !questionAnswered(b) && !b.cancelled) return b
  }
  return null
})
const parkedOnQuestion = computed(() => !!pendingQuestion.value)
const { reopen, isDismissed } = useSessionQuestionModal()
const reopenQuestion = (): void => reopen(pendingQuestion.value?.eid)
// Vùng chứa có ngăn kéo câu hỏi không (SessionDetail / SessionGridPane provide) — chỗ
// không có (xem lượt toàn màn hình…) vẫn render thẻ đầy đủ.
const hasQuestionDrawer = inject(QUESTION_DRAWER_KEY, false)
const questionInDrawer = (b: AssistantBlock): boolean =>
  hasQuestionDrawer &&
  b.kind === 'question' &&
  !questionAnswered(b) &&
  !b.cancelled &&
  !isDismissed(b.eid)
const openQuestion = (b: AssistantBlock): void => {
  if (b.kind === 'question') reopen(b.eid)
}
const questionSummary = (b: AssistantBlock): string =>
  b.kind === 'question' ? b.title || b.items[0]?.prompt || '' : ''

// ── Streaming-render diagnostics (utils/stream-diag) ─────────────────────────────
// Snapshot the in-memory `message.blocks` the moment the turn finalizes: how many text
// runs the STORE actually holds + their lengths, plus how `grouped` bucketed them.
// Cross-referenced with the on-disk JSONL `fullText`, this decides store-layer loss
// (blocks short) vs render-layer stall (blocks complete but a SessionTextBlock STALLs —
// see its own diag rows). One record per turn, and gated on `DIAG_ON`
// (= `import.meta.dev`) so it compiles out of a production build.
watch(streaming, (on, was) => {
  if (!DIAG_ON || !was || on) return
  const m = asAssistant.value
  if (!m) return
  const texts = m.blocks.filter((b) => b.kind === 'text').map((b) => b.text.length)
  const total = texts.reduce((a, n) => a + n, 0)
  const gtext = grouped.value.flatMap((g) => (g.type === 'text' ? [g.text.length] : []))
  const actsRuns = grouped.value.reduce(
    (n, g) => n + (g.type === 'activities' ? g.entries.filter((e) => e.kind === 'text').length : 0),
    0,
  )
  streamDiag({
    src: 'msg',
    key: `msg#${props.msgIndex}`,
    ev: 'finalize',
    textLen: total,
    renderLen: 0,
    streaming: false,
    connected: true,
    note: `blocks text[${texts.length}]=${texts.join(',')}; grouped text[${gtext.length}]=${gtext.join(',')} actsTextRuns=${actsRuns}`,
  })
})

// ── Action-footer visibility ─────────────────────────────────────────────────
// Actions (copy/quote/fork/regen…) are shown only once the turn is done: they aren't
// valid mid-stream, and the footer would collide with the working indicator. When
// done they're persistent (no hover needed) — see the `.footer` styles.
const showBottomActions = computed(() => !streaming.value)

const nowTick = ref(Date.now())
let elapsedTimer: ReturnType<typeof setInterval> | null = null
watch(
  streaming,
  (on) => {
    if (on && !elapsedTimer) {
      nowTick.value = Date.now()
      elapsedTimer = setInterval(() => (nowTick.value = Date.now()), 1000)
    } else if (!on && elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (elapsedTimer) clearInterval(elapsedTimer)
})

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}
// Working elapsed: streaming → ticks to now; done → frozen at completedAt. Empty
// for non-assistant messages (no startedAt).
const elapsedLabel = computed(() => {
  const start = asAssistant.value?.startedAt
  if (start == null) return ''
  const end = asAssistant.value?.completedAt ?? nowTick.value
  return formatElapsed(Math.max(0, end - start))
})
// Message clock time from an ISO `at`; non-ISO (legacy literal) passes through,
// empty → the session's fallback "when".
function fmt(at?: string): string {
  if (!at) return props.fallbackWhen
  const ms = Date.parse(at)
  if (Number.isNaN(ms)) return at
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Follow-ups quoted FROM this message, paired with their global index (→ circled
// label). State-derived: removing one (store.removeQuote) automatically drops + renumbers.
type IndexedFollowup = { fu: Followup; idx: number; label: string }
const ownFollowups = computed<IndexedFollowup[]>(() =>
  (scope.session.value?.followups ?? [])
    .map((fu, idx) => ({ fu, idx, label: CIRCLED[idx] ?? String(idx + 1) }))
    .filter((x) => x.fu.src === msgIndex.value),
)

// Anchor badges: circled numbers for follow-up quotes whose source is THIS message.
const anchors = computed(() => ownFollowups.value.map((x) => ({ label: x.label })))

// §8 — highlights for one text block, derived purely from state so regenerate/rewind
// and store.removeQuote re-render correctly (no stale local copy, automatic renumber).
//
// A follow-up with an explicit `blockIndex` targets only that block; one without (the
// selection-quote path always omits it) is offered to EVERY text block and painted by
// whichever block's RENDERED text actually contains the excerpt (locateMarks). We can't
// pre-resolve the block here by `b.text.includes(excerpt)`: `b.text` is raw markdown while
// the excerpt is the whitespace-normalized RENDERED selection, so any quote crossing inline
// formatting (**bold**, `code`, links) or a soft line break would never match → no
// highlight. locateMarks matches on rendered text per block and simply skips blocks that
// don't contain the excerpt, so deferring to it is both correct and simpler.
const highlightsForBlock = (blockIndex: number): BlockHighlight[] =>
  ownFollowups.value
    .filter((x) => x.fu.blockIndex == null || x.fu.blockIndex === blockIndex)
    .map((x) => ({ fu: x.fu, label: x.label }))

// Presentable message text for copy / fullscreen / edit. For an assistant turn this is
// ONLY the final response (the answer) — intermediate commentary lives in the collapsed
// activity section and must NOT leak into fullscreen/copy. Falls back to all text runs
// joined when the turn has no clean final response (e.g. it ended on a tool). User /
// system messages are their raw text.
const plainText = computed(() => {
  const m = props.message
  if (m.role !== 'assistant') return m.text
  const idx = finalResponseIndex(m.blocks)
  const resp = idx >= 0 ? m.blocks[idx] : undefined
  if (resp && resp.kind === 'text') return resp.text
  return m.blocks
    .filter((b): b is TextBlock => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n')
})

function act(fn: (id: number, i: number) => void) {
  if (store.activeId != null && msgIndex.value >= 0) fn(store.activeId, msgIndex.value)
}
// Phản hồi "đã copy" ngay trên nút: icon đổi sang dấu tick + tô accent trong ~1.4s
// rồi tự trả về (2026-09-15). Không có phản hồi thì người dùng không biết cú bấm
// đã ăn hay chưa — `navigator.clipboard.writeText` im lặng cả khi thành công lẫn
// khi bị chặn quyền. Chỉ bật cờ khi ghi THẬT xong (await), nên tick = đã copy.
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyText() {
  try {
    await navigator.clipboard.writeText(plainText.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1400)
  } catch {
    // Clipboard bị chặn (quyền/ngữ cảnh không an toàn) — không tô tick giả.
    copied.value = false
  }
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
// Quote sink do bề mặt embed khai (board thread → chèn `> excerpt` vào composer
// của nó). Không có sink → đường phiên như cũ (addQuote → followup chips).
const quoteSink = useQuoteSink()
const quote = () => {
  if (props.readonly) {
    quoteSink?.(plainText.value)
    return
  }
  act(store.addQuote)
}

// ── Destructive-action guard (docs/features/session-destructive-action-guard.md) ──
// Four footer actions cut the transcript for good; they sit one icon away from copy /
// quote / fullscreen. Gate them behind the shared confirm dialog — but only when the
// cut actually costs messages, so the dialog keeps its meaning (§4.4). The gate lives
// HERE, not in the store: useConfirm() is UI (§4.7), and keeping it out of the store is
// why `retryModel` (which reaches `regenerate` directly) stays ungated by design (§4.3).
const { confirm } = useConfirm()

type GuardKind = 'rewind' | 'resend' | 'editResend' | 'regen'

// Index of the nearest USER turn strictly BEFORE `i` — the message `regenerate` re-sends.
// ⚠ RULE DUPLICATED ON PURPOSE: `stores/sessions.ts` → `regenerate()` walks back the exact
// same way ("Re-run the nearest preceding user turn"). That copy RUNS the action, this one
// only COUNTS what it will destroy. If one changes, change the other (spec §4.1).
function nearestUserIndex(msgs: SessionMessage[], i: number): number {
  let ui = i - 1
  while (ui >= 0 && msgs[ui]?.role !== 'user') ui -= 1
  return ui
}

// Messages that leave the transcript and DON'T come back (§4.1). The user message being
// resent and the reply being deliberately replaced are not losses, so they're subtracted.
// Returns -1 when the action must not run at all (regenerate with no user turn before it,
// E6) — the store would otherwise slice the transcript and then re-run nothing.
function lostCountOf(kind: GuardKind, msgs: SessionMessage[], i: number): number {
  if (kind === 'rewind') return msgs.length - i
  if (kind !== 'regen') return msgs.length - i - 1
  const ui = nearestUserIndex(msgs, i)
  // NOT `msgs.length - i - 1`: messages sitting BETWEEN the user turn and this reply
  // (a system divider, an assistant turn left over from a rewind) are cut too and must
  // be counted, not hidden.
  return ui < 0 ? -1 : msgs.length - ui - 2
}

// §7 — dialog copy, assembled from up to three pieces (`description` renders pre-wrap,
// so '\n' starts the cost line).
// `rewind` now DOES claim "cannot be undone" (§7.1, AC-R9): slice B2 made its on-disk
// truncation unconditional (§4.8), so the sentence is finally true. It stays out of the
// cost line though — a rewind re-runs nothing, so it costs no model call.
function guardDialog(kind: GuardKind, n: number): ConfirmOptions {
  if (kind === 'rewind') {
    return {
      title: t('sessions.guard.rewind.title'),
      description: `${t('sessions.guard.rewind.body', { n })} ${t('sessions.guard.irreversible')}`,
      confirmLabel: t('sessions.guard.rewind.confirm'),
    }
  }
  const tail = ` ${t('sessions.guard.irreversible')}\n${t('sessions.guard.costNote')}`
  const confirmLabel = t('sessions.guard.rerun.confirm')
  if (kind === 'regen') {
    return {
      title: t('sessions.guard.regen.title'),
      description: t('sessions.guard.regen.body', { n }) + tail,
      confirmLabel,
    }
  }
  const title =
    kind === 'editResend' ? t('sessions.guard.editResend.title') : t('sessions.guard.resend.title')
  return { title, description: t('sessions.guard.resend.body', { n }) + tail, confirmLabel }
}

// Run a destructive action behind the guard. `lostCount === 0` ⇒ straight through, no
// friction (§4.4) — that one rule covers "retry the last failed turn", "regenerate the
// last reply" and "resend the last bubble" without any per-button exception.
// After the await we re-check the transcript (§4.6): the number the user agreed to was
// computed against a specific session and length, so if either moved (a new message
// arrived, a turn started streaming, they switched session, they double-clicked) we do
// nothing and say so — silently skipping would be worse than the original problem.
async function guarded(kind: GuardKind, run: (id: number, i: number) => void) {
  const id = store.activeId
  const s = store.active
  const i = msgIndex.value
  // E9 — no active session / index out of range: no dialog, no action.
  if (id == null || !s || i < 0 || i >= s.msgs.length) return
  const lost = lostCountOf(kind, s.msgs, i)
  if (lost < 0) return
  if (lost === 0) {
    run(id, i)
    return
  }
  const lenAtOpen = s.msgs.length
  if (!(await confirm(guardDialog(kind, lost)))) return
  const now = store.active
  if (store.activeId !== id || !now || now.msgs.length !== lenAtOpen) {
    useToast().add({ title: t('sessions.guard.stale'), color: 'error' })
    return
  }
  run(id, i)
}

// Edit → open the focused prompt-edit overlay (§9); on confirm, edit & resend this
// user turn (truncate it + everything after, re-run with the new text). Cancel
// (null) leaves the turn untouched.
// The guard sits AFTER the overlay (§4.5): the overlay is where the user drafts, the
// dialog is where they commit — and the message count is only meaningful right before
// the cut. Cancelling the overlay still exits silently, no dialog.
const { openPromptEdit } = useCommandPalette()
const editMsg = async () => {
  const next = await openPromptEdit(plainText.value)
  if (next == null) return
  await guarded('editResend', (id, i) => void store.resend(id, i, next))
}
// Resend → re-run this user turn unchanged (one click, no overlay).
const resend = () => void guarded('resend', store.resend)
const regen = () => void guarded('regen', store.regenerate)
// NOT gated (§4.3): "try another model" is a highly deliberate click, and gating every
// destructive button breeds confirm-fatigue. It DOES truncate + spend a model call
// though (store.retryModel → regenerate), so it pays for the exemption with the danger
// hover colour below — the user sees the risk before clicking (AC-G28).
const retry = () => act(store.retryModel)
const rewind = () => void guarded('rewind', store.rewind)
const fork = () => act((id, i) => store.fork(id, i, 'fork'))

// Full screen → open the message body in the shared full-window PreviewModal
// (usePreview, the SAME instance mounted in SessionDetail) as rendered markdown:
// a read-only viewer with outline + scroll, the comfortable way to read a long
// reply. No-op on an empty body.
// Markdown images in a reply are workspace-relative (`![shot](tasks/…/x.png)`), the same
// base the transcript resolves them against. The modal renders the text through its OWN
// pipeline, so hand it the session's workspace root — without it every inline image
// resolves against the app:// origin and renders as a broken icon.
const { open: openPreview } = usePreview()
const filePreview = useFilePreview()
const openFullscreen = () => {
  const text = plainText.value
  if (!text.trim()) return
  const name =
    (props.message.role === 'assistant' && props.message.author) ||
    store.active?.title?.trim() ||
    t('sessions.message.fullscreenName')
  const sid = scope.sessionId.value
  void filePreview.root().then((root) => {
    const item: PreviewRef = { name, kind: 'markdown', text }
    if (root) item.workspaceRoot = root
    // Bôi đen trong fullscreen → ghim trích dẫn như trong transcript (store.addQuote),
    // và preview tập trích dẫn ở góc modal. Chỉ gắn hook khi có phiên + message hợp lệ;
    // `list` đọc thẳng `followups` (reactive) để panel góc tự cập nhật khi thêm/xoá.
    // Readonly (board thread): message không thuộc phiên nào — quote-ghi vào
    // scope session sẽ làm bẩn composer của phiên đang mở, nên bỏ hook quote.
    if (!props.readonly && sid != null && msgIndex.value >= 0) {
      item.quote = {
        add: (sel: string) => store.addQuote(sid, msgIndex.value, sel),
        list: () =>
          (scope.session.value?.followups ?? []).map((q, i) => ({
            excerpt: q.excerpt,
            note: q.note,
            remove: () => store.removeQuote(sid, i),
          })),
      }
    }
    openPreview(item)
  })
}

/**
 * Đưa bản trả lời này sang hộp xuất với tư cách một báo cáo hạ tầng (mốc 6.6).
 *
 * `projectId` lấy từ PHIÊN chứ không từ message: nó quyết định trang Wiki lưu ở tier
 * project hay tier global. `Session.project` chính là id đó ('' = tab Default), và
 * composable tự quy '' về "không có project".
 */
function publishReport(): void {
  publishAsReport(plainText.value, { projectId: store.active?.project })
}

// UI-3 — fullscreen the WHOLE turn (activities + gates + final response), rendered live
// via SessionTurnFullscreen (reuses `grouped` for realtime streaming). Distinct from
// openFullscreen above, which shows only the final response text in the PreviewModal.
const turnFullscreenOpen = ref(false)
const openTurnFullscreen = () => {
  turnFullscreenOpen.value = true
}
const fullscreenTitle = computed(
  () =>
    (props.message.role === 'assistant' && props.message.author) ||
    store.active?.title?.trim() ||
    t('sessions.message.fullscreenName'),
)
// Guard: if the turn is emptied out (rewind/fork/delete) while open, close the overlay so
// it never renders a stale/empty tree.
watch(
  () => grouped.value.length,
  (n) => {
    if (n === 0) turnFullscreenOpen.value = false
  },
)

// ── Bookmark (ADR 0074) ─────────────────────────────────────────────────────────
// A READING anchor on this message. It never enters the prompt — that is what the
// pinned context is for — so this button is cheap and needs no confirmation.
//
// Anchored on `eid`, the persisted message id. Without one there is nothing durable to
// point at (the locally pushed ENGINE_UNAVAILABLE notice never reaches the transcript
// file), and while the turn streams the id is not final yet: in both cases the button
// is simply ABSENT rather than present-and-broken (AC-B2).
const bookmarks = computed(() => store.active?.bookmarks ?? [])
const isBookmarked = computed(
  () => !!props.message.eid && bookmarks.value.some((b) => b.id === props.message.eid),
)
const canBookmark = computed(() => !!props.message.eid && !streaming.value)
// At the cap an unbookmarked message shows a DISABLED button with the reason, instead
// of a live button whose click would be swallowed by the store (and rejected by the RPC).
const bookmarkFull = computed(() => !isBookmarked.value && bookmarks.value.length >= MAX_BOOKMARKS)
const bookmarkTitle = computed(() => {
  if (bookmarkFull.value) return t('sessions.bookmark.limit')
  return isBookmarked.value ? t('sessions.bookmark.remove') : t('sessions.bookmark.add')
})
function toggleBookmark(): void {
  if (bookmarkFull.value) return
  const id = store.activeId
  if (id == null) return
  store.toggleBookmark(id, msgIndex.value)
}

// Hai cụm hành động dưới một lượt (session-ui-refactor §3.3). Chỉ BA điều khiển ở
// ngoài; mọi thứ hiếm dùng hoặc CẮT TRANSCRIPT nằm sau `⋯`, tách bằng một separator.
// Trước đây cả 10 (assistant) / 7 (user) icon đều nằm ngoài cùng một trọng số, nên
// `Tua về đây` trông y hệt `Sao chép` — màu đỏ khi hover là cảnh báo duy nhất.
// `danger` KHÔNG đồng nghĩa với "có hộp xác nhận": retryModel là danger nhưng ungated.
const copyAction = computed<MsgAction>(() => ({
  icon: copied.value ? 'check' : 'copy',
  title: copied.value ? t('sessions.message.copied') : t('sessions.message.copy'),
  run: copyText,
  active: copied.value,
}))
const userPrimary = computed<MsgAction[]>(() =>
  // Readonly (board thread): action KHÔNG chạy qua phiên — copy, quote (đi vào
  // quote-sink của bề mặt, không phải followup của phiên), xem fullscreen.
  props.readonly
    ? [
        copyAction.value,
        { icon: 'quote', title: t('sessions.message.quote'), run: quote },
        { icon: 'maximize', title: t('sessions.message.fullscreen'), run: openFullscreen },
      ]
    : [
        copyAction.value,
        { icon: 'maximize', title: t('sessions.message.fullscreen'), run: openFullscreen },
        ...(canBookmark.value
          ? [
              {
                icon: 'bookmark',
                title: bookmarkTitle.value,
                run: toggleBookmark,
                active: isBookmarked.value,
                disabled: bookmarkFull.value,
              },
            ]
          : []),
      ],
)
const userOverflow = computed<(MsgAction | MsgSep)[]>(() =>
  // Tất cả action của overflow đều ghi vào transcript phiên — readonly còn rỗng.
  props.readonly
    ? []
    : [
        { icon: 'fork', title: t('sessions.message.fork'), run: fork },
        { sep: true },
        { icon: 'edit', title: t('sessions.message.edit'), run: editMsg, danger: true },
        { icon: 'send', title: t('sessions.message.resend'), run: resend, danger: true },
        { icon: 'rewind', title: t('sessions.message.rewind'), run: rewind, danger: true },
      ],
)

const asstPrimary = computed<MsgAction[]>(() =>
  props.readonly
    ? [
        copyAction.value,
        { icon: 'quote', title: t('sessions.message.quote'), run: quote },
        ...(plainText.value.trim()
          ? [{ icon: 'maximize', title: t('sessions.message.fullscreen'), run: openFullscreen }]
          : []),
        { icon: 'layers', title: t('sessions.message.fullscreenTurn'), run: openTurnFullscreen },
      ]
    : [
        copyAction.value,
        { icon: 'quote', title: t('sessions.message.quote'), run: quote },
        ...(canBookmark.value
          ? [
              {
                icon: 'bookmark',
                title: bookmarkTitle.value,
                run: toggleBookmark,
                active: isBookmarked.value,
                disabled: bookmarkFull.value,
              },
            ]
          : []),
        // Hai nút fullscreen (response / cả lượt) là hành động tần suất cao — nằm
        // ngoài hàng primary, không núp sau ⋯.
        ...(plainText.value.trim()
          ? [{ icon: 'maximize', title: t('sessions.message.fullscreen'), run: openFullscreen }]
          : []),
        { icon: 'layers', title: t('sessions.message.fullscreenTurn'), run: openTurnFullscreen },
      ],
)
const asstOverflow = computed<(MsgAction | MsgSep)[]>(() =>
  // Readonly: primary đã ôm cả hai nút fullscreen; overflow không còn gì an toàn
  // để giữ (publishReport ghi wiki, fork/regen/retry/rewind ghi transcript).
  props.readonly
    ? []
    : [
        // Xuất thành báo cáo hạ tầng — chỉ khi có văn xuôi: một lượt chỉ có tool thì
        // không có gì để thành báo cáo, và `publishReport` sẽ trả false mà không nói gì.
        ...(plainText.value.trim()
          ? [{ icon: 'file', title: t('sessions.message.report'), run: publishReport }]
          : []),
        { icon: 'fork', title: t('sessions.message.forkShort'), run: fork },
        { sep: true },
        { icon: 'refresh', title: t('sessions.message.regen'), run: regen, danger: true },
        { icon: 'settings', title: t('sessions.message.retryModel'), run: retry, danger: true },
        { icon: 'rewind', title: t('sessions.message.rewind'), run: rewind, danger: true },
      ],
)
</script>

<style scoped>
/* style-ok: keyframe nảy của ba chấm "đang soạn" — không có trong tw-animate-css
   (animate-bounce nảy 25% chiều cao, không mờ dần). */
.mtype-dot {
  animation: mtype-bounce 1.2s ease-in-out infinite;
}
@keyframes mtype-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}
</style>
