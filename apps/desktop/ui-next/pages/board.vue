<template>
  <section class="page on boardpage" data-page="board">
    <!-- Issues-page khuôn Multica — board hợp nhất của MỌI project (sidecar
         vẫn lưu per-project, đây là view gộp): CollectionHeader + toolbar
         (search · project filter · view toggle) + kanban/list 2 chế độ. -->
    <CollectionHeader
      icon="board"
      :title="t('board.title')"
      :count="visibleItems.length"
      :tagline="t('board.tagline')"
    >
      <Button variant="outline" :title="t('board.export')" @click="exportBoard">
        <Icon name="download" class="size-3.5" />
        {{ t('board.export') }}
      </Button>
      <Button @click="boardEl?.openCreate()">
        <Icon name="plus" class="size-3.5" />
        {{ t('board.new') }}
      </Button>
    </CollectionHeader>

    <div class="bp-bar">
      <div class="relative">
        <Icon
          name="search"
          class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input v-model="query" :placeholder="t('board.search')" class="w-60 pl-8" />
      </div>
      <AppSelect
        v-model="filterProject"
        :options="projectFilterOpts"
        :placeholder="t('board.filterAll')"
        searchable
        :search-placeholder="t('board.filterProjectPh')"
        :empty-label="t('board.filterNone')"
        width="200px"
      />
      <span class="bp-flex" />
      <!-- View toggle — segmented dùng đúng shadcn Tabs (muted track, active nổi). -->
      <Tabs :model-value="view" @update:model-value="(v) => (view = v as typeof view)">
        <TabsList>
          <TabsTrigger
            value="board"
            class="size-[var(--ctrl-h-xs)] p-0"
            :title="t('board.viewBoard')"
          >
            <Icon name="board" class="size-3.5" />
          </TabsTrigger>
          <TabsTrigger
            value="list"
            class="size-[var(--ctrl-h-xs)] p-0"
            :title="t('board.viewList')"
          >
            <Icon name="listul" class="size-3.5" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <div class="bp-body">
      <div v-if="!projects.length" class="bp-empty">
        <span class="bp-empty-ic"><Icon name="board" class="size-5" /></span>
        <div class="bp-empty-t">{{ t('board.empty') }}</div>
      </div>
      <template v-else>
        <!-- Kanban giữ mounted khi sang list để editor modal (teleport) vẫn
             mở được từ hàng list qua openItem(). -->
        <WorkspaceBoard
          v-show="view === 'board'"
          ref="boardEl"
          :items="visibleItems"
          :project-id="filterProject"
          :members="allSessions"
          layout="columns"
          bare
          show-project
          pick-project
        />

        <!-- LIST — hàng issue: title/desc | status | assignee | project |
             updated. Click → cùng editor của kanban. -->
        <CollectionList v-show="view === 'list'" :cols="LIST_COLS">
          <template #head>
            <span class="bp-checkhead" @click.stop>
              <AppCheckbox
                :checked="allVisibleSelected"
                :indeterminate="selected.size > 0 && !allVisibleSelected"
                @update:checked="toggleAllVisible"
              />
            </span>
            <span>{{ t('board.col.issue') }}</span>
            <span>{{ t('board.col.status') }}</span>
            <span>{{ t('board.col.assignee') }}</span>
            <span>{{ t('board.col.project') }}</span>
            <span>{{ t('board.col.updated') }}</span>
          </template>
          <div
            v-for="it in visibleItems"
            :key="`${it.projectId}:${it.id}`"
            class="cl-row"
            :class="{ 'cl-row-sel': selected.has(itemKey(it)) }"
            @click="boardEl?.openItem(it.id)"
          >
            <div class="cl-cell bp-check" @click.stop>
              <AppCheckbox :checked="selected.has(itemKey(it))" @update:checked="toggleItem(it)" />
            </div>
            <div class="cl-cell bp-id">
              <span class="bp-title-cell">{{ it.title }}</span>
              <span v-if="it.desc" class="bp-desc">{{ it.desc }}</span>
            </div>
            <div class="cl-cell">
              <span class="bp-status" :style="{ '--st': statusColor(it.status) }">
                {{ statusLabel(it.status) }}
              </span>
            </div>
            <div class="cl-cell">
              <span v-if="assigneeOf(it)" class="bp-cell">{{ assigneeOf(it) }}</span>
              <span v-else class="bp-none">—</span>
            </div>
            <div class="cl-cell">
              <span class="bp-cell">{{ projectName(it.projectId) }}</span>
            </div>
            <div class="cl-cell">
              <span class="bp-cell">{{ fmtDate(it.updatedAt) }}</span>
            </div>
          </div>
          <div v-if="!visibleItems.length" class="bp-empty-list">{{ t('board.noItems') }}</div>
        </CollectionList>
      </template>
    </div>

    <!-- Bulk bar — nổi đáy khi list view có tick chọn. -->
    <div v-if="selected.size" class="bp-bulk">
      <span class="bp-bulk-n">{{ t('board.bulk.selected', { n: selected.size }) }}</span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm">
            <Icon name="edit" class="size-3.5" />
            {{ t('board.bulk.status') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem v-for="s in STATUSES" :key="s" @click="bulkSetStatus(s)">
            <span class="bp-status" :style="{ '--st': statusColor(s) }">
              {{ statusLabel(s) }}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" @click="exportSelected">
        <Icon name="download" class="size-3.5" />
        {{ t('board.bulk.export') }}
      </Button>
      <Button
        variant="outline"
        size="sm"
        class="text-destructive"
        :disabled="bulkBusy"
        @click="bulkDelete"
      >
        <Icon name="trash" class="size-3.5" />
        {{ t('board.bulk.delete') }}
      </Button>
      <Button variant="ghost" size="iconSm" :title="t('common.clear')" @click="selected.clear()">
        <Icon name="x" class="size-3.5" />
      </Button>
    </div>
  </section>
</template>

<script setup lang="ts">
// Màn Board hợp nhất — khuôn issues-page của Multica: CollectionHeader +
// toolbar (search · project filter · board/list view toggle). Board giữ là
// WorkspaceBoard kanban; list là CollectionList hàng phẳng — cùng nguồn item,
// cùng editor modal (teleport nên v-show vẫn mở được từ list).
import { computed, onMounted, ref, watch } from 'vue'
import Icon from '~/components/Icon.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import AppCheckbox from '~/components/common/AppCheckbox.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import DropdownMenu from '~/components/ui/dropdown-menu/DropdownMenu.vue'
import DropdownMenuContent from '~/components/ui/dropdown-menu/DropdownMenuContent.vue'
import DropdownMenuItem from '~/components/ui/dropdown-menu/DropdownMenuItem.vue'
import DropdownMenuTrigger from '~/components/ui/dropdown-menu/DropdownMenuTrigger.vue'
import CollectionHeader from '~/components/collection/CollectionHeader.vue'
import CollectionList from '~/components/collection/CollectionList.vue'
import { useConfirm } from '~/composables/useConfirm'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import WorkspaceBoard from '~/components/session/workspace/WorkspaceBoard.vue'
import { exportSlug, saveTextFile } from '~/utils/export'
import { useBoardStore, type BoardItem, type BoardItemStatus } from '~/stores/board'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import { useAgentsStore } from '~/stores/agents'
import { useTeamsStore } from '~/stores/teams'

const { t } = useI18n()
const { confirm } = useConfirm()
const toast = useToast()
const projectsStore = useProjectsStore()
const sessions = useSessionsStore()
const board = useBoardStore()
const agentsStore = useAgentsStore()
const teamsStore = useTeamsStore()

const projects = computed(() => projectsStore.projects)
// '' = tất cả project — board hợp nhất hiện hết.
const filterProject = ref<string>('')
const query = ref('')
const view = ref<'board' | 'list'>('board')

const projectFilterOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('board.filterAll') },
  ...projects.value.map((p) => ({ value: p.id, label: p.name })),
])

