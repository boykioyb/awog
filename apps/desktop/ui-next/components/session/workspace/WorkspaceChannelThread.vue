<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Feed = đúng SessionTranscript của màn session (readonly): entry kênh
         map thành SessionMessage — broadcast của user → bubble phải, member →
         assistant turn với byline = title (+ loại tin), system → vạch chia.
         Cùng thanh nổi Quote/Translate/Copy MD giống tab Comment. -->
    <div
      ref="feedEl"
      class="flex min-h-0 flex-1 flex-col"
      @mouseup="onSelectQuote"
      @contextmenu="onQuoteContextMenu"
      @mousedown="onFeedMouseDown"
    >
      <div v-if="!messages.length" class="flex-1 py-8 text-center text-xs text-faint">
        {{
          t(
            itemId
              ? 'sessions.workspace.group.discussEmpty'
              : 'sessions.workspace.group.channelEmpty',
          )
        }}
      </div>
      <SessionTranscript v-else :messages="messages" :fallback-when="''" readonly />
    </div>

    <!-- Thanh nổi khi bôi đen text trong feed — cùng bộ ba của tab Comment:
         Quote (chèn `> excerpt` vào composer), Translate, Copy MD. -->
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

    <!-- Composer khuôn session — y hệt tab Comment (@ tag file/skill, đính
         kèm, Enter theo composerSendKey); `@TênMember` trong text được resolve
         thành mentions để sidecar wake đúng người qua hộp thư. -->
    <div class="shrink-0 border-t border-border px-3 pb-2.5 pt-2">
      <WorkspaceBoardComposer
        ref="composer"
        v-model="draft"
        :project-id="projectId"
        :attachments="att.pending.value"
        :disabled="busy"
        show-send
        :placeholder="
          t(itemId ? 'sessions.workspace.group.discussPh' : 'sessions.workspace.group.channelPh')
        "
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
// Tab "Discuss" của item modal — trao đổi NỘI BỘ của ê-kíp VỀ đúng item này,
// render ĐÚNG khuôn messenger của tab Comment (SessionTranscript + thanh nổi
// + composer khuôn session) nên hai tab đọc một giọt. Dữ liệu là timeline
// JSONL của gốc run (channelFor(rootId), live qua `channel.appended`) LỌC
// theo thẻ `itemId` của entry — member/lead tag item khi team_say/team_note
// nói về một item cụ thể; entry không tag là trao đổi chung của ê-kíp, không
// thuộc thảo luận của item nào (xem ở cockpit Team / channel_read).
// Không truyền `itemId` thì component hiện trọn kênh (dùng như kênh run).
// Gửi qua `team.channelPost` — broadcast tới ê-kíp, TỰ GẮN itemId khi đang
// ở ngữ cảnh một item. Phần cấu trúc bôi-đen/quote/đính-kèm giữ nguyên bản
// sao của WorkspaceBoardThread — codebase đã nhận cách trùng lặp này với
// SessionDetail (xem comment `.btsel` bên dưới).
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useBoardStore, type TeamChannelKind } from '~/stores/board'
import type { Session, SessionMessage } from '~/composables/useSessionsData'
import { provideQuoteSink } from '~/composables/useQuoteSink'
import { provideTranscriptSurface } from '~/composables/useTranscriptSurface'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { useComposerAttachments } from '~/composables/useComposerAttachments'
import { useBoardAtts } from '~/composables/useBoardAtts'
import { rawMarkdownForSelection } from '~/utils/selection-markdown'
import { channelEntryToMessage } from '~/utils/board-comment-message'
import SessionTranscript from '~/components/session/SessionTranscript.vue'
import WorkspaceBoardComposer from './WorkspaceBoardComposer.vue'

const props = defineProps<{
  projectId: string
  // engineId của phiên GỐC run — khoá của file channel.
  rootId: string
  // lead + members của run — resolve "@Title" trong tin gửi → mentions
  // (sessionId) để sidecar wake đúng người.
  roster: Session[]
  // Board item đang xem — khi có, feed chỉ hiện entry được tag itemId này
  // ("Discuss" của item) và post từ đây tự gắn tag. Thiếu ⇒ hiện trọn kênh.
  itemId?: string
}>()
const { t } = useI18n()
const board = useBoardStore()
const translate = useSelectionTranslate()

// Surface RIÊNG của feed channel (ADR 0075) — cùng lý do với tab Comment:
// không khai surface riêng thì transcript bên trong đăng ký lên surface của
// SessionDetail và chiếm jump-to-message của màn session chính.
provideTranscriptSurface()
// "comment <id>" refs resolve theo repo của PROJECT board item.
provideGhCommentLink(() => props.projectId)

