<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Feed = đúng SessionTranscript của màn session (readonly): comment map
         thành SessionMessage — user → bubble phải, agent → assistant turn với
         byline = title tác giả, system → vạch chia. Có sẵn mọi thứ của màn
         session: render-window, fold, jump-to-bottom, code/mermaid.
         mouseup/contextmenu ở đây bung thanh nổi Quote/Translate/Copy MD giống
         `.chat` của SessionDetail. -->
    <div
      ref="feedEl"
      class="flex min-h-0 flex-1 flex-col"
      @mouseup="onSelectQuote"
      @contextmenu="onQuoteContextMenu"
      @mousedown="onFeedMouseDown"
    >
      <div v-if="!messages.length" class="flex-1 py-8 text-center text-xs text-faint">
        {{ t('sessions.workspace.group.threadEmpty') }}
      </div>
      <SessionTranscript v-else :messages="messages" :fallback-when="''" readonly />
    </div>

    <!-- Thanh nổi khi bôi đen text trong feed — cùng bộ ba của màn session:
         Quote (chèn `> excerpt` vào composer), Translate (popover dịch chung),
         Copy MD (markdown gốc của đoạn chọn, không phải text đã flatten). -->
    <div
      v-if="selBar"
      class="btsel"
      :style="{ '--sel-x': `${selBar.x}px`, '--sel-y': `${selBar.y}px` }"
      @mousedown.prevent
    >
      <button class="btselbtn" @click="onQuote">
        <Icon name="quote" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('sessions.quote.action') }}
      </button>
      <button class="btselbtn" @click="onTranslate">
        <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('translate.action') }}
      </button>
      <button class="btselbtn" @click="onCopyMd">
        <Icon
          :name="mdCopied ? 'check' : 'copy'"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ mdCopied ? t('common.copied') : t('common.copyMarkdown') }}
      </button>
    </div>

    <!-- Trạng thái giao tin của comment user cuối ("đã chuyển / xếp hàng /
         không ai nhận") — phản hồi tức thì khi user nhắn. Roster member đã có
         sẵn trong header của item modal nên không liệt kê lại ở đây. -->
    <div v-if="awaitRow" class="flex shrink-0 border-t border-border px-4 py-1.5">
      <div class="btawait flex items-center gap-1.5" :data-tone="awaitRow.tone">
        <component :is="awaitRow.icon" class="size-3 shrink-0" />
        <span class="truncate text-[11px]">{{ awaitRow.line }}</span>
      </div>
    </div>

    <!-- Composer khuôn session: @ tag agent/skill/file, `/` bung command,
         đính kèm ảnh/file (ghi .awog/board-att rồi append đường dẫn vào tin),
         Enter/nút send gửi theo composerSendKey. -->
    <div class="shrink-0 border-t border-border px-3 pb-2.5 pt-2">
      <WorkspaceBoardComposer
        ref="composer"
        v-model="draft"
        :project-id="projectId"
        :attachments="att.pending.value"
        :disabled="busy"
        show-send
        :placeholder="t('sessions.workspace.group.commentPh')"
        @pick="fileInput?.click()"
        @add-att="att.addAtt"
        @add-files="att.addFiles"
        @remove-att="att.removeAtt"
        @submit="post"
      />
    </div>
    <input ref="fileInput" type="file" multiple style="display: none" @change="onPick" />
  </div>
</template>

<script setup lang="ts">
// Thread "Trao đổi" của một board item — render bằng ĐÚNG SessionTranscript của
// màn session (readonly): comment map thành SessionMessage (user → bubble phải,
// agent → assistant turn byline = title tác giả, system → vạch chia) nên thread
// có đủ tính năng hiển thị của transcript thật — render-window, fold,
// jump-to-bottom, markdown/code/mermaid, copy/quote/fullscreen — cùng thanh nổi
// bôi-đen Quote/Translate/Copy MD. Chỉ bỏ các action CẮT transcript (resend/
// rewind/fork/regen…) vì comment không phải lượt của phiên nào; xem phiên thật
// (step, tool đang chạy) qua peek drawer/agent detail.
// Post NGAY qua `boards.comment` — bản ghi bền vững + wake "bên kia".
import { computed, nextTick, ref } from 'vue'
import { CircleAlert, CircleDashed, Hourglass, Send } from 'lucide-vue-next'
import { useI18n } from '~/composables/useI18n'
import { useBoardStore, type BoardItemComment } from '~/stores/board'
import { useSessionsStore } from '~/stores/sessions'
import type { SessionMessage } from '~/composables/useSessionsData'
import { provideQuoteSink } from '~/composables/useQuoteSink'
import { provideTranscriptSurface } from '~/composables/useTranscriptSurface'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { useComposerAttachments } from '~/composables/useComposerAttachments'
import { useBoardAtts } from '~/composables/useBoardAtts'
import { rawMarkdownForSelection } from '~/utils/selection-markdown'
import { boardCommentToMessage } from '~/utils/board-comment-message'
import SessionTranscript from '~/components/session/SessionTranscript.vue'
import WorkspaceBoardComposer from './WorkspaceBoardComposer.vue'

const props = defineProps<{
  projectId: string
  itemId: string
  comments: BoardItemComment[]
  assigneeSessionId?: string
}>()
const { t } = useI18n()
const board = useBoardStore()
const sessionsStore = useSessionsStore()
const translate = useSelectionTranslate()

// Surface RIÊNG của thread (ADR 0075): transcript bên trong đăng ký root/reveal
// của nó vào đây. Thread nằm trong cây SessionDetail (workspace panel → board →
// editor) — không khai surface riêng thì transcript của thread đăng ký lên
// surface của SessionDetail và chiếm jump-to-message của màn session chính.
provideTranscriptSurface()
// "comment <id>" refs trong thread resolve theo repo của PROJECT board item
// (không phải phiên đang active bên dưới modal).
provideGhCommentLink(() => props.projectId)

// Comment → SessionMessage (utils/board-comment-message — dùng chung với tab
// Media của editor). Thread này CHỈ hiển thị comment của item — trao đổi nội
// bộ ê-kíp nằm ở tab Channel riêng (WorkspaceChannel).
const messages = computed<SessionMessage[]>(() => {
  const msgs = props.comments.map(boardCommentToMessage)
  // Assignee đang streaming (generate thật) → ghost bubble cuối feed y hệt
  // turn đang chạy của màn session: avatar + byline title + transcript tự
  // hiện "working" indicator chữ xoay + elapsed. Hàng awaitRow bên dưới chỉ
  // còn nói trạng thái GIAO TIN ("đã chuyển / xếp hàng") — phần "ai đang
  // soạn" đã được bubble này diễn đạt. `startedAt` mượn từ turn streaming
  // thật nếu msgs của phiên đã nạp; chưa nạp thì indicator vẫn chạy, chỉ
  // thiếu elapsed.
  const me = byEngine(props.assigneeSessionId)
  if (me?.status === 'streaming') {
    const live = me.msgs?.findLast(
      (m): m is Extract<SessionMessage, { role: 'assistant' }> =>
        m.role === 'assistant' && !!m.streaming,
    )
    msgs.push({
      role: 'assistant',
      blocks: [],
      streaming: true,
      author: me.title,
      at: live?.at ?? new Date().toISOString(),
      startedAt: live?.startedAt,
    })
  }
  return msgs
})

const draft = ref('')
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const composer = ref<{ focus: () => void; expanded: () => string } | null>(null)
const att = useComposerAttachments()
const boardAtts = useBoardAtts()

// ── Quote sink: action quote trên message (readonly) chèn `> excerpt` vào
// composer của thread — tương đương followup-quote của phiên, nhưng đích đến
// là comment board chứ không phải tin gửi của một phiên. ──
function insertQuote(excerpt: string): void {
  const q = `> ${excerpt.trim().split('\n').join('\n> ')}\n\n`
  draft.value = draft.value ? `${q}${draft.value}` : q
  nextTick(() => composer.value?.focus())
}
provideQuoteSink(insertQuote)

// ── Thanh nổi bôi-đen: Quote / Translate / Copy MD ─────────────────────────
// Cùng mô hình `resolveSelectionQuote` của SessionDetail nhưng gọn hơn: anchor
// luôn là tin message (`[data-mi]` do SessionMessageItem gắn) — thread không có
// step/card ngoài message nên không cần nhánh "selection ngoài message".
interface SelBar {
  text: string
  mi: number | null
  x: number
  y: number
}
const feedEl = ref<HTMLElement | null>(null)
const selBar = ref<SelBar | null>(null)
const mdCopied = ref(false)
let mdCopiedTimer: ReturnType<typeof setTimeout> | null = null

function resolveSel(): { text: string; mi: number | null; rect: DOMRect } | null {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !text) return null
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer
  const startEl = node instanceof HTMLElement ? node : node.parentElement
  if (!startEl || !feedEl.value?.contains(startEl)) return null
  const msgEl = startEl.closest('[data-mi]')
  const mi = msgEl instanceof HTMLElement ? Number(msgEl.dataset.mi) : null
  return { text, mi: Number.isFinite(mi) ? mi : null, rect: range.getBoundingClientRect() }
}

