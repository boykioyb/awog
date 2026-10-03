<template>
  <section ref="rootEl" class="wssec" :class="{ bare }">
    <div v-if="!bare" class="flex items-center gap-1.5">
      <Button
        variant="ghost"
        class="h-auto p-0 flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        type="button"
        @click="open = !open"
      >
        <ChevronDown class="size-3 shrink-0 transition-transform" :class="{ 'rotate-180': open }" />
        <span>{{ t('sessions.workspace.group.board') }}</span>
        <span class="font-normal text-faint">{{ items.length }}</span>
      </Button>
      <!-- Tạo work-item: mở editor ở mode "mới" (status backlog mặc định). -->
      <Button
        variant="outline"
        class="h-auto p-0 flex size-[18px] shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground transition-colors hover:border-input hover:bg-accent hover:text-foreground"
        :title="t('sessions.workspace.group.newItem')"
        :aria-label="t('sessions.workspace.group.newItem')"
        @click.stop="createItem()"
      >
        <Plus class="size-3" />
      </Button>
    </div>

    <div v-show="open" class="wsb" :class="{ cols: layout === 'columns' }">
      <!-- Kanban (columns) luôn vẽ đủ lane kể cả board rỗng — khung pipeline
           backlog→todo→… chính là thông tin; chỉ stack mode mới thu về một
           dòng empty cho gọn. -->
      <div v-if="!items.length && layout !== 'columns'" class="wsb-empty">
        {{ t('sessions.workspace.group.boardEmpty') }}
      </div>
      <!-- Panel hẹp ⇒ board đọc theo CỤM status thay vì kanban ngang. -->
      <template v-else>
        <div
          v-for="col in columns"
          :key="col.status"
          class="wsb-group"
          :data-st="col.status"
          :class="{ drop: dropLane === col.status && dragItem?.status !== col.status }"
          @dragover.prevent="onLaneOver(col.status)"
          @dragleave="onLaneLeave(col.status)"
          @drop.prevent="onLaneDrop(col.status)"
        >
          <div class="wsb-st" :data-st="col.status">
            <span class="wsb-dot" />
            {{ statusLabel(col.status) }}
            <span class="wsb-stn">{{ col.items.length }}</span>
          </div>
          <div class="wsb-lane">
            <button
              v-for="it in col.items"
              :key="it.id"
              class="wsb-card"
              :data-item="it.id"
              :data-st="it.status"
              :draggable="layout === 'columns'"
              @dragstart="onDragStart(it, $event)"
              @dragend="onDragEnd"
              @click="openEditor(it.id)"
            >
              <div class="wsb-title">{{ it.title }}</div>
              <div v-if="it.desc" class="wsb-desc">{{ it.desc }}</div>
              <div class="wsb-meta">
                <span v-if="showProject" class="wsb-proj" :title="it.projectId">
                  <Folder class="size-3" />
                  {{ projectName(it.projectId) }}
                </span>
                <span v-if="typeof it.stage === 'number'" class="wsb-stage">
                  {{ t('sessions.workspace.group.stage', { n: it.stage }) }}
                </span>
                <span v-if="assigneeOf(it)" class="wsb-who">{{ assigneeOf(it) }}</span>
                <span v-if="it.comments?.length" class="wsb-cmt">
                  <MessageSquare class="size-3" />
                  {{ it.comments.length }}
                </span>
                <span v-if="it.mergedBranch" class="wsb-merged" :title="it.mergedBranch">
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
    />
  </section>
</template>

