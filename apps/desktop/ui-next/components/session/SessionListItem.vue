<template>
  <!-- Hàng phiên — proto `rounded-lg px-2.5 py-2` trong cột `gap-0.5`, không viền.
       Nền theo trạng thái do `rowClass` quyết (xem script). -->
  <div
    class="group/li relative cursor-pointer px-2.5 py-2 transition-colors motion-reduce:transition-none"
    :class="rowClass"
    :style="railStyle"
    :data-sid="session.id"
    @click="onRowClick"
    @contextmenu.prevent="onCtx"
  >
    <div class="flex items-center gap-2" :style="indentStyle">
      <!-- Nút xoè/thu của chế độ xem "Nhóm". Chỉ hàng CÓ con mới vẽ; hàng không có
           con cũng không chừa chỗ trống cho nó — cột danh sách hẹp, và cái thụt lề
           đã nói đủ về tầng. Mũi tên chỉ XUỐNG khi xoè, sang PHẢI khi thu — cùng quy
           ước với header nhóm ở SessionList. -->
      <span
        v-if="hasChildren"
        class="grid size-3.5 flex-none place-items-center text-muted-foreground transition-transform hover:text-foreground motion-reduce:transition-none"
        :class="[collapsed ? '-rotate-90' : '']"
        :title="collapsed ? t('sessions.team.expand') : t('sessions.team.collapse')"
        @click.stop="emit('toggleChildren')"
      >
        <Icon name="chev" class="size-3" />
      </span>
      <!-- Checkbox shows ONLY in select mode (or when already selected) — NOT on
           hover (Select now lives in the right-click context menu). Hidden during
           inline rename so the rename input gets the full row. -->
      <Checkbox
        v-if="(selecting || selected) && !editing"
        :model-value="selected"
        :title="t('sessions.sidebar.select')"
        @update:model-value="store.toggleSelect(session.id)"
        @click.stop
      />
      <!-- Dấu ghim bấm được (bỏ ghim) — marker hổ phách. -->
      <span
        v-if="session.pinned && !editing"
        class="grid flex-none cursor-pointer place-items-center text-warning"
        :title="t('sessions.sidebar.pinned')"
        @click.stop="store.togglePin(session.id)"
      >
        <Icon name="pin" class="size-3" />
      </span>
      <!-- Trạng thái = icon lucide 14px (proto), không phải chấm màu. "Streaming"
           là vòng cung quay QUANH glyph — idiom đã chốt (SessionStepItem), không
           quay chính glyph. -->
      <span
        class="relative inline-flex size-3.5 flex-none items-center justify-center"
        :class="statusMeta.cls"
        :title="statusLabel"
      >
        <component :is="statusMeta.icon" class="size-3.5" />
        <span
          v-if="session.status === 'streaming'"
          class="absolute -inset-0.75 animate-spin rounded-full border border-transparent border-t-primary"
        />
      </span>
      <Input
        v-if="editing"
        ref="renameInput"
        v-model="draft"
        class="h-auto min-w-0 flex-1 rounded-sm bg-muted px-1.75 py-0.5 text-base"
        @click.stop
        @keydown.enter.prevent="commitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="commitRename"
      />
      <span
        v-else
        class="min-w-0 flex-1 truncate text-base"
        :class="titleClass"
        :title="t('sessions.item.rename')"
        @dblclick.stop="startRename"
      >
        {{ session.title }}
      </span>
      <Loader2
        v-if="store.titleGenerating.has(session.id) && !editing"
        class="size-3 flex-none animate-spin text-primary"
      />
      <span
        v-if="session.unread && !editing"
        class="size-1.75 flex-none rounded-full bg-primary"
        :title="t('sessions.item.unread')"
      />
      <!-- ⋯ từng hàng — mở ĐÚNG menu chuột phải chung của danh sách (emit
           `ctxmenu` lên parent như right-click). Trước đây là một DropdownMenu
           reka riêng: modal mặc định của nó khoá `pointer-events` trên body và
           có thể kẹt khoá nếu không dismiss được → toàn màn hình chết click.
           Menu chung không modal, có backdrop + wheel để đóng, và vốn là tập cha
           của các mục này (ghim · chọn · đổi tên · xoá + thêm nhiều thao tác
           khác). Luôn chiếm chỗ (không nhảy layout) nhưng trong suốt tới khi
           hover/focus hàng hoặc menu đang mở (`data-state=open`). -->
      <Button
        v-if="!editing && !noMenu"
        variant="ghost"
        size="iconSm"
        tabindex="-1"
        class="ml-auto size-5 flex-none rounded-sm text-muted-foreground opacity-0 transition-opacity group-focus-within/li:opacity-100 group-hover/li:opacity-100 hover:bg-accent-foreground/10 hover:text-foreground data-[state=open]:opacity-100 motion-reduce:transition-none"
        :data-state="menuOpen ? 'open' : 'closed'"
        :title="t('sessions.sidebar.more')"
        :aria-label="t('sessions.sidebar.more')"
        @click.stop="onDots"
      >
        <Icon name="dots" />
      </Button>
    </div>
    <!-- Dòng meta giữ MỘT dòng: không xuống dòng, hai phần chữ co + cắt "…". -->
    <div
      class="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 text-xs text-muted-foreground"
      :style="subIndentStyle"
    >
      <!-- Thứ tự proto: agent · model (agent = chip pill khi phiên thuộc một
           session-team; chỉ model khi không có). Chip agent trung tính — rolechip mới
           là nhãn "vai" cần giật mắt; agent id chỉ là tham chiếu kỹ thuật, co về
           "product-deli…" thay vì đẩy cụm phải ra ngoài. -->
      <span
        v-if="session.agent"
        class="inline-flex max-w-2/5 min-w-0 shrink items-center gap-0.75 overflow-hidden rounded-full border px-1.5 py-px whitespace-nowrap"
        :title="session.agent.id"
      >
        <Icon name="agents" class="size-3" />
        <span class="min-w-0 truncate">{{ session.agent.id }}</span>
      </span>
      <span class="min-w-0 shrink truncate">{{ session.model }}</span>
      <span v-if="collapsed && descendants" class="min-w-0 shrink truncate">
        {{ t('sessions.team.hiddenCount', { n: descendants }) }}
      </span>
      <!-- Cụm phải của dòng meta: các chip phụ rồi tới `tokens · time` (tabular-nums)
           ở mép phải — cột số thẳng hàng theo proto. Cụm này CO được — chip phụ cắt
           trước, badge + time (flex-none) luôn ở mép phải. -->
      <span class="ml-auto inline-flex min-w-0 shrink items-center gap-1.5 overflow-hidden">
        <!-- Chip project bị trần (thông tin phụ) để model · status giữ chỗ. -->
        <span
          v-if="!hideProject"
          class="min-w-0 max-w-[46%] shrink truncate rounded-sm border px-1.5 py-px font-medium whitespace-nowrap"
        >
          {{ projName }}
        </span>
        <!-- Vai trong nhóm — chip viền accent, NHƯNG giấu khi trùng tiêu đề
             (member spawn từ spec có title ≡ role → chip chỉ lặp lại chữ của
             dòng trên và đẩy badge/time ra khỏi tầm nhìn). Đổi tên phiên thì
             chip hiện lại — lúc đó nó mang thông tin role thật sự. -->
        <span
          v-if="session.teamRole && session.teamRole !== session.title"
          class="max-w-2/5 min-w-0 shrink truncate rounded-full border border-primary/42 px-1.5 py-px whitespace-nowrap text-primary"
        >
          {{ session.teamRole }}
        </span>
        <!-- Archived rows are hidden until the list filter asks for them, so this chip
             is the ONLY thing telling them apart once they show up
             (docs/features/cross-session-search.md §3). Deliberately the quietest
             weight in the row — faint text, no fill, no border — so it never competes
             with the title. -->
        <span
          v-if="archived"
          class="min-w-0 shrink truncate whitespace-nowrap text-faint"
          :title="t('sessionsSearch.archive.badge')"
        >
          {{ t('sessionsSearch.archive.badge') }}
        </span>
        <!-- Imported from Claude Desktop / CLI (docs/features/claude-session-import.md). -->
        <span
          v-if="session.importedFrom"
          :class="IND_CHIP"
          :title="
            session.importedFrom.kind === 'cli'
              ? t('sessions.claudeImport.badge.cli')
              : t('sessions.claudeImport.badge.desktop')
          "
        >
          <Icon name="download" class="size-3" />
          {{
            session.importedFrom.kind === 'cli'
              ? t('sessions.claudeImport.srcCli')
              : t('sessions.claudeImport.srcDesktop')
          }}
        </span>
        <!-- Popped out into its own OS window: this row is a pointer, the live view
             is over there (docs/features/session-popout-window.md). -->
        <span
          v-if="store.isWindowed(session.engineId)"
          :class="IND_CHIP"
          :title="t('sessions.window.inWindow')"
        >
          <Icon name="external" class="size-3" />
        </span>
        <!-- Chip đếm (queued/followup/attachments) KHÔNG co — số là dữ liệu, co chip
             sẽ cắt mất số, chỉ còn icon trông như vỡ. -->
        <span v-if="indicators.length" class="inline-flex flex-none items-center gap-1.5">
          <span v-for="ind in indicators" :key="ind.key" :class="IND_CHIP" :title="ind.title">
            <Icon :name="ind.icon" class="size-3" />
            {{ ind.count }}
          </span>
        </span>
        <span
          class="flex-none rounded-sm border px-1.75 py-0.5 whitespace-nowrap"
          :class="badgeClass"
        >
          {{ statusLabel }}
        </span>
        <span
          class="inline-flex flex-none items-center gap-2 whitespace-nowrap text-muted-foreground tabular-nums"
        >
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
// accent, .bdg.wait = amber): running uses accent (active), waiting amber, error
// danger, done + draft a neutral outline chip (a not-yet-run state carries no alert
// color). Chữ màu + nền nhạt + viền cùng một màu, qua utility ngữ nghĩa.
//
// Weight follows how urgently a row wants your eye:
//   awaiting > error > streaming  — loud, colour-coded
//   done > idle                   — quiet outline chips
// `done` used to carry the exact same accent fill as `streaming`, so a list where
// everything had finished was a solid column of brand colour and the one session
// actually running could not be picked out. Neutral is what makes the loud states
// readable; muting `done` BUYS scannability rather than spending it.
const BADGE_CLASS: Record<SessionStatus, string> = {
  idle: 'border-border text-faint',
  streaming: 'border-primary/42 bg-primary/14 text-primary',
  awaiting: 'border-warning/40 bg-warning/12 text-warning',
  done: 'border-border text-muted-foreground',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
}