// Chuột trái bung thanh neo đỉnh-trên của selection; chuột phải neo con trỏ
// (y hệt AN-3 của SessionDetail). Mousedown trái hủy thanh.
function onSelectQuote(e: MouseEvent): void {
  if (e.button !== 0) return
  const q = resolveSel()
  if (!q) {
    selBar.value = null
    return
  }
  mdCopied.value = false
  selBar.value = { text: q.text, mi: q.mi, x: q.rect.left + q.rect.width / 2, y: q.rect.top - 8 }
}
function onQuoteContextMenu(e: MouseEvent): void {
  const q = resolveSel()
  if (!q) return
  e.preventDefault()
  mdCopied.value = false
  selBar.value = { text: q.text, mi: q.mi, x: e.clientX, y: e.clientY }
}
function onFeedMouseDown(e: MouseEvent): void {
  // Mousedown trái hủy bar — chuột phải KHÔNG được hủy (nó bắn trước
  // contextmenu, sẽ xoá bar trước khi contextmenu set lại).
  if (e.button === 0) selBar.value = null
}

function onQuote(): void {
  if (!selBar.value) return
  insertQuote(selBar.value.text)
  selBar.value = null
}

// Translate → popover dịch chung toàn app, neo vào rect selection; ngôn ngữ/LLM
// resolve theo project của board item.
function onTranslate(): void {
  const q = selBar.value
  if (!q) return
  const sel = window.getSelection()
  const rect =
    sel && sel.rangeCount > 0
      ? sel.getRangeAt(0).getBoundingClientRect()
      : { left: q.x, top: q.y, bottom: q.y, width: 0 }
  translate.open(q.text, rect, props.projectId || undefined)
  selBar.value = null
}