<script setup lang="ts">
// Board theo PROJECT của cockpit (session-teams §8): item gom theo status, click
// mở WorkspaceBoardEditor (popover neo theo card), "+" tạo item backlog. Dữ liệu
// sống ở board store — `board.changed` của sidecar tự refetch.
import { ChevronDown, Folder, GitMerge, MessageSquare, Plus } from 'lucide-vue-next'
import {
  BOARD_STATUS_ORDER,
  useBoardStore,
  type BoardItem,
  type BoardItemStatus,
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

const STATUS_KEY: Record<BoardItemStatus, string> = {
  backlog: 'sessions.workspace.group.st.backlog',
  todo: 'sessions.workspace.group.st.todo',
  in_progress: 'sessions.workspace.group.st.inProgress',
  in_review: 'sessions.workspace.group.st.inReview',
  changes: 'sessions.workspace.group.st.changes',
  blocked: 'sessions.workspace.group.st.blocked',
  done: 'sessions.workspace.group.st.done',
  cancelled: 'sessions.workspace.group.st.cancelled',
}
const statusLabel = (s: BoardItemStatus): string => t(STATUS_KEY[s] ?? s)

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
const editingItem = computed(() =>
  editing.value?.itemId ? (items.value.find((i) => i.id === editing.value!.itemId) ?? null) : null,
)

function openEditor(itemId: string) {
  if (!items.value.some((i) => i.id === itemId)) return
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

// Nút "+ Tạo việc" của toolbar trang Board (bare mode giấu hẳn wssec-head).
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

<style scoped>
.wssec {
  margin-top: 12px;
}
.wsb {
  margin-top: 8px;
}
/* ── Kanban ngang cho màn Board riêng ────────────────────────────────────
   Mỗi status là một LANE có panel riêng (nền + viền) chứ card nổi bên trong;
   lane tự cuộn dọc, strip cuộn ngang khi hẹp. bare=section full-height nên
   cả khối dàn cao hết body thay vì cụm card lơ lửng trên đầu trang. */
.wssec.bare {
  display: flex;
  flex-direction: column;
  height: 100%;
  margin-top: 0;
}
.wssec.bare .wsb.cols {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 0;
  /* Trang Issues đứng một mình: strip kanban cần đệm quanh như .bp-bar
     (8/16) — cockpit nhúng giữ compact vì panel cha đã có padding. */
  padding: 12px 16px 16px;
}
.wsb.cols {
  display: flex;
  gap: 12px;
  align-items: stretch;
  overflow-x: auto;
  padding-bottom: 4px;
}
.wsb.cols .wsb-group {
  flex: 0 0 232px;
  min-width: 0;
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
/* Lane đang được rê card tới: viền primary + nền nhấc nhẹ — đích thả phải rõ. */
.wsb.cols .wsb-group.drop {
  border-color: var(--ring);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
.wsb.cols .wsb-st {
  position: sticky;
  top: 0;
  padding: 8px 10px 6px;
}
.wsb-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--textFaint);
  flex: 0 0 auto;
}
/* Status → màu chấm + mép trái card: một nguồn màu, hai chỗ đọc. */
.wsb-st[data-st='in_progress'] .wsb-dot,
.wsb-group[data-st='in_progress'] .wsb-dot {
  background: var(--primary);
}
.wsb-st[data-st='in_review'] .wsb-dot,
.wsb-group[data-st='in_review'] .wsb-dot {
  background: var(--warning);
}
.wsb-st[data-st='blocked'] .wsb-dot,
.wsb-group[data-st='blocked'] .wsb-dot {
  background: var(--destructive);
}
.wsb-st[data-st='changes'] .wsb-dot,
.wsb-group[data-st='changes'] .wsb-dot {
  background: var(--violet);
}
.wsb-st[data-st='todo'] .wsb-dot,
.wsb-group[data-st='todo'] .wsb-dot {
  background: var(--info);
}
.wsb-st[data-st='done'] .wsb-dot,
.wsb-group[data-st='done'] .wsb-dot {
  background: var(--success);
}
.wsb.cols .wsb-stn {
  margin-left: auto;
  font-weight: 400;
}
/* Thân lane cuộn riêng; card xếp trong nó. */
.wsb.cols .wsb-lane {
  flex: 1 1 auto;
  min-height: 24px;
  overflow-y: auto;
  padding: 2px 8px 8px;
  scrollbar-width: thin;
}
.wsb.cols .wsb-card {
  text-align: left;
  padding: 9px 10px 8px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: var(--r-sm);
  background: var(--card);
  box-shadow: var(--shadow-sm);
}
.wsb.cols .wsb-card:hover {
  border-color: var(--input);
  background: var(--accent-wash);
}
.wsb-card[data-st='in_progress'] {
  border-left-color: var(--primary);
}
.wsb-card[data-st='in_review'] {
  border-left-color: var(--warning);
}
.wsb-card[data-st='blocked'] {
  border-left-color: var(--destructive);
}
.wsb-card[data-st='changes'] {
  border-left-color: var(--violet);
}
.wsb-card[data-st='todo'] {
  border-left-color: var(--info);
}
.wsb-card[data-st='done'] {
  border-left-color: var(--success);
}
.wsb-card[data-st='backlog'],
.wsb-card[data-st='cancelled'] {
  border-left-color: var(--border);
}
/* Card trên màn kanban đọc rộng hơn card cockpit — chữ to hơn một nấc, chip
   meta là pill rõ ràng. Các rule đều scope `.wsb.cols` để panel Nhóm của phiên
   gốc giữ nguyên mật độ compact cũ. */
.wsb.cols .wsb-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.wsb.cols .wsb-desc {
  margin-top: 3px;
}
.wsb.cols .wsb-meta {
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.wsb.cols .wsb-who,
.wsb.cols .wsb-stage {
  max-width: 100%;
  padding: 1px 7px;
  border-radius: var(--r-pill);
  background: var(--accent-wash);
}
.wsb.cols .wsb-stage {
  color: var(--textFaint);
}
.wsb-empty {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  padding: 6px 2px;
}
.wsb-group {
  margin-bottom: 8px;
}
/* Group header — spec §6: text-[10px] uppercase tracking-wide muted. */
.wsb-st {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted-foreground);
  padding: 2px 2px 4px;
}
.wsb-stn {
  color: var(--textFaint);
}
/* Item cần mắt tới đọc rõ hơn hẳn — tông của status thay vì xám đều. */
.wsb-st[data-st='in_review'] {
  color: var(--warning);
}
.wsb-st[data-st='blocked'] {
  color: var(--destructive);
}
.wsb-st[data-st='changes'] {
  color: var(--warning);
}
.wsb-card {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--card);
  cursor: pointer;
  font-family: var(--sans);
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.wsb-card:hover {
  border-color: var(--input);
  background: var(--accent-wash);
}
.wsb-title {
  color: var(--foreground);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.wsb-desc {
  color: var(--muted-foreground);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.wsb-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
  color: var(--muted-foreground);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  min-width: 0;
}
.wsb-proj {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textFaint);
}
.wsb.cols .wsb-proj {
  padding: 1px 7px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  color: var(--muted-foreground);
}
.wsb-who,
.wsb-stage,
.wsb-cmt {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wsb-merged {
  color: var(--success);
  display: inline-flex;
}
</style>
