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
        :title="collapsed ? t('sessions.group.expand') : t('sessions.group.collapse')"
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
      <span
        class="sdot"
        :class="{ pulse: session.status === 'streaming' }"
        :style="{ background: statusColor }"
      />
      <input
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
      <span v-if="!editing" class="tm">{{ timeLabel }}</span>
    </div>
    <div class="sub" :style="indentStyle">
      <span v-if="!hideProject" class="tag projtag" style="padding: 1px 6px">{{ projName }}</span>
      <!-- Vai trong nhóm đứng TRƯỚC tên model: khi đã xếp nhóm thì "phiên này làm gì"
           là thứ phân biệt được các hàng, còn model thì thường giống nhau cả nhóm. -->
      <span v-if="session.groupRole" class="rolechip">{{ session.groupRole }}</span>
      <!-- Nhóm này tự giao tin giữa các phiên con. Chỉ hiện trên hàng GỐC (nơi giữ cờ)
           và chỉ khi nó thật sự có con — một phiên lẻ bật cờ thì không có ai để giao. -->
      <span
        v-if="session.groupAutoDeliver && hasChildren"
        class="autochip"
        :title="t('sessions.group.autoDeliverBadgeHint')"
      >
        <Icon name="zap" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ t('sessions.group.autoDeliverBadge') }}
      </span>
      <span class="smeta">{{ session.model }}</span>
      <span v-if="collapsed && descendants" class="smeta">
        {{ t('sessions.group.hiddenCount', { n: descendants }) }}
      </span>
      <!-- Indicators + status badge, grouped on the far right (status rightmost). -->
      <span class="subright">
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
      </span>
    </div>
    <div v-if="!editing" class="liact">
      <span
        class="liactbtn"
        :class="{ on: session.pinned }"
        :title="session.pinned ? t('sessions.sidebar.unpin') : t('sessions.sidebar.pin')"
        @click.stop="store.togglePin(session.id)"
      >
        <Icon name="pin" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </span>
      <span class="liactbtn danger" :title="t('sessions.item.delete')" @click.stop="askRemove">
        <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
