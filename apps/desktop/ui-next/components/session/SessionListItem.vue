<template>
  <div
    class="li"
    :class="[{ on: active, sel: selected, unread: session.unread }, statusClass, groupClass]"
    :style="railStyle"
    :data-sid="session.id"
    @click="onRowClick"
    @contextmenu.prevent="onCtx"
  >
    <div class="lrow" :style="indentStyle">
      <!-- Nút xoè/thu của chế độ xem "Nhóm". Chỉ hàng CÓ con mới vẽ; hàng không có
           con cũng không chừa chỗ trống cho nó — cột danh sách hẹp, và cái thụt lề
           đã nói đủ về tầng. -->
      <span
        v-if="hasChildren"
        class="twisty"
        :class="{ col: collapsed }"
        :title="collapsed ? t('sessions.team.expand') : t('sessions.team.collapse')"
        @click.stop="emit('toggleChildren')"
      >
        <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </span>
      <!-- Checkbox shows ONLY in select mode (or when already selected) — NOT on
           hover (Select now lives in the right-click context menu). Hidden during
           inline rename so the rename input gets the full row. -->
      <span
        v-if="(selecting || selected) && !editing"
        class="lcbox"
        :class="{ on: selected }"
        :title="t('sessions.sidebar.select')"
        @click.stop="store.toggleSelect(session.id)"
      >
        <Icon v-if="selected" name="check" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </span>
      <span
        v-if="session.pinned && !editing"
        class="pinmark"
        :title="t('sessions.sidebar.pinned')"
        @click.stop="store.togglePin(session.id)"
      >
        <Icon name="pin" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </span>
      <!-- Trạng thái = icon lucide 14px (proto), không phải chấm màu. "Streaming"
           là vòng cung quay QUANH glyph — idiom đã chốt (SessionStepItem), không
           quay chính glyph. -->
      <span class="sic" :class="statusMeta.cls" :title="statusLabel">
        <component :is="statusMeta.icon" :size="14" />
        <span
          v-if="session.status === 'streaming'"
          class="absolute -inset-[3px] animate-spin rounded-full border border-transparent border-t-primary"
        />
      </span>
      <Input
        v-if="editing"
        ref="renameInput"
        v-model="draft"
        class="ttl"
        @click.stop
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
      <span
        v-else
        class="ttl"
        :class="{ unread: session.unread }"
        :title="t('sessions.item.rename')"
        @dblclick.stop="startRename"
      >
        {{ session.title }}
      </span>
      <span v-if="session.unread && !editing" class="undot" :title="t('sessions.item.unread')" />
      <!-- ⋯ từng hàng — cùng bộ thao tác với menu chuột phải (gương proto):
           ghim · chọn · đổi tên · xoá. Reveal khi hover / focus-within / mở. -->
      <DropdownMenu v-if="!editing">
        <DropdownMenuTrigger as-child>
          <span
            role="button"
            tabindex="-1"
            class="ddbtn"
            :title="t('sessions.sidebar.more')"
            :aria-label="t('sessions.sidebar.more')"
            @click.stop
          >
            <Icon name="dots" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" class="w-52">
          <DropdownMenuItem @select="store.togglePin(session.id)">
            <Icon name="pin" />
            {{ session.pinned ? t('sessions.ctx.unpin') : t('sessions.ctx.pin') }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="onSelectToggle">
            <Icon name="check" />
            {{ t('sessions.ctx.select') }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="startRename">
            <Icon name="edit" />
            {{ t('sessions.ctx.rename') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="text-destructive focus:bg-destructive/10 focus:text-destructive"
            @select="askRemove"
          >
            <Icon name="trash" />
            {{ t('sessions.ctx.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div class="sub" :style="subIndentStyle">
      <!-- Thứ tự proto: agent · model (agent = chip pill khi phiên thuộc một
           session-team; chỉ model khi không có). -->
      <span v-if="session.agent" class="agentchip" :title="session.agent.id">
        <Icon name="agents" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="acname">{{ session.agent.id }}</span>
      </span>
      <span class="smeta">{{ session.model }}</span>
      <span v-if="collapsed && descendants" class="smeta">
        {{ t('sessions.team.hiddenCount', { n: descendants }) }}
      </span>
      <!-- Cụm phải của dòng meta: các chip phụ rồi tới `tokens · time` (tabular-nums)
           ở mép phải — cột số thẳng hàng theo proto. -->
      <span class="subright">
        <span v-if="!hideProject" class="tag projtag" style="padding: 1px 6px">{{ projName }}</span>
        <!-- Vai trong nhóm — chip viền accent, NHƯNG giấu khi trùng tiêu đề
             (member spawn từ spec có title ≡ role → chip chỉ lặp lại chữ của
             dòng trên và đẩy badge/time ra khỏi tầm nhìn). Đổi tên phiên thì
             chip hiện lại — lúc đó nó mang thông tin role thật sự. -->
        <span v-if="session.teamRole && session.teamRole !== session.title" class="rolechip">
          {{ session.teamRole }}
        </span>
        <!-- Archived rows are hidden until the list filter asks for them, so this chip
             is the ONLY thing telling them apart once they show up
             (docs/features/cross-session-search.md §3). Deliberately the quietest
             weight in the row — faint text, no fill, no border — so it never competes
             with the title. -->
        <span v-if="archived" class="archchip" :title="t('sessionsSearch.archive.badge')">
          {{ t('sessionsSearch.archive.badge') }}
        </span>
        <!-- Popped out into its own OS window: this row is a pointer, the live view
             is over there (docs/features/session-popout-window.md). -->
        <span
          v-if="store.isWindowed(session.engineId)"
          class="lindchip"
          :title="t('sessions.window.inWindow')"
        >
          <Icon name="external" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </span>
        <span v-if="indicators.length" class="lind">
          <span v-for="ind in indicators" :key="ind.key" class="lindchip" :title="ind.title">
            <Icon :name="ind.icon" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ ind.count }}
          </span>
        </span>
        <span class="statusbadge" :style="badgeStyle">{{ statusLabel }}</span>
        <span class="subtime">
          <span v-if="tokensLabel">{{ tokensLabel }}</span>
          <span>{{ timeLabel }}</span>
        </span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// One session row in the list, restructured to the proto skeleton
// (components/proto/ProtoSessionList.vue): line 1 = status icon · title · unread
// dot · hover ⋯ menu; line 2 (indented under the title) = agent · model on the
// left, chips + status badge + `tokens · time` on the right. Selection checkbox,
// pin mark, group twisty, inline rename (double-click → input), and the
// right-click context menu all unchanged. Pin / delete / select route to the
// store; in select mode a row click toggles selection instead of opening.
import type { Session, SessionStatus } from '~/composables/useSessionsData'
import { CircleCheck, CircleHelp, CircleX, FileText, Loader2 } from 'lucide-vue-next'
import { formatTokenCount } from '~/utils/context-window'
import Input from '~/components/ui/input/Input.vue'

// Status badge palette — mirrors the app's node-badge convention (.bdg.run / .nx.ok =
// accent, .bdg.wait = amber): done + running use accent (complete/active), waiting amber,
// error danger, draft a neutral chip (a not-yet-run state carries no alert color). Token
// trios only — no hardcoded hex; danger has no *Border token so its border is color-mixed.
const BADGE_STYLE: Record<
  SessionStatus,
  { color: string; background: string; borderColor: string }
> = {
  // Weight follows how urgently a row wants your eye:
  //   awaiting > error > streaming  — loud, colour-coded
  //   done > idle                   — quiet outline chips
  // `done` used to carry the exact same accent fill as `streaming`, so a list where
  // everything had finished was a solid column of brand colour and the one session
  // actually running could not be picked out. Neutral is what makes the loud states
  // readable; muting `done` BUYS scannability rather than spending it.
  idle: { color: 'var(--textFaint)', background: 'transparent', borderColor: 'var(--border)' },
  streaming: {
    color: 'var(--primary)',
    background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
    borderColor: 'color-mix(in srgb, var(--primary) 42%, transparent)',
  },
  awaiting: {
    color: 'var(--warning)',
    background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
    borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)',
  },
  done: {
    color: 'var(--muted-foreground)',
    background: 'transparent',
    borderColor: 'var(--border)',
  },
  error: {
    color: 'var(--destructive)',
    background: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
    borderColor: 'color-mix(in srgb, var(--destructive) 40%, transparent)',
  },
}

const props = defineProps<{
  session: Session
  active: boolean
  selecting: boolean
  // Hide the project chip — redundant when the list is grouped by project (the
  // group header already names it), and frees the sub-row so it stays one line.
  hideProject?: boolean
  // Rename signal from the parent context menu: when `.id` matches this row, the
  // inline rename starts. `n` (nonce) lets the same row be re-triggered.
  renameReq?: { id: number; n: number }
  // ── Chế độ xem "Nhóm" (cây) — mặc định 0/false nên mọi chế độ khác không đổi gì ──
  // Tầng trong cây, chỉ dùng để thụt lề.
  depth?: number
  // Có phiên con ⇒ vẽ nút xoè/thu ở đầu hàng.
  hasChildren?: boolean
  collapsed?: boolean
  // Số con cháu đang bị giấu khi hàng này thu gọn.
  descendants?: number
  // Hàng này thuộc một CỤM (phiên cha có con, hoặc một phiên con) ⇒ vẽ nền nhóm.
  // Ba cờ do useSessionTree tính; mọi chế độ xem khác không truyền nên không đổi gì.
  inGroup?: boolean
  groupTop?: boolean
  groupBottom?: boolean
}>()
const emit = defineEmits<{
  // Right-click → ask the parent to open the session context menu at the cursor.
  ctxmenu: [payload: { id: number; x: number; y: number }]
  // Bấm nút xoè/thu của một hàng cha trong chế độ xem "Nhóm".
  toggleChildren: []
}>()

// Thụt lề theo tầng. Kẹp ở tầng 6: sâu hơn nữa thì cột danh sách (hẹp tới 240px) chỉ
// còn lại vài chục pixel cho tiêu đề — cây vẫn đúng, chỉ là không thụt thêm nữa.
const INDENT_PER_LEVEL = 14
const depthPad = computed(() => Math.min(props.depth ?? 0, 6) * INDENT_PER_LEVEL)
const indentStyle = computed(() => ({
  paddingLeft: `${depthPad.value}px`,
}))

// ⚠ KHÔNG đặt tên `grp`: prototype.css đã có một class TOÀN CỤC tên đó cho header
// của các chế độ gom nhóm khác, và nó mang `.grp + .grp{margin-top:11px}` (dòng 513).
// Hai hàng liền nhau trong cụm đều dính class ấy ⇒ mỗi hàng bị đẩy xuống 11px và cụm
// vỡ thành từng mảnh rời — đúng cái khe mà `margin-bottom: 0` vừa khử xong. Lỗi thật,
// người dùng chụp màn hình báo. Tiền tố `nest-` không trùng gì trong repo.
const groupClass = computed(() => ({
  nest: !!props.inGroup,
  'nest-top': !!props.groupTop,
  'nest-bot': !!props.groupBottom,
  'nest-child': !!props.inGroup && (props.depth ?? 0) > 0,
}))

// Toạ độ X của ĐƯỜNG RAY nối cha với các con, tính cho khớp TÂM nút xoè của hàng cha:
// 10px padding trái của `.li` + 7px nửa nút xoè (rộng 14) = 17px ở tầng 1, cộng thêm
// một bậc thụt lề cho mỗi tầng sâu hơn. Tính bằng số chứ không ghim hằng số trong CSS
// vì cả ba con số trên đều nằm ở chỗ khác và sẽ trôi khỏi nhau.
const LI_PAD_X = 10
const TWISTY_HALF = 7
const railStyle = computed(() => {
  const depth = Math.min(props.depth ?? 0, 6)
  // Chỉ hàng CON vẽ đường kẻ. Hàng cha từng thả một đoạn thân cây xuống cho khớp với
  // con, nhưng đoạn đó chạy dọc ngay cạnh tiêu đề của chính nó và trông rối — user bác.
  // Bỏ đi không mất mạch: đoạn dọc của con bắt đầu ngay mép trên hàng con, mà các hàng
  // trong cụm dính liền nhau nên nó vẫn như chui ra từ dưới hàng cha.
  if (!props.inGroup || depth < 1) return undefined
  return { '--grp-rail-x': `${LI_PAD_X + (depth - 1) * INDENT_PER_LEVEL + TWISTY_HALF}px` }
})

const { t } = useI18n()
const { projectName } = useProjects()
const store = useSessionsStore()
const { confirm } = useConfirm()

// Delete is destructive + unrecoverable (drops the JSONL transcript) → confirm first.
async function askRemove() {
  const ok = await confirm({
    title: t('sessions.delete.title'),
    description: t('sessions.delete.one', { title: props.session.title }),
  })
  if (ok) store.remove(props.session.id)
}

// LIVE relative-time label derived from the raw `updatedAt` + a shared ticking clock,
// so an untouched row's "3m → 2h → 1d" advances on its own instead of freezing at its
// hydrate-time value. Falls back to the snapshot `when` when no updatedAt is known.
const now = useNow()
const timeLabel = computed(() =>
  props.session.updatedAt ? relativeTime(props.session.updatedAt, now.value) : props.session.when,
)

// Status icon per status — proto's row icon (ProtoSessionList `statusMeta`) with
// the lucide 0.460 names. Colors ride the standard tokens (success / primary /
// warning / destructive / muted-foreground); the dot they replace carried the
// same hues via STATUS_COLOR.
const STATUS_META: Record<SessionStatus, { icon: typeof CircleCheck; cls: string }> = {
  idle: { icon: FileText, cls: 'text-muted-foreground' },
  streaming: { icon: Loader2, cls: 'text-primary' },
  awaiting: { icon: CircleHelp, cls: 'text-warning' },
  done: { icon: CircleCheck, cls: 'text-success' },
  error: { icon: CircleX, cls: 'text-destructive' },
}
const statusMeta = computed(() => STATUS_META[props.session.status])
const statusLabel = computed(() => t(`sessions.status.${props.session.status}`))
// Drives the status-tinted row background (see the `.st-*` rules) — a clearer
// at-a-glance signal than the tiny status dot, which for `done` is near-invisible.
const statusClass = computed(() => `st-${props.session.status}`)
// Badge fill/text/border per status (see BADGE_STYLE). Kept separate from the dot's
// STATUS_COLOR so the badge can read as a proper colored chip while the dot stays muted.
const badgeStyle = computed(() => BADGE_STYLE[props.session.status])
// session.project holds the engine projectId; show the resolved display name.
const projName = computed(() => projectName(props.session.project))
const selected = computed(() => store.selectedIds.has(props.session.id))
// Archived state lives in the store as a set of client ids, NOT as a field on Session
// (docs/features/cross-session-search.md §3.2) — read it through the getter.
const archived = computed(() => store.isArchived(props.session.id))

// Compact item indicators (§1): attachment / pending follow-up / queued counts.
// Only chips with count > 0 are rendered.
type Indicator = { key: string; icon: string; count: number; title: string }
const indicators = computed<Indicator[]>(() => {
  const out: Indicator[] = []
  // Only scan messages for the attachment count once the transcript is loaded. An
  // unloaded session has no msgs (att would be 0 anyway), so skipping the reduce keeps
  // the many unopened list rows from taking a reactive dependency on their msgs array.
  const att = props.session.loaded
    ? props.session.msgs.reduce(
        (sum, m) => sum + (m.role === 'user' && m.att ? m.att.length : 0),
        0,
      )
    : 0
  if (att > 0)
    out.push({
      key: 'att',
      icon: 'clip',
      count: att,
      title: t('sessions.sidebar.attachments', { n: att }),
    })
  const fu = props.session.followups?.length ?? 0
  if (fu > 0)
    out.push({
      key: 'fu',
      icon: 'quote',
      count: fu,
      title: t('sessions.sidebar.followups', { n: fu }),
    })
  const qd = props.session.queue?.length ?? 0
  if (qd > 0)
    out.push({
      key: 'qd',
      icon: 'clock',
      count: qd,
      title: t('sessions.sidebar.queued', { n: qd }),
    })
  return out
})

// Row click: in select mode toggle selection (and swallow the click so the
// parent's `select` handler doesn't also open the session). Outside select mode
// the click bubbles to the parent which emits `select`.
function onRowClick(e: MouseEvent) {
  if (props.selecting) {
    e.stopPropagation()
    store.toggleSelect(props.session.id)
  }
}

// ⋯ menu "Select" — same semantics as the context-menu item: enter select mode
// and toggle this row into the selection.
function onSelectToggle() {
  store.setSelectMode(true)
  store.toggleSelect(props.session.id)
}

// Inline rename: local UI state; the renamed value is committed to the store.
const editing = ref(false)
const draft = ref('')
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')

function startRename() {
  draft.value = props.session.title
  editing.value = true
  nextTick(() => renameInput.value?.focus())
}
function commitRename() {
  if (!editing.value) return
  editing.value = false
  store.rename(props.session.id, draft.value)
}
function cancelRename() {
  editing.value = false
}

// Dòng meta thụt vào để chữ bắt đầu ngay dưới tiêu đề (proto `pl-[22px]` = icon
// 14px + gap 8px). Mỗi phần tử đứng đầu hàng 1 (twisty 14 · lcbox 16 · pinmark
// 12, kèm gap 8 của `.lrow`) đẩy tiêu đề sang phải, nên `.sub` cộng đúng bề rộng
// của chúng để căn giữ nguyên — kể cả khi select mode bật hay hàng được ghim.
// `editing` giấy lcbox/pinmark nên indent co lại theo.
const subIndentStyle = computed(() => {
  let lead = 22 // status icon column: icon 14 + lrow gap 8
  if (props.hasChildren) lead += 14 + 8 // .twisty + gap
  if ((props.selecting || selected.value) && !editing.value) lead += 16 + 8 // .lcbox + gap
  if (props.session.pinned && !editing.value) lead += 12 + 8 // .pinmark + gap
  return { paddingLeft: `${depthPad.value + lead}px` }
})

// `tokens` của proto: session.usage có contextTokens (độ đầy context đo được của
// request cuối) — giá trị gần nghĩa nhất với "tokens" của hàng; sessions cũ thiếu
// nó thì fallback sang `total` (tally API tích luỹ), không có gì thì chỉ hiện time.
const tokensLabel = computed(() => {
  const u = props.session.usage
  const n = (u?.contextTokens && u.contextTokens > 0 ? u.contextTokens : u?.total) ?? 0
  return n > 0 ? formatTokenCount(n) : ''
})

// Right-click → bubble the cursor position up so the parent shows one shared menu.
function onCtx(e: MouseEvent) {
  emit('ctxmenu', { id: props.session.id, x: e.clientX, y: e.clientY })
}
// Parent context menu "Rename" → start this row's inline edit when targeted.
watch(
  () => props.renameReq,
  (r) => {
    if (r && r.id === props.session.id) startRename()
  },
)
</script>

<style scoped>
/* Inline rename field: a native <input> reusing .ttl would render on the browser
   default WHITE box, so its theme-light text was white-on-white in dark mode. Pin
   it to theme tokens (dark surface + readable text + accent focus ring). */
input.ttl {
  background: var(--muted);
  color: var(--foreground);
  border: 1px solid var(--input);
  border-radius: var(--r-xs);
  padding: 2px 7px;
  outline: none;
  font: inherit;
}
input.ttl:focus-visible {
  border-color: transparent;
  box-shadow: 0 0 0 1px var(--ring);
}

/* UNREAD rows get a status-colored background so a session that settled or produced
   output while you weren't looking stands out (the tiny status dot — `textFaint` for
   `done` — was easy to miss). ONLY unread rows are tinted, so a long, mostly-read list
   stays calm; the tint color still says what happened (accent = done, amber = needs
   input, danger = failed). Each status sets `--li-tint`; the `.unread` rule paints it,
   hover falls back to the standard surface. Gated `:not(.on):not(.sel)` so the active /
   selected rows keep their own accent treatment. Read rows keep the plain list styling. */
/* `done` keeps its accent tint here even though the BADGE went neutral: the tint only
   paints UNREAD rows, so it means "this finished while you were away" — a real signal,
   unlike the badge, which shows on every row forever. */
.li.st-done {
  --li-tint: color-mix(in srgb, var(--primary) 12%, transparent);
}
/* A streaming row is on screen and moving; it does not need a tint to be noticed, and
   at 14% it was indistinguishable from `done` anyway. */
.li.st-streaming {
  --li-tint: transparent;
}
.li.st-awaiting {
  --li-tint: color-mix(in srgb, var(--warning) 16%, transparent);
}
.li.st-error {
  --li-tint: color-mix(in srgb, var(--destructive) 14%, transparent);
}
.li.unread:not(.on):not(.sel) {
  background: var(--li-tint, var(--accent-wash));
}

/* ── Selection = neutral wash (shadcn idiom), never an emerald fill ─────────────
   Proto: active row = `bg-accent` (the --accent-wash surface), inactive hover =
   `bg-accent/50`. The global `.li` rules paint `--bgHover` (= the same wash) at
   full strength on hover and an accentDim+inset-bar on `.on`; these overrides
   install the 55%-wash hover and replace the emerald active state with the flat
   wash — no border, no left bar. `.sel` (multi-select) shares the same wash. */
.li:not(.on):not(.sel):hover {
  background: color-mix(in srgb, var(--accent-wash) 55%, transparent);
}
.li.on {
  background: var(--accent-wash);
  border-color: transparent;
  box-shadow: none;
}
.li.sel {
  background: var(--accent-wash);
}
/* Row density — proto `rounded-lg px-2.5 py-2` in a `gap-0.5` column: vertical
   padding 8px (was 9), inter-row gap 2px (was 3), and NO border (the 1px
   transparent frame was 2px of dead height no state paints on the zinc themes —
   Cute re-adds its own border via `body[cute] :is(.li)`, which outranks this
   scoped block, so its mint active card keeps working). */
.li {
  padding: 8px 10px;
  margin-bottom: 2px;
  border: none;
  transition: background-color 0.12s ease;
}
/* The select checkbox keeps the accent (it is a toggle state, not a selection
   surface): --input at rest, primary when checked. */
.li .lcbox {
  border-color: var(--input);
}
.li .lcbox.on {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
}
/* Meta row: muted-foreground per the proto item (was one step dimmer). */
.li .sub {
  color: var(--muted-foreground);
}
/* The unread glyph is a primary marker (same value as the old --accent). */
.li .undot {
  background: var(--primary);
}

/* ── Cụm nhóm trong chế độ xem "Nhóm" ────────────────────────────────────────
   Nhóm đọc được thành MỘT khối: nền accent rất nhạt ôm cả cha lẫn con, bo góc ở
   hai đầu, cộng một đường ray dọc nối chúng lại.

   Nền 6% (không phải xám đặc): nền xám cho một vùng lớn làm cột danh sách trông
   như bị disable, và `--bgActive` đã dành cho thứ khác. `:not(.on):not(.sel)` là
   BẮT BUỘC — rule scoped mang thêm một lớp attribute nên nó thắng `.li.on` toàn
   cục, và nếu không loại trừ thì hàng đang chọn trong nhóm mất hẳn accent-tint.
   Cặp `:hover` đi kèm cũng vì lý do đó (cùng khuôn với `.li.unread` bên dưới). */
.li.nest:not(.on):not(.sel) {
  background: color-mix(in srgb, var(--primary) 6%, transparent);
}
.li.nest:not(.on):not(.sel):hover {
  background: color-mix(in srgb, var(--accent-wash) 55%, transparent);
}
/* Các hàng trong cụm dính liền nhau: khe 2px giữa hàng sẽ cắt nền thành từng vạch
   rời và phá đúng cái cảm giác "một khối". Khe chỉ trả lại DƯỚI hàng cuối cụm.
   `margin-top: 0` là bắt buộc chứ không thừa: `.li` không tự đặt margin-top, nhưng
   một class trùng tên toàn cục đã từng bơm 11px vào đây (xem chú thích ở `groupClass`)
   — khai tường minh thì lần sau có ai đặt lại cũng không lọt qua. */
.li.nest {
  margin-top: 0;
  margin-bottom: 0;
  border-radius: 0;
}
.li.nest.nest-top {
  border-top-left-radius: var(--r-sm);
  border-top-right-radius: var(--r-sm);
}
.li.nest.nest-bot {
  border-bottom-left-radius: var(--r-sm);
  border-bottom-right-radius: var(--r-sm);
  margin-bottom: 2px;
}
/* ── Nhánh cây nối cha với từng hàng con ──────────────────────────────────────
   Khuôn cây thư mục: thân dọc thả từ nút xoè của hàng cha xuống, tới mỗi hàng con thì
   bo góc rẽ phải vào đúng chấm trạng thái của nó. Bản trước chỉ là một vạch dọc thẳng
   chạy suốt — nó nói được "mấy hàng này cùng một cụm" nhưng không nói được "hàng NÀY
   treo vào hàng KIA".

   Y của khuỷu = tâm dòng tiêu đề: 8px padding-top của `.li` (rule scoped trên —
   proto `py-2`) + nửa hộp dòng. Lấy `--lh-md` chứ không phải số cố định vì hộp
   dòng co giãn theo cỡ chữ ở Settings → Appearance, mà khuỷu thì phải bám theo chữ.

   ⚠ Hàng CHA không vẽ gì cả. Bản đầu nó thả một đoạn thân cây từ nút xoè xuống hết
   hàng, nhưng đoạn đó chạy dọc sát tiêu đề của chính phiên cha và trông rối — user bác.
   Bỏ đi vẫn liền mạch: đoạn dọc của hàng con bắt đầu ngay mép trên của nó, mà các hàng
   trong cụm đã dính liền nhau nên đường kẻ trông như chui ra từ dưới hàng cha. */
.li.nest-child {
  --nest-elbow: calc(8px + var(--lh-md) / 2);
}
/* Thân dọc nối xuống hàng con KẾ TIẾP. Hàng con CUỐI không có — một đường kẻ thõng
   xuống dưới mà không nối vào đâu là rác thị giác.

   Nối đúng tại khuỷu, không cần chờm lên: góc VUÔNG nên cạnh dọc của khuỷu chạy trọn
   xuống tới `--nest-elbow` rồi mới gãy ngang. (Bản bo góc trước đó phải bắt đầu sớm
   hơn một bán kính, vì trong khoảng cong thân cây bị khuyết một khấc.) */
.li.nest-child:not(.nest-bot)::after {
  content: '';
  position: absolute;
  left: var(--grp-rail-x);
  top: var(--nest-elbow);
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--primary) 42%, transparent);
}
/* Khuỷu rẽ vào hàng con: dọc từ mép trên hàng xuống khuỷu rồi gãy VUÔNG sang phải,
   dừng đúng mép trái chấm trạng thái (17px + 7px = 24px = `.li` padding 10 + thụt lề
   14). Vẫn vẽ bằng border của MỘT hộp (trái + dưới) chứ không phải hai vạch rời: một
   hộp thì hai cạnh tự gặp nhau đúng góc, hai vạch thì phải tự căn và lệch nửa pixel là
   thấy ngay. Góc để vuông — không `border-*-radius` — theo yêu cầu. */
.li.nest-child::before {
  content: '';
  position: absolute;
  left: var(--grp-rail-x);
  top: 0;
  width: 7px;
  height: var(--nest-elbow);
  border-left: 1px solid color-mix(in srgb, var(--primary) 42%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--primary) 42%, transparent);
}

/* Nút xoè/thu của chế độ xem "Nhóm". Mũi tên chỉ XUỐNG khi đang xoè và sang PHẢI khi
   thu — cùng quy ước với header nhóm (.grph .gchv) ở SessionList. */
.twisty {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--muted-foreground);
  transition: transform 0.12s ease;
}
.twisty:hover {
  color: var(--foreground);
}
.twisty.col {
  transform: rotate(-90deg);
}
/* Vai trong nhóm: chip viền, không nền đặc (cùng quy ước với các chip trạng thái yên
   tĩnh trong hàng — nền đặc dành cho trạng thái cần giành lấy mắt người đọc). */