// Picker "giao cho" của editor nhận MỌI session — editor tự scope theo project
// đích của item, và assigneeOf nhìn được tên member của nhóm khác project.
const allSessions = computed(() => sessions.sessions)

const allItems = computed(() => Object.values(board.itemsByProject).flat())
const visibleItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  return allItems.value.filter((i) => {
    if (filterProject.value && i.projectId !== filterProject.value) return false
    if (!q) return true
    return (
      i.title.toLowerCase().includes(q) ||
      (i.desc ?? '').toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q)
    )
  })
})

const boardEl = ref<InstanceType<typeof WorkspaceBoard> | null>(null)

// ── List view ────────────────────────────────────────────────────────────────
const LIST_COLS = '28px minmax(240px,1fr) 110px 140px 140px 96px'

// ── Bulk select (list view) + export ─────────────────────────────────────────
const selected = ref(new Set<string>())
const bulkBusy = ref(false)
const itemKey = (it: BoardItem): string => `${it.projectId}:${it.id}`
const selectedItems = computed(() =>
  visibleItems.value.filter((i) => selected.value.has(itemKey(i))),
)
const allVisibleSelected = computed(
  () =>
    visibleItems.value.length > 0 &&
    visibleItems.value.every((i) => selected.value.has(itemKey(i))),
)