// One session row in the list (liHtml ~1243): selection checkbox, pin mark,
// status dot, title, unread mark, time, project tag + model · status, and
// compact indicator chips (attachments / pending follow-ups / queued). Hover
// reveals pin + delete actions. Title supports inline rename (double-click →
// input). Pin / delete / select route to the store; in select mode a row click
// toggles selection instead of opening the session.
import type { Session, SessionStatus } from '~/composables/useSessionsData'

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
    color: 'var(--accent)',
    background: 'var(--accentDim)',
    borderColor: 'var(--accentBorder)',
  },
  awaiting: {
    color: 'var(--amber)',
    background: 'var(--amberDim)',
    borderColor: 'var(--amberBorder)',
  },
  done: { color: 'var(--textMuted)', background: 'transparent', borderColor: 'var(--border)' },
  error: {
    color: 'var(--danger)',
    background: 'var(--dangerDim)',
    borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
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
const indentStyle = computed(() => ({
  paddingLeft: `${Math.min(props.depth ?? 0, 6) * INDENT_PER_LEVEL}px`,
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
const { STATUS_COLOR } = useSessionsData()
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

const statusColor = computed(() => STATUS_COLOR[props.session.status])
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
  background: var(--bgInput);
  color: var(--text);
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-xs);
  padding: 2px 7px;
  outline: none;
  font: inherit;
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
  --li-tint: color-mix(in srgb, var(--accent) 12%, transparent);
}
/* A streaming row is on screen and moving; it does not need a tint to be noticed, and
   at 14% it was indistinguishable from `done` anyway. */
.li.st-streaming {
  --li-tint: transparent;
}
.li.st-awaiting {
  --li-tint: color-mix(in srgb, var(--amber) 16%, transparent);
}
.li.st-error {
  --li-tint: color-mix(in srgb, var(--danger) 14%, transparent);
}
.li.unread:not(.on):not(.sel) {
  background: var(--li-tint, var(--bgHover));
}
.li.unread:not(.on):not(.sel):hover {
  background: var(--bgHover);
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
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.li.nest:not(.on):not(.sel):hover {
  background: var(--bgHover);
}
/* Các hàng trong cụm dính liền nhau: khe 3px giữa hàng sẽ cắt nền thành từng vạch
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
  margin-bottom: 3px;
}
/* ── Nhánh cây nối cha với từng hàng con ──────────────────────────────────────
   Khuôn cây thư mục: thân dọc thả từ nút xoè của hàng cha xuống, tới mỗi hàng con thì
   bo góc rẽ phải vào đúng chấm trạng thái của nó. Bản trước chỉ là một vạch dọc thẳng
   chạy suốt — nó nói được "mấy hàng này cùng một cụm" nhưng không nói được "hàng NÀY
   treo vào hàng KIA".

   Y của khuỷu = tâm dòng tiêu đề: 9px padding-top của `.li` (prototype.css:208) + nửa
   hộp dòng. Lấy `--lh-md` chứ không phải số cố định vì hộp dòng co giãn theo cỡ chữ ở
   Settings → Appearance, mà khuỷu thì phải bám theo chữ.

   ⚠ Hàng CHA không vẽ gì cả. Bản đầu nó thả một đoạn thân cây từ nút xoè xuống hết
   hàng, nhưng đoạn đó chạy dọc sát tiêu đề của chính phiên cha và trông rối — user bác.
   Bỏ đi vẫn liền mạch: đoạn dọc của hàng con bắt đầu ngay mép trên của nó, mà các hàng
   trong cụm đã dính liền nhau nên đường kẻ trông như chui ra từ dưới hàng cha. */
.li.nest-child {
  --nest-elbow: calc(9px + var(--lh-md) / 2);
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
  background: var(--accentBorder);
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
  border-left: 1px solid var(--accentBorder);
  border-bottom: 1px solid var(--accentBorder);
}

/* Nút xoè/thu của chế độ xem "Nhóm". Mũi tên chỉ XUỐNG khi đang xoè và sang PHẢI khi
   thu — cùng quy ước với header nhóm (.grph .gchv) ở SessionList. */
.twisty {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--textFaint);
  transition: transform 0.12s ease;
}
.twisty:hover {
  color: var(--text);
}
.twisty.col {
  transform: rotate(-90deg);
}
/* Vai trong nhóm: chip viền, không nền đặc (cùng quy ước với các chip trạng thái yên
   tĩnh trong hàng — nền đặc dành cho trạng thái cần giành lấy mắt người đọc). */
.rolechip {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-pill);
  color: var(--accent);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Chip "nhóm này tự giao tin". Dùng tông amber như các trạng thái "đang chờ/chú ý"
   khác trong hàng: nó nói một việc SẼ tự xảy ra mà không hỏi, nên nó phải đọc được
   ngay chứ không chìm như chip trung tính. */
.autochip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-pill);
  color: var(--amber);
}

/* Right-aligned group in the sub-row: indicator chips + status badge, badge rightmost. */
.subright {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex: 0 0 auto;
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
  flex: 0 0 auto;
  color: var(--textFaint);
  font-size: 12px;
  line-height: 12px;
  white-space: nowrap;
}
/* Indicator chips: small mono count pills, subtle (§1). Color tokens only — no
   hardcoded hex. Numeric counts use a fixed 12px mono per the badge rule. */
.lind {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lindchip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  line-height: 12px;
  color: var(--textFaint);
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
/* Pin mark is interactive (toggles pin); keep the pointer affordance. */
.pinmark {
  cursor: pointer;
}
/* Row hover actions — ghost pills. Pin hovers to accent (it's a toggle, not
   destructive); only the trash variant goes danger. The shared prototype `.del`
   rule turned BOTH red, so these own classes replace it. */
.liact .liactbtn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  cursor: pointer;
  color: var(--textDim);
  background: var(--bgActive);
  transition:
    color 0.12s,
    background 0.12s;
}
.liact .liactbtn:hover {
  color: var(--accent);
  background: var(--bgHover);
}
.liact .liactbtn.on {
  color: var(--accent);
}
.liact .liactbtn.danger:hover {
  color: var(--danger);
  background: var(--dangerDim, var(--bgHover));
}
</style>
