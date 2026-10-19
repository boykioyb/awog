<template>
  <section ref="rootEl" :class="bare ? 'flex h-full flex-col' : 'mt-3'">
    <div v-if="!bare" class="flex items-center gap-1.5">
      <Button
        variant="ghost"
        class="h-auto min-w-0 flex-1 justify-start gap-1.5 px-0 py-0.5 text-left text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
        @click="open = !open"
      >
        <ChevronDown class="size-3 shrink-0 transition-transform" :class="{ 'rotate-180': open }" />
        <span>{{ t('sessions.workspace.group.board') }}</span>
        <span class="font-normal text-faint">{{ items.length }}</span>
      </Button>
      <!-- Tạo work-item: mở editor ở mode "mới" (status backlog mặc định). -->
      <Button
        variant="outline"
        size="iconSm"
        class="h-4.5 w-4.5 shrink-0 rounded-sm text-muted-foreground [&_svg]:size-3"
        :title="t('sessions.workspace.group.newItem')"
        :aria-label="t('sessions.workspace.group.newItem')"
        @click.stop="createItem()"
      >
        <Plus />
      </Button>
    </div>

    <!-- Kanban ngang (columns) cho màn Board riêng: mỗi status là một LANE có panel
         riêng (nền + viền), card nổi bên trong; lane tự cuộn dọc, strip cuộn ngang
         khi hẹp. Stack = cụm status xếp dọc cho panel hẹp của cockpit. -->
    <div v-show="open" :class="bodyClass">
      <!-- Kanban (columns) luôn vẽ đủ lane kể cả board rỗng — khung pipeline
           backlog→todo→… chính là thông tin; chỉ stack mode mới thu về một
           dòng empty cho gọn. -->
      <div v-if="!items.length && !cols" class="px-0.5 py-1.5 text-xs text-faint">
        {{ t('sessions.workspace.group.boardEmpty') }}
      </div>
      <!-- Panel hẹp ⇒ board đọc theo CỤM status thay vì kanban ngang. -->
      <template v-else>
        <div
          v-for="col in columns"
          :key="col.status"
          :class="
            cols
              ? [
                  'flex max-h-full w-58 min-w-0 flex-none flex-col rounded-lg border transition-colors',
                  dropLane === col.status && dragItem?.status !== col.status
                    ? 'border-ring bg-primary/10'
                    : 'border-border bg-muted',
                ]
              : 'mb-2'
          "
          @dragover.prevent="onLaneOver(col.status)"
          @dragleave="onLaneLeave(col.status)"
          @drop.prevent="onLaneDrop(col.status)"
        >
          <div
            class="flex items-center gap-1.5 text-xs font-medium"
            :class="[
              STATUS_HEAD[col.status] ?? 'text-muted-foreground',
              cols ? 'sticky top-0 px-2.5 pt-2 pb-1.5' : 'px-0.5 pt-0.5 pb-1',
            ]"
          >
            <span
              class="size-2 flex-none rounded-full"
              :class="STATUS_DOT[col.status] ?? 'bg-faint'"
            />
            {{ statusLabel(col.status) }}
            <span class="text-faint" :class="{ 'ml-auto font-normal': cols }">
              {{ col.items.length }}
            </span>
          </div>
          <div
            :class="{
              'min-h-6 flex-auto overflow-y-auto px-2 pt-0.5 pb-2 [scrollbar-width:thin]': cols,
            }"
          >
            <!-- raw-ok: card nhiều dòng kéo-thả được, cả card là một vùng bấm -->
            <button
              v-for="it in col.items"
              :key="it.id"
              type="button"
              :class="[
                'block w-full cursor-pointer rounded-md border border-border bg-card px-2.5 text-left font-sans transition-colors hover:border-input hover:bg-accent',
                cols
                  ? ['mb-1.5 border-l-3 py-2 shadow-sm', CARD_EDGE[it.status] ?? '']
                  : 'mb-1 py-2',
              ]"
              :data-item="it.id"
              :draggable="cols"
              @dragstart="onDragStart(it, $event)"
              @dragend="onDragEnd"
              @click="openEditor(it.id)"
            >
              <!-- Breadcrumb cha — "không biết issue cha là cái nào" của board
                   rối sub-issue: một dòng mờ trên title trỏ về item cha. -->
              <div
                v-if="parentTitle(it)"
                class="mb-0.5 flex items-center gap-1 truncate text-xs text-faint"
                :title="parentTitle(it)"
              >
                <CornerDownRight class="size-3 shrink-0" />
                {{ parentTitle(it) }}
              </div>
              <div
                class="line-clamp-2 font-medium text-foreground"
                :class="cols ? 'text-base' : 'text-sm'"
              >
                <component
                  :is="typeIcon(it)"
                  class="mr-1 inline-block size-3 flex-none align-middle"
                  :class="TYPE_COLOR[typeOf(it)]"
                  :stroke-width="2.2"
                />
                {{ it.title }}
              </div>
              <div
                v-if="it.desc"
                class="line-clamp-2 text-xs text-muted-foreground"
                :class="{ 'mt-0.5': cols }"
              >
                {{ it.desc }}
              </div>
              <div
                class="flex min-w-0 items-center text-xs text-muted-foreground"
                :class="cols ? 'mt-1.5 flex-wrap gap-1.5' : 'mt-0.5 gap-2'"
              >
                <span
                  v-if="showProject"
                  class="inline-flex max-w-35 min-w-0 items-center gap-1 truncate"
                  :class="
                    cols
                      ? 'rounded-full border border-border px-1.5 py-px text-muted-foreground'
                      : 'text-faint'
                  "
                  :title="it.projectId"
                >
                  <Folder class="size-3" />
                  {{ projectName(it.projectId) }}
                </span>
                <span
                  v-if="typeof it.stage === 'number'"
                  class="inline-flex min-w-0 items-center gap-1 truncate"
                  :class="{ [PILL]: cols, 'text-faint': cols }"
                >
                  {{ t('sessions.workspace.group.stage', { n: it.stage }) }}
                </span>
                <span
                  v-if="it.priority && it.priority !== 'medium'"
                  class="inline-flex items-center gap-1"
                  :class="PRIO_COLOR[it.priority]"
                  :title="t(`board.prio.${it.priority}`)"
                >
                  <Flag class="size-3" />
                </span>
                <span
                  v-if="it.severity"
                  class="inline-flex items-center gap-1"
                  :class="SEV_COLOR[it.severity]"
                  :title="t(`board.sev.${it.severity}`)"
                >
                  <TriangleAlert class="size-3" />
                </span>
                <!-- Hạn chót (khuôn GitHub Projects) — đỏ khi đã qua mà việc chưa đóng. -->
                <span
                  v-if="it.dueDate"
                  class="inline-flex items-center gap-1"
                  :class="isOverdue(it) ? 'text-destructive' : 'text-faint'"
                  :title="t('board.field.dueDate')"
                >
                  <CalendarClock class="size-3" />
                  {{ fmtDue(it.dueDate) }}
                </span>
                <span
                  v-if="it.sprint"
                  class="inline-flex items-center gap-1 text-faint"
                  :title="t('board.field.sprint')"
                >
                  {{ it.sprint }}
                </span>
                <span
                  v-if="childCount(it)"
                  class="inline-flex items-center gap-1 text-faint"
                  :title="t('board.children')"
                >
                  <ListTree class="size-3" />
                  {{ childCount(it) }}
                </span>
                <span
                  v-if="assigneeOf(it)"
                  class="inline-flex min-w-0 items-center gap-1 truncate"
                  :class="{ [PILL]: cols }"
                >
                  {{ assigneeOf(it) }}
                </span>
                <span
                  v-if="it.comments?.length"
                  class="inline-flex min-w-0 items-center gap-1 truncate"
                >
                  <MessageSquare class="size-3" />
                  {{ it.comments.length }}
                </span>
                <span
                  v-if="it.mergedBranch"
                  class="inline-flex text-success"
                  :title="it.mergedBranch"
                >
                  <GitMerge class="size-3" />
                </span>
              </div>
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Item resolve LIVE từ store (itemId → items) — comment/roster/thread
         cập nhật khi boards.comment/upsert merge bản mới; item bị xoá trong
         lúc mở thì modal tự đóng thay vì lật sang create mode. -->
    <WorkspaceBoardEditor
      v-if="editing && (editing.itemId === null || editingItem)"
      :item="editingItem"
      :project-id="editingItem?.projectId ?? projectId"
      :members="members"
      :lead="lead"
      :pick-project="editing.itemId === null && pickProject"
      @close="editing = null"
      @open-item="openEditor"
    />
  </section>