// Chip phụ cụm phải (import / cửa sổ riêng / đếm): icon + chữ nhỏ, không co.
const IND_CHIP =
  'inline-flex flex-none items-center gap-0.75 text-sm whitespace-nowrap text-muted-foreground'

// Nền hàng UNREAD theo trạng thái, để phiên vừa xong / ra output lúc bạn không nhìn
// nổi lên (chấm trạng thái nhỏ — `textFaint` cho `done` — rất dễ sót). CHỈ hàng chưa
// đọc mới tô, nên một danh sách dài đa phần đã đọc vẫn yên; màu tô vẫn nói chuyện gì
// đã xảy ra (accent = xong, amber = cần nhập, danger = lỗi).
// `done` giữ tint accent dù BADGE đã trung tính: tint chỉ tô hàng UNREAD nên nó nghĩa là
// "xong trong lúc bạn vắng mặt" — tín hiệu thật, khác badge hiện mãi trên mọi hàng.
// Hàng streaming đang chạy trên màn hình, không cần tint để được chú ý.
const UNREAD_TINT: Record<SessionStatus, string> = {
  idle: 'bg-accent',
  streaming: '',
  awaiting: 'bg-warning/16',
  done: 'bg-primary/12',
  error: 'bg-destructive/14',
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
  // Menu chuột phải chung đang mở TRÊN đúng hàng này (parent truyền `ctx.session.id`).
  // Giữ nút ⋯ hiện (data-state=open) thay vì biến mất khi hover rời hàng — cùng
  // hiệu ứng với `data-state` mà reka trigger cũ từng đặt.
  menuOpen?: boolean
  // Bề mặt không có menu chuột phải (vd bong bóng chọn phiên trên màn infra)
  // truyền cờ này để nút ⋯ ẩn hẳn thay vì mở một menu đến đâu cũng được.
  noMenu?: boolean
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

// Nền + hình khối của hàng (trước là các class `.li.*` + `--li-tint`). Thứ tự ưu tiên
// giữ y như bộ rule cũ: đang mở / đang chọn > cụm nhóm > unread tint; hover = wash 55%.
//  - Đang mở / multi-select: accent-tint `bg-selected` (luật chọn của app: không nền xám).
//  - Cụm nhóm (chế độ "Nhóm"): nền accent rất nhạt ôm cả cha lẫn con, các hàng dính
//    liền nhau (khe 2px chỉ trả lại DƯỚI hàng cuối cụm), bo góc ở hai đầu cụm.
//  - Hàng con trong cụm vẽ nhánh cây: `::before` = khuỷu dọc-rồi-ngang VUÔNG từ mép
//    trên hàng vào chấm trạng thái (một hộp border trái+dưới để hai cạnh tự gặp đúng
//    góc); `::after` = thân dọc nối xuống hàng con KẾ TIẾP (hàng con cuối không có —
//    một đường thõng không nối vào đâu là rác thị giác). Hàng CHA không vẽ gì: đoạn
//    thân chạy sát tiêu đề cha trông rối — user bác.
const rowClass = computed(() => {
  const nest = !!props.inGroup
  const shape = nest
    ? [
        props.groupTop && 'rounded-t-md',
        props.groupBottom && 'mb-0.5 rounded-b-md',
        (props.depth ?? 0) > 0 && NEST_CHILD,
        (props.depth ?? 0) > 0 && !props.groupBottom && NEST_STEM,
      ]
    : 'mb-0.5 rounded-md'
  if (props.active || selected.value) return [shape, 'bg-selected']
  if (nest) return [shape, 'bg-primary/6 hover:bg-accent/55']
  return [
    shape,
    props.session.unread ? UNREAD_TINT[props.session.status] : '',
    'hover:bg-accent/55',
  ]
})
const NEST_CHILD =
  "before:absolute before:top-0 before:left-(--grp-rail-x) before:h-(--nest-elbow) before:w-1.75 before:border-b before:border-l before:border-primary/42 before:content-['']"
const NEST_STEM =
  "after:absolute after:top-(--nest-elbow) after:bottom-0 after:left-(--grp-rail-x) after:w-px after:bg-primary/42 after:content-['']"

// Tiêu đề: đậm hơn khi unread; mở = chữ chính. Đang sinh lại tiêu đề → vệt sáng chạy.
const titleClass = computed(() => [
  props.session.unread ? 'font-semibold text-foreground' : 'font-medium',
  props.active && 'text-foreground',
  store.titleGenerating.has(props.session.id) && 'tgen',
])

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
  return {
    '--grp-rail-x': `${LI_PAD_X + (depth - 1) * INDENT_PER_LEVEL + TWISTY_HALF}px`,
    // Y của khuỷu = tâm dòng tiêu đề: 8px padding-top của hàng (proto `py-2`) + nửa hộp
    // dòng. Lấy `--lh-md` chứ không phải số cố định vì hộp dòng co giãn theo cỡ chữ ở
    // Settings → Appearance, mà khuỷu thì phải bám theo chữ.
    '--nest-elbow': 'calc(8px + var(--lh-md) / 2)',
  }
})

const { t } = useI18n()
const { projectName } = useProjects()
const store = useSessionsStore()

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
// Badge fill/text/border per status (see BADGE_CLASS). Kept separate from the icon's
// colour so the badge can read as a proper colored chip while the icon stays muted.
const badgeClass = computed(() => BADGE_CLASS[props.session.status])
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

// Dòng meta thụt vào để chữ bắt đầu ngay dưới tiêu đề (proto: lề trái 22px = icon
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
// Click ⋯ → cũng mở menu chuột phải chung, neo tại cạnh nút (gần đúng vị trí
// menu dropdown cũ). placeMenu tự kẹp nếu tràn mép màn hình.
function onDots(e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('ctxmenu', { id: props.session.id, x: r.right, y: r.top })
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
/* style-ok: vệt sáng chạy qua tiêu đề khi model đang sinh lại nó — chữ tô bằng
   gradient (background-clip:text) + keyframe riêng, Tailwind không diễn đạt gọn.
   Màu trộn với màu tiêu đề nên đọc được ở mọi theme. */
.tgen {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    var(--textMuted) 0%,
    var(--primary) 50%,
    var(--textMuted) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ttlshimmer 1.4s linear infinite;
}
@keyframes ttlshimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