// Copy MD → markdown GỐC đằng sau đoạn bôi đen (comment text chính là nguồn
// markdown — user/system = nguyên text; assistant = text block của nó).
function selSources(mi: number): string[] {
  const m = messages.value[mi]
  if (!m) return []
  return m.role === 'assistant'
    ? m.blocks.flatMap((b) => (b.kind === 'text' ? [b.text] : []))
    : [m.text]
}
async function onCopyMd(): Promise<void> {
  const q = selBar.value
  if (!q) return
  const md = q.mi != null ? (rawMarkdownForSelection(selSources(q.mi), q.text) ?? q.text) : q.text
  try {
    await navigator.clipboard.writeText(md)
  } catch {
    return // clipboard bị chặn — để bar còn đó để copy tay
  }
  mdCopied.value = true
  if (mdCopiedTimer) clearTimeout(mdCopiedTimer)
  mdCopiedTimer = setTimeout(() => {
    mdCopied.value = false
  }, 1400)
}

const byEngine = (id?: string) =>
  id ? sessionsStore.sessions.find((x) => x.engineId === id) : undefined

// ── "Chờ phản hồi" — tương tác thật của thread ──────────────────────────────
// Quét ngược comments: nếu tin MỚI NHẤT vẫn là của user (fromTitle 'You') và
// chưa có agent nào đáp sau nó (from !== null) ⇒ đang chờ. Comment hệ thống
// (fromTitle 'system': đổi status, turn failed…) trong suốt — không tính là
// phản hồi cũng không xoá trạng thái chờ. Suy ra từ dữ liệu bền vững nên
// reload vẫn đúng; `board.lastWake` chỉ thêm nét "inbox lỗi" lúc vừa gửi.
interface AwaitRow {
  icon?: unknown
  tone: 'info' | 'warn'
  line: string
}
const awaitRow = computed<AwaitRow | null>(() => {
  let hasUserTail = false
  for (let i = props.comments.length - 1; i >= 0; i--) {
    const c = props.comments[i]
    if (!c) continue
    if (c.from) return null // agent đã đáp sau tin user cuối → không còn chờ
    if (c.fromTitle === 'You') {
      hasUserTail = true
      break
    }
  }
  if (!hasUserTail) return null
  const aid = props.assigneeSessionId
  const me = byEngine(aid)
  if (aid && aid !== 'user' && !me) {
    return { icon: CircleAlert, tone: 'warn', line: t('sessions.workspace.group.await.gone') }
  }
  if (!aid || aid === 'user') {
    return { icon: CircleDashed, tone: 'warn', line: t('sessions.workspace.group.await.none') }
  }
  if (board.lastWake[props.itemId] === 'failed') {
    return { icon: CircleAlert, tone: 'warn', line: t('sessions.workspace.group.await.failed') }
  }
  const name = me?.title || aid
  // 'awaiting' = turn đỗ trên câu hỏi/permission — aborter còn giữ nên tin của
  // user xếp sau lượt hiện tại, đúng nghĩa "đang trong một lượt". 'streaming'
  // (generate thật) không cần chữ — ghost bubble cuối feed đã diễn đạt "đang
  // soạn"; nếu tin user xếp sau lượt khác thì hàng này vẫn nói xếp hàng.
  const queued = me?.status === 'awaiting' || board.lastWake[props.itemId] === 'queued'
  return {
    icon: queued ? Hourglass : Send,
    tone: 'info',
    line: t(
      queued ? 'sessions.workspace.group.await.queued' : 'sessions.workspace.group.await.sent',
      { name },
    ),
  }
})

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files?.length) att.addFiles(input.files)
  input.value = ''
}