</template>

<script setup lang="ts">
// Board theo PROJECT của cockpit (session-teams §8): item gom theo status, click
// mở WorkspaceBoardEditor (popover neo theo card), "+" tạo item backlog. Dữ liệu
// sống ở board store — `board.changed` của sidecar tự refetch.
import {
  BookOpen,
  Bug,
  ChevronDown,
  CornerDownRight,
  Flag,
  Folder,
  GitMerge,
  Layers,
  ListTree,
  CalendarClock,
  MessageSquare,
  Plus,
  SquareCheck,
  TriangleAlert,
} from 'lucide-vue-next'
import {
  BOARD_STATUS_ORDER,
  useBoardStore,
  type BoardItem,
  type BoardItemPriority,
  type BoardItemSeverity,
  type BoardItemStatus,
  type BoardItemType,
} from '~/stores/board'
import { useAgentsStore } from '~/stores/agents'
import { useTeamsStore } from '~/stores/teams'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import type { Session } from '~/composables/useSessionsData'
import WorkspaceBoardEditor from './WorkspaceBoardEditor.vue'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    // projectId của phiên gốc nhóm — cockpit truyền để tự nạp board của project
    // đó. '' khi cha đã truyền `items` sẵn (màn Board riêng gộp nhiều project).
    projectId?: string
    // Danh sách item ĐÃ lọc sẵn từ cha (màn Board riêng). Vắng mặt ⇒ component
    // tự lấy board.itemsFor(projectId) và tự listBoard(projectId).
    items?: BoardItem[]
    // Member + lead — nguồn của picker "giao cho" trong editor.
    members: Session[]
    // Lead của nhóm — optional vì board còn được dùng ở màn Board riêng
    // (pages/board.vue), nơi board thuộc PROJECT chứ không thuộc một nhóm.
    lead?: Session
    // 'stack' = cụm status xếp dọc cho panel hẹp (cockpit); 'columns' = kanban
    // ngang cho màn riêng — đủ 8 lane kể cả rỗng để nhìn hết pipeline.
    layout?: 'stack' | 'columns'
    // bare = giấu header collapse của section — màn Board riêng tự có toolbar,
    // không cần thêm một hàng "BOARD n" trùng lặp trên đầu.
    bare?: boolean
    // Hiện chip project trên card — khi board trộn item của nhiều project.
    showProject?: boolean
    // Cho phép chọn project ngay trong editor khi TẠO item (unified board).
    pickProject?: boolean
  }>(),
  { layout: 'stack', lead: undefined, bare: false, projectId: '', items: undefined },
)