.rolechip {
  flex: 0 1 auto;
  min-width: 0;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--primary) 42%, transparent);
  border-radius: var(--r-pill);
  color: var(--primary);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Chip AGENT của session-teams: trung tính (muted) thay vì accent — rolechip đã
   là nhãn "vai" cần giật mắt; agent id chỉ là tham chiếu kỹ thuật kèm theo.
   `0 1 auto` + .acname ellipsis: id spec dài co về "product-deli…" thay vì đẩy
   cụm phải ra ngoài. */
.agentchip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 1 auto;
  min-width: 0;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  color: var(--muted-foreground);
  max-width: 40%;
  overflow: hidden;
  white-space: nowrap;
}
.agentchip .acname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Status icon — proto row glyph (14px, lucide). The wrapper gives the streaming
   arc ring (-inset-[3px], spans the full circle) a positioned parent without
   changing the row's 8px rhythm. */
.sic {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}
/* Per-row ⋯ trigger — proto idiom: always laid out (no layout jump) but
   transparent until the row is hovered/focused or the menu is open (reka marks
   the trigger data-state=open). In-flow at the right edge of the title line —
   the old .liact absolute pin/trash pair is gone; this menu covers both. */
.ddbtn {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  flex: 0 0 auto;
  border-radius: var(--r-xs);
  color: var(--muted-foreground);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    color 0.12s,
    background 0.12s;
}
.li:hover .ddbtn,
.li:focus-within .ddbtn,
.ddbtn[data-state='open'] {
  opacity: 1;
}
.ddbtn:hover {
  color: var(--foreground);
  background: color-mix(in srgb, var(--accent-foreground) 10%, transparent);
}
.ddbtn .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
/* Right-aligned group in the sub-row: aux chips + status badge + `tokens · time`
   (the title-line timestamp moved here per the proto skeleton — tabular numbers
   at the row's right edge so the column of times stays put). `0 1 auto` +
   min-width 0: cụm này CO được — chip phụ ellipsize/clip trước, badge + time
   (flex-none) luôn sống ở mép phải thay vì cả cụm tràn khỏi hàng. */