function toggleItem(it: BoardItem): void {
  const next = new Set(selected.value)
  const k = itemKey(it)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  selected.value = next
}
function toggleAllVisible(on: boolean): void {
  const next = new Set(selected.value)
  for (const it of visibleItems.value) {
    if (on) next.add(itemKey(it))
    else next.delete(itemKey(it))
  }
  selected.value = next
}
// Item đã tick mà bị filter ra vẫn giữ selection — chỉ prune khi item biến mất
// hẳn khỏi store (xoá đợt bulk trước đó…).
watch(allItems, (list) => {
  const live = new Set(list.map(itemKey))
  const pruned = new Set([...selected.value].filter((k) => live.has(k)))
  if (pruned.size !== selected.value.size) selected.value = pruned
})

/** Export một tập item thành JSON qua save dialog. */
async function exportItems(items: BoardItem[], nameHint: string): Promise<void> {
  if (!items.length) return
  const stamp = new Date().toISOString().slice(0, 10)
  try {
    const name = await saveTextFile(
      `awog-board-${nameHint}-${stamp}.json`,
      JSON.stringify({ kind: 'awog-board', exportedAt: new Date().toISOString(), items }, null, 2),
      [{ name: 'JSON', extensions: ['json'] }],
    )
    if (name) toast.add({ title: t('board.exportDone', { name }), color: 'success' })
  } catch (err) {
    toast.add({ title: t('board.exportFailed'), description: String(err), color: 'error' })
  }
}
function exportBoard(): void {
  const hint = filterProject.value ? exportSlug(projectName(filterProject.value)) : 'all'
  void exportItems(visibleItems.value, hint)
}
function exportSelected(): void {
  void exportItems(selectedItems.value, 'selected')
}

async function bulkSetStatus(status: BoardItemStatus): Promise<void> {
  if (bulkBusy.value) return
  bulkBusy.value = true
  try {
    for (const it of selectedItems.value) {
      // applyStatus: item mang spec chờ mà được kéo lên cột sống thì
      // materialize trước — spec fail chỉ chặn item đó, các item khác vẫn đi.
      await board.applyStatus(it, status)
    }
    toast.add({ title: t('board.bulk.done', { n: selectedItems.value.length }), color: 'success' })
  } finally {
    bulkBusy.value = false
  }
}
async function bulkDelete(): Promise<void> {
  const items = selectedItems.value
  if (!items.length || bulkBusy.value) return
  const ok = await confirm({
    title: t('board.bulk.deleteTitle'),
    description: t('board.bulk.deleteDesc', { n: items.length }),
    kind: 'danger',
  })
  if (!ok) return
  bulkBusy.value = true
  try {
    for (const it of items) {
      await board.deleteItem(it.projectId, it.id)
    }
    selected.value.clear()
  } finally {
    bulkBusy.value = false
  }
}

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
const STATUS_STYLE: Record<BoardItemStatus, string> = {
  backlog: 'var(--muted-foreground)',
  todo: 'var(--muted-foreground)',
  in_progress: 'var(--primary)',
  in_review: 'var(--warning)',
  changes: 'var(--warning)',
  blocked: 'var(--destructive)',
  done: 'var(--success)',
  cancelled: 'var(--muted-foreground)',
}
const statusLabel = (s: BoardItemStatus): string => t(STATUS_KEY[s] ?? s)
const statusColor = (s: BoardItemStatus): string => STATUS_STYLE[s] ?? 'var(--muted-foreground)'
const STATUSES = Object.keys(STATUS_KEY) as BoardItemStatus[]