const { t } = useI18n()
const board = useBoardStore()
const projectsStore = useProjectsStore()
const sessionsStore = useSessionsStore()
const agentsStore = useAgentsStore()
const teamsStore = useTeamsStore()

const open = ref(true)
const rootEl = ref<HTMLElement | null>(null)

const items = computed<BoardItem[]>(() => props.items ?? board.itemsFor(props.projectId))

// ── Trình bày ──
const cols = computed(() => props.layout === 'columns')
// Trang Issues đứng một mình (bare + columns): strip kanban cần đệm quanh như
// thanh .bp-bar (8/16) — cockpit nhúng giữ compact vì panel cha đã có padding.
const bodyClass = computed(() => {
  if (!cols.value) return 'mt-2'
  const strip = 'flex items-stretch gap-3 overflow-x-auto'
  return props.bare ? `${strip} min-h-0 flex-auto px-4 pt-3 pb-4` : `${strip} mt-2 pb-1`
})
// Chip meta dạng pill trên card kanban (card cockpit giữ chữ trơn cho gọn).
const PILL = 'max-w-full rounded-full bg-accent px-1.5 py-px'
// Status → màu chấm + mép trái card: một nguồn màu, hai chỗ đọc. Status vắng mặt
// rơi về màu mặc định (chấm faint, mép viền thường).
const STATUS_DOT: Partial<Record<BoardItemStatus, string>> = {
  in_progress: 'bg-primary',
  in_review: 'bg-warning',
  blocked: 'bg-destructive',
  changes: 'bg-lavender',
  todo: 'bg-info',
  done: 'bg-success',
  // pending = tạm gác — cùng màu với useIssueStatus (muted, khác chấm backlog nhạt hơn).
  pending: 'bg-muted-foreground',
}
const CARD_EDGE: Partial<Record<BoardItemStatus, string>> = {
  in_progress: 'border-l-primary',
  in_review: 'border-l-warning',
  blocked: 'border-l-destructive',
  changes: 'border-l-lavender',
  todo: 'border-l-info',
  done: 'border-l-success',
}
// Item cần mắt tới đọc rõ hơn hẳn — tông của status thay vì xám đều.
const STATUS_HEAD: Partial<Record<BoardItemStatus, string>> = {
  in_review: 'text-warning',
  blocked: 'text-destructive',
  changes: 'text-warning',
}
// Khuôn Jira: màu type theo thói quen Jira — epic tím / story xanh lá / task xanh
// dương / subtask xám / bug đỏ; cờ ưu tiên + cảnh báo severity cùng một thang.
const TYPE_COLOR: Record<BoardItemType, string> = {
  epic: 'text-lavender',
  story: 'text-success',
  task: 'text-info',
  subtask: 'text-muted-foreground',
  bug: 'text-destructive',
}
const PRIO_COLOR: Record<BoardItemPriority, string> = {
  urgent: 'text-destructive',
  high: 'text-warning',
  medium: '',
  low: 'text-faint',
}
const SEV_COLOR: Record<BoardItemSeverity, string> = {
  blocker: 'text-destructive',
  major: 'text-warning',
  minor: 'text-info',
  trivial: 'text-faint',
}
// Stack (panel hẹp) giấu cụm rỗng cho gọn; columns (kanban) giữ đủ lane —
// lane trống chính là thông tin "không có gì đang kẹt ở đây".
const columns = computed(() => {
  const cols = BOARD_STATUS_ORDER.map((status) => ({
    status,
    items: items.value.filter((i) => i.status === status),
  }))
  return props.layout === 'columns' ? cols : cols.filter((c) => c.items.length)
})

