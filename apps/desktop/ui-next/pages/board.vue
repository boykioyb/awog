<template>
  <!-- relative: neo cho thanh bulk nổi đáy. -->
  <section class="relative flex min-w-0 flex-1 flex-col overflow-hidden" data-page="board">
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

    <div class="flex shrink-0 items-center gap-2 border-b px-4 py-2">
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
      <AppSelect
        v-model="filterType"
        :options="typeFilterOpts"
        :placeholder="t('board.type.all')"
        width="130px"
      />
      <AppSelect
        v-model="filterPriority"
        :options="prioFilterOpts"
        :placeholder="t('board.prio.all')"
        width="130px"
      />
      <!-- Việc con MẶC ĐỊNH ẩn để mặt bảng chỉ nhìn tầng trên của cây — tick
           mới bung các sub-issue (con vẫn đếm được qua chip ListTree). -->
      <label
        class="inline-flex cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground select-none"
        :title="t('board.showChildrenTitle')"
      >
        <AppCheckbox v-model:checked="showChildren" />
        {{ t('board.showChildren') }}
      </label>
      <!-- Bộ lọc đã lưu (preset): bật lại một cú bấm, lưu bộ lọc đang bật, xoá lọc.
           Bộ lọc lần cuối tự nhớ — quay lại trang không về "tất cả". -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="gap-1.5" :title="t('board.preset.menu')">
            <Icon name="bookmark" class="size-3.5" />
            <span class="max-w-40 truncate">
              {{ activePreset?.name ?? t('board.preset.menu') }}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-64">
          <DropdownMenuItem
            v-for="p in presets"
            :key="p.id"
            class="group"
            @click="applyPreset(p.id)"
          >
            <Icon
              name="check"
              class="size-3.5"
              :class="activePreset?.id === p.id ? 'text-primary' : 'opacity-0'"
            />
            <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              class="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive [&_svg]:size-3"
              :title="t('board.preset.delete')"
              :aria-label="t('board.preset.delete')"
              @click.stop="deletePreset(p.id)"
            >
              <Icon name="x" />
            </Button>
          </DropdownMenuItem>
          <div v-if="!presets.length" class="px-2 py-1.5 text-xs text-muted-foreground">
            {{ t('board.preset.empty') }}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem :disabled="!isFiltered" @click="onSavePreset">
            <Icon name="save" class="size-3.5" />
            {{ activePreset ? t('board.preset.update') : t('board.preset.save') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!isFiltered" @click="clearFilters">
            <Icon name="x" class="size-3.5" />
            {{ t('board.preset.clear') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span class="flex-1" />
      <!-- View toggle — segmented dùng đúng shadcn Tabs (muted track, active nổi). -->
      <Tabs :model-value="view" @update:model-value="(v) => (view = v as typeof view)">
        <TabsList>
          <TabsTrigger value="board" class="size-(--ctrl-h-xs) p-0" :title="t('board.viewBoard')">
            <Icon name="board" class="size-3.5" />
          </TabsTrigger>
          <TabsTrigger value="list" class="size-(--ctrl-h-xs) p-0" :title="t('board.viewList')">
            <Icon name="listul" class="size-3.5" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <div class="flex min-h-0 flex-auto flex-col overflow-hidden">
      <div
        v-if="!projects.length"
        class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
      >
        <span
          class="mb-1 inline-flex size-11 items-center justify-center rounded-lg border bg-muted text-muted-foreground"
        >
          <Icon name="board" class="size-5" />
        </span>
        <div class="text-sm text-muted-foreground">{{ t('board.empty') }}</div>
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
            <span class="flex items-center justify-center p-0" @click.stop>
              <AppCheckbox
                :checked="allVisibleSelected"
                :indeterminate="selected.size > 0 && !allVisibleSelected"
                @update:checked="toggleAllVisible"
              />
            </span>
            <span>{{ t('board.col.issue') }}</span>
            <span>{{ t('board.col.type') }}</span>
            <span>{{ t('board.col.status') }}</span>
            <span>{{ t('board.col.assignee') }}</span>
            <span>{{ t('board.col.project') }}</span>
            <span>{{ t('board.col.updated') }}</span>
          </template>
          <div
            v-for="it in visibleItems"
            :key="`${it.projectId}:${it.id}`"
            class="cl-row"
            :class="{ 'bg-selected': selected.has(itemKey(it)) }"
            @click="boardEl?.openItem(it.id)"
          >
            <div class="cl-cell justify-center p-0" @click.stop>
              <AppCheckbox :checked="selected.has(itemKey(it))" @update:checked="toggleItem(it)" />
            </div>
            <!-- Ô xếp DỌC (tiêu đề + mô tả) bọc trong div riêng: CollectionList đặt
                 `items-center` cho mọi `.cl-cell`, nên căn trái phải nằm ở lớp trong. -->
            <div class="cl-cell">
              <div class="flex w-full min-w-0 flex-col items-start justify-center gap-px">
                <span class="max-w-full truncate text-sm font-medium text-foreground">
                  <span v-if="it.parentId" class="mr-0.5 text-faint">↳</span>
                  {{ it.title }}
                </span>
                <span v-if="it.desc" class="max-w-full truncate text-xs text-muted-foreground">
                  {{ it.desc }}
                </span>
              </div>
            </div>
            <div class="cl-cell">
              <!-- Tag loại việc — màu khớp icon type trên card kanban. -->
              <Badge
                variant="outline"
                class="border-current"
                :class="TYPE_BADGE[it.type ?? 'task']"
              >
                {{ t(`board.type.${it.type ?? 'task'}`) }}
              </Badge>
            </div>
            <div class="cl-cell">
              <Badge variant="outline" :class="STATUS_BADGE[it.status]">
                {{ statusLabel(it.status) }}
              </Badge>
            </div>
            <div class="cl-cell">
              <span v-if="assigneeOf(it)" class="truncate">{{ assigneeOf(it) }}</span>
              <span v-else>—</span>
            </div>
            <div class="cl-cell">
              <span class="truncate">{{ projectName(it.projectId) }}</span>
            </div>
            <div class="cl-cell">
              <span class="truncate">{{ fmtDate(it.updatedAt) }}</span>
            </div>
          </div>
          <div v-if="!visibleItems.length" class="p-8 text-center text-sm text-muted-foreground">
            {{ t('board.noItems') }}
          </div>
        </CollectionList>
      </template>
    </div>

    <!-- Bulk bar — nổi đáy khi list view có tick chọn. -->
    <!-- Bulk bar nổi — đáy giữa, trên mọi nội dung board. -->
    <div
      v-if="selected.size"
      class="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-popover px-3 py-2 shadow-lg"
    >
      <span class="pr-1 text-sm font-semibold text-foreground">
        {{ t('board.bulk.selected', { n: selected.size }) }}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm">
            <Icon name="edit" class="size-3.5" />
            {{ t('board.bulk.status') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem v-for="s in STATUSES" :key="s" @click="bulkSetStatus(s)">
            <Badge variant="outline" :class="STATUS_BADGE[s]">{{ statusLabel(s) }}</Badge>
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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Icon from '~/components/Icon.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import AppCheckbox from '~/components/common/AppCheckbox.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import DropdownMenu from '~/components/ui/dropdown-menu/DropdownMenu.vue'
import DropdownMenuContent from '~/components/ui/dropdown-menu/DropdownMenuContent.vue'
import DropdownMenuItem from '~/components/ui/dropdown-menu/DropdownMenuItem.vue'
import DropdownMenuSeparator from '~/components/ui/dropdown-menu/DropdownMenuSeparator.vue'
import DropdownMenuTrigger from '~/components/ui/dropdown-menu/DropdownMenuTrigger.vue'
import CollectionHeader from '~/components/collection/CollectionHeader.vue'
import CollectionList from '~/components/collection/CollectionList.vue'
import { useConfirm } from '~/composables/useConfirm'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import WorkspaceBoard from '~/components/session/workspace/WorkspaceBoard.vue'
import { exportSlug, saveTextFile } from '~/utils/export'
import {
  BOARD_STATUS_ORDER,
  useBoardStore,
  type BoardItem,
  type BoardItemStatus,
  type BoardItemType,
} from '~/stores/board'
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
// Bộ lọc: '' = tất cả project / mọi loại / mọi mức ưu tiên; sub-issue mặc định ẨN.
// NHỚ lần cuối + preset có tên — useBoardFilters (localStorage, theo người xem).
const {
  filterProject,
  filterType,
  filterPriority,
  showChildren,
  query,
  view,
  presets,
  activePreset,
  isFiltered,
  savePreset,
  applyPreset,
  deletePreset,
  clearFilters,
} = useBoardFilters()
const { prompt } = useTextPrompt()

// Tên gợi ý khi lưu: tên project đang lọc (trường hợp hay gặp nhất: "tập trung vào một
// dự án"), không thì để trống cho người dùng tự đặt.
async function onSavePreset(): Promise<void> {
  const name = await prompt({
    title: t('board.preset.saveTitle'),
    value:
      activePreset.value?.name ?? (filterProject.value ? projectName(filterProject.value) : ''),
    placeholder: t('board.preset.namePh'),
    submitLabel: t('common.save'),
  })
  if (name?.trim()) savePreset(name)
}

const projectFilterOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('board.filterAll') },
  ...projects.value.map((p) => ({ value: p.id, label: p.name })),
])

const typeFilterOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('board.type.all') },
  ...(['epic', 'story', 'task', 'subtask', 'bug'] as const).map((v) => ({
    value: v,
    label: t(`board.type.${v}`),
  })),
])
const prioFilterOpts = computed<AppSelectOption[]>(() => [
  { value: '', label: t('board.prio.all') },
  ...(['urgent', 'high', 'medium', 'low'] as const).map((v) => ({
    value: v,
    label: t(`board.prio.${v}`),
  })),
])