.subright {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}
.subtime {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
/* Status chip: colored text + tint fill + border (bound inline via badgeStyle). Radius 5px
   + 12px mono match the app's .bdg node-badge convention, not the round .tag pill. */
.statusbadge {
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid;
  border-radius: var(--r-xs);
  font-size: 12px;
  line-height: 12px;
  white-space: nowrap;
}
/* "Archived" chip: same fixed 12px as the other sub-row chips (a badge must not grow
   with the Appearance base size), faint text, no fill and no border so it stays a
   whisper next to the status badge. Sentence case, system font — not a technical tag. */
.archchip {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--textFaint);
  font-size: 12px;
  line-height: 12px;
  white-space: nowrap;
}
/* Indicator chips: small mono count pills, subtle (§1). Color tokens only — no
   hardcoded hex. Numeric counts use a fixed 12px mono per the badge rule.
   NON-SHRINKING như statusbadge: số đếm (queued/followup/attachments) là DATA —
   co chip sẽ clip mất số, chỉ còn icon trông như vỡ. */
.lind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.lindchip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 12px;
  white-space: nowrap;
  color: var(--muted-foreground);
}
/* Keep the meta sub-row on a SINGLE line: never wrap, and let the two text parts
   shrink + ellipsis instead of pushing to a second line. Project chip is capped
   (secondary info) so the model · status — the more useful part — keeps its room. */
.sub {
  flex-wrap: nowrap;
  min-width: 0;
}
.projtag {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smeta {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Pin mark is interactive (toggles pin); keep the pointer affordance. Pin itself
   is a warning-amber marker (same value as the old --amber pin). */
.pinmark {
  cursor: pointer;
  color: var(--warning);
}
@media (prefers-reduced-motion: reduce) {
  .ddbtn {
    transition: none;
  }
}
</style>