// Chip project trên card unified board — fallback raw id khi project chưa hydrate.
const projectName = (id: string): string => projectsStore.projectById(id)?.name ?? id

// Nhãn status: một nguồn với chip issue / view Issues (useIssueStatus).
const { statusLabel } = useIssueStatus()

// ── Loại việc / cây cha-con (khuôn Jira) ──
// Icon kiểu Jira: một glyph màu nhỏ cạnh title — type là cái nhìn đầu tiên
// phân biệt epic/story/task/subtask/bug trước khi đọc chữ.
const TYPE_ICON: Record<BoardItemType, unknown> = {
  epic: Layers,
  story: BookOpen,
  task: SquareCheck,
  subtask: CornerDownRight,
  bug: Bug,
}
const typeOf = (it: BoardItem): BoardItemType => it.type ?? 'task'
const typeIcon = (it: BoardItem): unknown => TYPE_ICON[typeOf(it)]

// Breadcrumb cha + đếm con — tra trong CÙNG tập items đang hiển thị (board
// hợp nhất nhiều project vẫn đúng vì parentId luôn cùng file/board với con).
const parentTitle = (it: BoardItem): string =>
  it.parentId ? (items.value.find((p) => p.id === it.parentId)?.title ?? '') : ''
// `YYYY-MM-DD` là ngày lịch — parse theo giờ địa phương (không UTC) để "hôm nay"
// và "quá hạn" khớp với lịch người dùng.
const fmtDue = (d: string): string =>
  new Date(`${d}T00:00:00`).toLocaleDateString([], { day: '2-digit', month: '2-digit' })
const isOverdue = (it: BoardItem): boolean =>
  !!it.dueDate &&
  it.status !== 'done' &&
  it.status !== 'cancelled' &&
  Date.now() > Date.parse(`${it.dueDate}T23:59:59`)
const childCount = (it: BoardItem): number => items.value.filter((c) => c.parentId === it.id).length