// Picker "giao cho" của editor nhận MỌI session — editor tự scope theo project
// đích của item, và assigneeOf nhìn được tên member của nhóm khác project.
const allSessions = computed(() => sessions.sessions)

const allItems = computed(() => Object.values(board.itemsByProject).flat())
const visibleItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  return allItems.value.filter((i) => {
    if (filterProject.value && i.projectId !== filterProject.value) return false
    if (filterType.value && (i.type ?? 'task') !== filterType.value) return false
    // Item chưa đặt ưu tiên đọc như 'medium' — filter "medium" gom cả hai.
    if (filterPriority.value && (i.priority ?? 'medium') !== filterPriority.value) return false
    if (!showChildren.value && i.parentId) return false
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
const LIST_COLS = '28px minmax(240px,1fr) 90px 110px 140px 140px 96px'

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

// Nhãn + màu status: một nguồn với chip issue / view Issues (useIssueStatus).
const { statusLabel } = useIssueStatus()
// Pill status — class màu ngữ nghĩa (chữ + viền), cùng ý nghĩa với bảng màu của
// useIssueStatus nhưng ở dạng utility thay cho var màu inline.
const STATUS_BADGE: Record<BoardItemStatus, string> = {
  backlog: 'border-muted-foreground text-muted-foreground',
  todo: 'border-info text-info',
  in_progress: 'border-primary text-primary',
  in_review: 'border-warning text-warning',
  changes: 'border-lavender text-lavender',
  pending: 'border-muted-foreground text-muted-foreground',
  blocked: 'border-destructive text-destructive',
  done: 'border-success text-success',
  cancelled: 'border-muted-foreground text-muted-foreground',
}
// Tag loại việc — màu khớp icon type trên card kanban.
const TYPE_BADGE: Record<BoardItemType, string> = {
  epic: 'text-lavender',
  story: 'text-success',
  task: 'text-info',
  subtask: 'text-muted-foreground',
  bug: 'text-destructive',
}
const STATUSES = BOARD_STATUS_ORDER

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

// Deep link `/board?item=<id>&project=<pid>` — chip issue trên header phiên ("Mở
// trên board") mở thẳng modal của issue. Trang nằm trong KeepAlive nên phải WATCH
// query chứ không đọc một lần lúc mount; xoá query sau khi mở để quay lại trang
// không bật modal lần nữa. `flush: 'post'` — chờ WorkspaceBoard mount xong ref.
const route = useRoute()
watch(
  () => route.query.item,
  async (raw) => {
    if (route.path !== '/board' || typeof raw !== 'string' || !raw) return
    const pid = typeof route.query.project === 'string' ? route.query.project : ''
    // Lần đầu vào trang: WorkspaceBoard nằm sau `v-else` (chờ có project) ⇒ phải đợi
    // projects hydrate + một nhịp render thì `boardEl` mới có, không thì link mất.
    if (!projectsStore.loaded) await projectsStore.hydrate()
    if (pid && !board.itemById(raw)) await board.listBoard(pid)
    await nextTick()
    // Người dùng có thể đã rời trang trong lúc chờ — đừng xoá query của trang khác.
    if (route.path !== '/board' || route.query.item !== raw) return
    void boardEl.value?.openItem(raw)
    void navigateTo({ path: route.path }, { replace: true })
  },
  { immediate: true, flush: 'post' },
)

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
  // Chỉ khi danh sách ĐÃ nạp: lúc khởi động `projects` còn rỗng — reset ở nhịp đó là
  // xoá mất bộ lọc vừa khôi phục từ lần trước.
  if (
    projectsStore.loaded &&
    list.length &&
    filterProject.value &&
    !list.some((p) => p.id === filterProject.value)
  ) {
    filterProject.value = ''
  }
  for (const p of list) {
    if (!(p.id in board.itemsByProject)) void board.listBoard(p.id)
  }
})
</script>