const KIND_KEYS: Partial<Record<TeamChannelKind, string>> = {
  status: 'sessions.workspace.group.kind.status',
  note: 'sessions.workspace.group.kind.note',
  eval: 'sessions.workspace.group.kind.eval',
}
// Discuss = entry được tag item này (thẻ chính lẫn thẻ phụ itemIds sidecar tự
// extract từ `bi-…` trong text), roll-up cả cây con — bàn về subtask cũng hiện
// trên epic/parent. Không có itemId ⇒ trọn kênh run.
const entries = computed(() => {
  const all = board.channelFor(props.rootId)
  if (!props.itemId) return all
  const scope = board.itemTagScope(props.projectId, props.itemId)
  return all.filter((e) => board.entryInScope(e, scope, props.projectId, props.rootId))
})
const messages = computed<SessionMessage[]>(() => {
  const msgs = entries.value.map((e) =>
    channelEntryToMessage(e, KIND_KEYS[e.kind] ? t(KIND_KEYS[e.kind]!) : ''),
  )
  // Member được tag đang soạn → ghost bubble CUỐI feed (streaming placeholder
  // y hệt turn thật của session: avatar + byline author + transcript tự hiện
  // "working" indicator chữ xoay + elapsed ngay dưới bubble). Một ghost GỘP
  // cho mọi typer vì indicator chỉ gắn message cuối — ghost lẻ phía trên sẽ
  // thành byline trần. Trả lời lên kênh → clearTyping → ghost nhường chỗ cho
  // bubble thật của họ.
  const typers = typingSessions.value
  if (typers.length) {
    const started = Math.min(...typers.map((s) => typingAt.value[s.engineId!] ?? Date.now()))
    msgs.push({
      role: 'assistant',
      blocks: [],
      streaming: true,
      author: typers.map((s) => s.title).join(' · '),
      at: new Date(started).toISOString(),
      startedAt: started,
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

// Quote → chèn `> excerpt` vào composer (cùng sink của tab Comment).
function insertQuote(excerpt: string): void {
  const q = `> ${excerpt.trim().split('\n').join('\n> ')}\n\n`
  draft.value = draft.value ? `${q}${draft.value}` : q
  nextTick(() => composer.value?.focus())
}
provideQuoteSink(insertQuote)

// ── Thanh nổi bôi-đen: Quote / Translate / Copy MD — bản sao nguyên khối của
// WorkspaceBoardThread (anchor `[data-mi]` của SessionMessageItem). ──
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
  if (e.button === 0) selBar.value = null
}
function onQuote(): void {
  if (!selBar.value) return
  insertQuote(selBar.value.text)
  selBar.value = null
}
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
    return
  }
  mdCopied.value = true
  if (mdCopiedTimer) clearTimeout(mdCopiedTimer)
  mdCopiedTimer = setTimeout(() => {
    mdCopied.value = false
  }, 1400)
}

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files?.length) att.addFiles(input.files)
  input.value = ''
}

// Quét "@<handle>" trong text → mentions[] (sessionId) để sidecar wake đúng
// người. Composer chèn dạng SLUG agentHandle (lowercase + space→'-', GIỮ '/'
// '—' '&' nguyên văn — "QA/QC — Testing & Automation" → "@qa/qc-—-testing-&-
// automation"); handle cũng có thể là slug-tên-AGENT của lead hay '@lead'.
// canon = bỏ dấu + gấp cụm ký tự lạ về '-' — giống sidecar
// (boards/mentions.ts · sessions/channel.ts) nên mọi dạng handle quy về một
// đích chung; token chứa ':'/'.' (ref/path) bị loại.
const canon = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MENTION_TOKEN_RE = /@([^\s@]{1,64})/gu
function rosterMentions(text: string): string[] {
  const tokens = new Set(
    [...text.matchAll(MENTION_TOKEN_RE)]
      .map((m) => m[1] ?? '')
      .filter((raw) => /^[\p{L}\p{N}]/u.test(raw) && !raw.includes(':') && !raw.includes('.'))
      .map(canon)
      .filter((h) => h.length > 0),
  )
  return props.roster
    .filter((s) => {
      if (!s.engineId) return false
      const title = s.title || ''
      if (title && new RegExp(`@${escRe(title)}(?![\\w/-])`, 'i').test(text)) return true
      const agentId = s.agent?.id
      return [...tokens].some(
        (h) =>
          h === s.engineId!.toLowerCase() ||
          (h === 'lead' && s.engineId === props.rootId) ||
          (title.length > 0 && h === canon(title)) ||
          (!!agentId && (h === agentId || canon(agentId).endsWith(`-${h}`))),
      )
    })
    .map((s) => s.engineId!)
}