// Comment chỉ mang text → đính kèm ghi file vào .awog/board-att/<itemId>/ rồi
// append dòng đường dẫn (agent đọc qua Read); slash `/cmd` bung thành body.
// Không cần tự scroll-bottom — SessionTranscript đã có stick-to-bottom.
async function post(): Promise<void> {
  const text = (composer.value?.expanded() ?? draft.value).trim()
  const atts = att.pending.value
  if ((!text && !atts.length) || busy.value) return
  busy.value = true
  try {
    const attLines = await boardAtts.materialize(atts, props.projectId, props.itemId)
    const full = [text, ...(attLines.length ? [t('board.agent.attachHead'), ...attLines] : [])]
      .filter(Boolean)
      .join('\n\n')
    if (await board.commentItem(props.projectId, props.itemId, full)) {
      draft.value = ''
      att.clear()
    }
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
/* Hàng "đã chuyển/chờ phản hồi" — mức info mờ nhẹ (trạng thái giao tin, không
   phải lỗi); mức warn (không ai nhận / inbox lỗi / phiên đã đóng) nổi amber. */
.btawait {
  color: var(--textFaint);
}
.btawait[data-tone='warn'] {
  color: var(--amber);
}

/* Thanh nổi Quote/Translate/Copy-MD — sao chép `.selactions` của SessionDetail
   (scoped CSS không tái dùng được). z 80 đủ: thread sống TRONG stacking
   context của `.wsed-ovl` (160) nên so với nội dung modal nó vẫn nổi trên —
   fixed chỉ tranh z trong cùng context, không cần vượt 160 của chính overlay. */
.btsel {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 80;
  transform: translate(
    clamp(8px, calc(var(--sel-x, 0px) - 50%), calc(100vw - 100% - 8px)),
    max(8px, calc(var(--sel-y, 0px) - 100%))
  );
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100vw - 16px);
  padding: 4px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}
.btselbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--popover-foreground);
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.btselbtn:hover {
  background: var(--accent-wash);
}
.btselbtn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
</style>