// Tên người nhận: 'user' = sentinel của NGƯỜI DÙNG (không phải sessionId);
// engineId → title của member/lead. assigneeRef = spec CHỜ materialize — hiện
// tên spec + hậu tố "đã xếp" để phân biệt với phiên đang sống.
function assigneeOf(it: BoardItem): string {
  const a = it.assigneeSessionId
  if (!a) {
    return it.assigneeRef ? `${board.specLabel(it.assigneeRef)} · ${t('board.agent.queued')}` : ''
  }
  if (a === 'user') return t('sessions.workspace.group.assigneeUser')
  const s =
    (props.lead && a === props.lead.engineId ? props.lead : undefined) ??
    props.members.find((m) => m.engineId === a) ??
    // Phiên lone-agent (agents.run) không nằm trong roster của một run — tra
    // store tổng để vẫn resolve được khi board ở cockpit.
    sessionsStore.sessions.find((m) => m.engineId === a)
  // Phiên lone-agent mang title = task — hiện agent id thay vì lặp lại title
  // của chính item.
  if (s?.agent?.id) return s.agent.id
  return s?.title ?? a
}

// ── Editor modal ──
// Giữ itemId thay vì snapshot item — mergeItem của store ghi object MỚI nên
// snapshot sẽ đóng băng comments/assignee (chat xong không thấy, roster không
// hiện sau khi materialize). Item lookup live qua computed.
const editing = ref<{ itemId: string | null } | null>(null)
// Tra theo danh sách đang hiển thị trước, rớt xuống store toàn cục — item con
// có thể bị filter "Ẩn việc con" giấu khỏi `items` nhưng điều hướng cha↔con
// trong modal vẫn phải mở được.
const editingItem = computed(() =>
  editing.value?.itemId
    ? (items.value.find((i) => i.id === editing.value!.itemId) ??
      board.itemById(editing.value!.itemId) ??
      null)
    : null,
)

function openEditor(itemId: string) {
  if (!items.value.some((i) => i.id === itemId) && !board.itemById(itemId)) return
  editing.value = { itemId }
}

function createItem() {
  editing.value = { itemId: null }
}

// "Cần bạn quyết" nhảy tới một item: bung section, cuộn tới card rồi mở modal.
async function openItem(itemId: string): Promise<void> {
  open.value = true
  await nextTick()
  const el = rootEl.value?.querySelector<HTMLElement>(`[data-item="${itemId}"]`)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  openEditor(itemId)
}

// Nút "+ Tạo việc" của toolbar trang Board (bare mode giấu hẳn header section).
function openCreate(): void {
  createItem()
}
defineExpose({ openItem, openCreate })

// ── Kéo-thả đổi status (chỉ layout kanban) ──
// User được đổi mọi status (khác agent bị chặn done/cancelled) nên drop =
// boards.upsert thẳng; event board.changed tự refetch đồng bộ lại.
const dragItem = ref<BoardItem | null>(null)
const dropLane = ref<BoardItemStatus | null>(null)

function onDragStart(it: BoardItem, e: DragEvent): void {
  dragItem.value = it
  e.dataTransfer?.setData('text/plain', it.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragEnd(): void {
  dragItem.value = null
  dropLane.value = null
}
function onLaneOver(status: BoardItemStatus): void {
  if (dragItem.value) dropLane.value = status
}
function onLaneLeave(status: BoardItemStatus): void {
  if (dropLane.value === status) dropLane.value = null
}
async function onLaneDrop(status: BoardItemStatus): Promise<void> {
  const it = dragItem.value
  onDragEnd()
  if (!it || it.status === status) return
  // applyStatus materialize assigneeRef (spec chờ) khi item được kéo ra cột
  // sống — spec fail thì item ở yên cột cũ + toast lý do.
  await board.applyStatus(it, status)
}

onMounted(() => {
  if (!props.items && props.projectId) void board.listBoard(props.projectId)
})
watch(
  () => props.projectId,
  (id) => {
    if (!props.items && id) void board.listBoard(id)
  },
)

// Item mang assigneeRef ⇒ cần roster spec để resolve tên hiển thị — nạp lười
// một lần khi ref đầu tiên xuất hiện (roster rỗng thì specLabel rơi về đuôi
// khoá, vẫn đọc được nhưng xấu).
watch(
  () => items.value.some((i) => i.assigneeRef),
  (has) => {
    if (!has) return
    const ids = projectsStore.projects.map((p) => p.id)
    void agentsStore.loadAgents(ids)
    void teamsStore.load(ids)
  },
  { immediate: true },
)
</script>