// ── Typing indicator cho member được tag ────────────────────────────────────
// User post 'chat' + mentions → sidecar wake từng phiên đó qua hộp thư. Mốc
// typing bắt đầu ngay lúc gửi (tin đã qua tay sidecar) và tắt khi: member đó
// post bất kỳ entry nào lên kênh (feed không lọc itemId — trả lời ở đâu cũng
// tính), member rời roster, hoặc quá TTL *và* phiên đã ngừng stream — lượt
// comm dài vài phút, ghost phải sống trọn turn chứ không chết giữa chừng.
const TYPING_TTL_MS = 90_000
const typingAt = ref<Record<string, number>>({})
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

function markTyping(sessionId: string): void {
  typingAt.value = { ...typingAt.value, [sessionId]: Date.now() }
  const prev = typingTimers.get(sessionId)
  if (prev) clearTimeout(prev)
  typingTimers.set(
    sessionId,
    setTimeout(() => expireTyping(sessionId), TYPING_TTL_MS),
  )
}
// TTL chỉ được phép hết khi phiên KHÔNG còn stream: một lượt comm (wake từ
// channel) dễ mất vài phút — nếu ghost chết theo TTL trong lúc phiên đang
// chạy, feed trống y như "không ai nhận" cho tới khi reply mirror lên. Phiên
// đang stream ⇒ re-arm thêm một nhịp; reply lên kênh (watcher) vẫn tắt ngay.
function expireTyping(sessionId: string): void {
  const s = props.roster.find((x) => x.engineId === sessionId)
  if (s?.status === 'streaming') {
    typingTimers.set(
      sessionId,
      setTimeout(() => expireTyping(sessionId), TYPING_TTL_MS),
    )
    return
  }
  clearTyping(sessionId)
}
function clearTyping(sessionId: string): void {
  if (!(sessionId in typingAt.value)) return
  const rest = { ...typingAt.value }
  delete rest[sessionId]
  typingAt.value = rest
  const timer = typingTimers.get(sessionId)
  if (timer) clearTimeout(timer)
  typingTimers.delete(sessionId)
}
// Các member đang "gõ" — giữ thứ tự roster để danh sách ổn định.
const typingSessions = computed(() =>
  props.roster.filter((s) => s.engineId && typingAt.value[s.engineId]),
)
// Member trả lời lên kênh (bất kỳ item tag nào) → hết "đang gõ".
watch(
  () => board.channelFor(props.rootId),
  (all) => {
    for (const e of all) if (e.from && typingAt.value[e.from]) clearTyping(e.from)
  },
  { deep: false },
)

// Channel chỉ mang text → đính kèm ghi file vào .awog/board-att/ rồi append
// dòng đường dẫn (member đọc qua Read). Post broadcast qua `team.channelPost`;
// 'chat' kèm mentions → sidecar wake đúng những phiên được tag (comm turn), và
// từng người đó hiện typing dots tới khi họ trả lời kênh. Không cần tự
// scroll-bottom — SessionTranscript đã stick-to-bottom.
async function post(): Promise<void> {
  const text = (composer.value?.expanded() ?? draft.value).trim()
  const atts = att.pending.value
  if ((!text && !atts.length) || busy.value) return
  busy.value = true
  try {
    const attLines = await boardAtts.materialize(atts, props.projectId, `channel-${props.rootId}`)
    const full = [text, ...(attLines.length ? [t('board.agent.attachHead'), ...attLines] : [])]
      .filter(Boolean)
      .join('\n\n')
    const mentions = rosterMentions(full)
    if (await board.postChannel(props.rootId, full, 'chat', mentions, props.itemId)) {
      for (const id of mentions) markTyping(id)
      draft.value = ''
      att.clear()
    }
  } finally {
    busy.value = false
  }
}

// Nạp feed kênh khi mount (và khi đổi run — đổi assignee giữa các run); event
// `channel.appended` giữ feed sống từ đây về sau.
onMounted(() => {
  if (props.rootId) void board.listChannel(props.rootId)
})
watch(
  () => props.rootId,
  (id) => {
    if (id) void board.listChannel(id)
  },
)
onUnmounted(() => {
  for (const timer of typingTimers.values()) clearTimeout(timer)
  typingTimers.clear()
})
</script>

<style scoped>
/* Thanh nổi Quote/Translate/Copy-MD — bản sao `.btsel` của WorkspaceBoardThread
   (scoped CSS không tái dùng được; gốc sao chép từ `.selactions` của
   SessionDetail). */
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