const projectName = (id: string): string => projectsStore.projectById(id)?.name ?? id

function assigneeOf(it: BoardItem): string {
  const a = it.assigneeSessionId
  if (!a) {
    // Spec chờ materialize — tên spec + hậu tố "đã xếp" (board.specLabel).
    return it.assigneeRef ? `${board.specLabel(it.assigneeRef)} · ${t('board.agent.queued')}` : ''
  }
  if (a === 'user') return t('sessions.workspace.group.assigneeUser')
  const s = allSessions.value.find((m) => m.engineId === a)
  // Phiên do agents.run materialize mang title = tên task — hiện AGENT id
  // (ai làm) thay vì lặp lại title của chính item.
  if (s?.agent?.id) return s.agent.id
  return s?.title ?? a
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

onMounted(async () => {
  if (!projectsStore.loaded) await projectsStore.hydrate()
  // Nạp board của TỪNG project — view hợp nhất cần toàn bộ backlog.
  for (const p of projects.value) void board.listBoard(p.id)
})

// Item mang assigneeRef ⇒ cần roster spec để resolve tên — nạp lười một lần
// khi ref đầu tiên xuất hiện.
watch(
  () => allItems.value.some((i) => i.assigneeRef),
  (has) => {
    if (!has) return
    const ids = projects.value.map((p) => p.id)
    void agentsStore.loadAgents(ids)
    void teamsStore.load(ids)
  },
  { immediate: true },
)

// Filter trỏ vào project đã bị xoá ⇒ rơi về "tất cả"; project vừa link thêm ⇒
// nạp board của nó để item mới hiện ngay trong view hợp nhất.
watch(projects, (list) => {
  if (filterProject.value && !list.some((p) => p.id === filterProject.value)) {
    filterProject.value = ''
  }
  for (const p of list) {
    if (!(p.id in board.itemsByProject)) void board.listBoard(p.id)
  }
})
</script>

<style scoped>
.boardpage.page {
  flex-direction: column;
  position: relative; /* neo cho .bp-bulk nổi đáy */
}
.bp-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.bp-flex {
  flex: 1;
}

.bp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.bp-body :deep(.wssec) {
  margin-top: 0;
}

/* List cells */
.bp-id {
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
}
.bp-title-cell {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--foreground);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-desc {
  font-size: var(--fs-xs);
  color: var(--muted-foreground);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-cell {
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-none {
  color: var(--muted-foreground);
}
/* Checkbox col + hàng được chọn */
.bp-check,
.bp-checkhead {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.cl-row-sel {
  background: var(--accent-wash);
}

/* Bulk bar nổi — đáy giữa, trên mọi nội dung board. */
.bp-bulk {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--popover);
  box-shadow: var(--shadow-lg);
}
.bp-bulk-n {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--foreground);
  padding-right: 4px;
}
.bp-status {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--st);
  border: 1px solid var(--st);
  border-radius: var(--r-pill);
  padding: 1px 8px;
  white-space: nowrap;
}
.bp-empty-list {
  padding: 32px;
  text-align: center;
  color: var(--muted-foreground);
  font-size: var(--fs-sm);
}

/* Empty */
.bp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--muted-foreground);
}
.bp-empty-ic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  background: var(--muted);
  color: var(--muted-foreground);
  margin-bottom: 4px;
}
.bp-empty-t {
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
}
</style>
