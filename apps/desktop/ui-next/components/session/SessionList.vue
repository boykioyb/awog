<template>
  <!-- Cột danh sách phiên — nền zinc `bg-background`, không viền phải (tay kéo `.rsz`
       đã vẽ một hairline giữa danh sách và chi tiết).
       hook-ok: `.list` do app-shell.css đọc (`.app.compact .list` — drawer ở shell hẹp) -->
  <div id="slistcol" class="list" :class="LIST_CLASS" :style="listStyle">
    <!-- Header proto `p-2 gap-1.5`, cùng nền với các hàng, không đường chia — ô tìm đọc
         thành một dải với hai nút ghost. -->
    <div class="flex items-center gap-1.5 p-2">
      <!-- Proto search idiom: the icon overlays a muted, borderless ui Input. -->
      <div class="relative flex-1">
        <Icon
          name="search"
          class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="filter"
          :placeholder="t('sessions.search.placeholder')"
          class="h-ctrl-sm border-transparent bg-muted pl-8 shadow-none focus-visible:ring-1"
        />
      </div>
      <!-- Tạo phiên. KHÔNG thêm nút thứ hai cạnh nó — header này chỉ vừa đúng ba điều
           khiển (ô tìm · + · ⋯). Thay vào đó `+` mở một menu: phiên đơn · phiên con của
           phiên đang mở (tạo nhóm mới) · hoặc thả vào một nhóm đã có. Chỉ khi KHÔNG có
           lựa chọn nào (chưa mở phiên nào, chưa có nhóm nào) nó mới tạo thẳng. Anchor là
           span RIÊNG của nút này — dùng chung span với nút khác thì hai nút xuống dòng. -->
      <span class="relative">
        <Button
          variant="ghost"
          size="iconSm"
          :title="hasChoice ? t('sessions.newIn.tooltip') : t('sessions.new')"
          :class="newMenu && 'bg-primary/10 text-primary'"
          @click.stop="onNewClick"
        >
          <Icon name="plus" />
        </Button>
        <div v-if="newMenu" class="fixed inset-0 z-40" @click="newMenu = false" />
        <!-- `.list` có `overflow:hidden`, nên một menu absolute rộng hơn cột (280px) bị
             CẮT chứ không tràn ra ngoài. Vì vậy: menu kẹp bề rộng 240px (vừa khít cột hẹp
             nhất), và mọi nhãn mang tên phiên đều truncate — tên đầy đủ nằm ở `title`.
             Menu tự dựng mang `role=dialog` + `data-state=open` để khớp OVERLAYS của
             trình duyệt nhúng. -->
        <div
          v-if="newMenu"
          role="dialog"
          data-state="open"
          :class="MENU"
          class="top-[116%] right-0 max-w-60"
          @click.stop
        >
          <div :class="ITEM" @click="createNew(null)">
            <Icon name="sessions" />
            {{ t('sessions.newIn.standalone') }}
          </div>
          <!-- Phiên đang mở CHƯA là nhóm: cho tạo con ngay dưới nó. Đây là đường DUY
               NHẤT tạo một nhóm mới từ chỗ này — không có nó thì "thêm vào nhóm" chỉ
               dùng được sau khi đã đi xếp nhóm bằng chuột phải ở chỗ khác. -->
          <div
            v-if="activeAsParent"
            :class="ITEM"
            :title="activeAsParent.title"
            @click="createNew(activeAsParent)"
          >
            <Icon name="fork" />
            <span class="min-w-0 flex-auto truncate">{{ t('sessions.newIn.underActive') }}</span>
          </div>
          <template v-if="groupTargets.length">
            <Separator class="my-1" />
            <!-- Nhãn nhóm mục — một dòng, không bẻ. -->
            <div class="px-2.5 py-1 text-xs whitespace-nowrap text-muted-foreground">
              {{ t('sessions.newIn.groupLabel') }}
            </div>
          </template>
          <div
            v-for="g in groupTargets"
            :key="g.engineId"
            :class="ITEM"
            :title="g.title"
            @click="createNew(g)"
          >
            <Icon name="folder" />
            <span class="min-w-0 flex-auto truncate">{{ g.title }}</span>
            <span v-if="g.current" class="ml-auto pl-3.5 text-xs text-faint">
              {{ t('sessions.newIn.currentGroup') }}
            </span>
          </div>
        </div>
      </span>
      <!-- Overflow (session-ui-refactor §3.8): chế độ chọn · bộ lọc · gấp tất cả.
           Ba thao tác dùng vài lần một tuần nhưng đang chiếm chỗ thường trực ngang
           hàng với nút tạo phiên — thứ được bấm mỗi ngày. -->
      <span class="relative">
        <Button
          variant="ghost"
          size="iconSm"
          :title="t('sessions.sidebar.more')"
          :class="(store.selecting || listMenu) && 'bg-primary/10 text-primary'"
          @click.stop="listMenu = !listMenu"
        >
          <Icon name="dots" />
        </Button>
        <div v-if="listMenu" class="fixed inset-0 z-40" @click="listMenu = false" />
        <div
          v-if="listMenu"
          role="dialog"
          data-state="open"
          :class="MENU"
          class="top-[116%] right-0"
          @click.stop
        >
          <div :class="ITEM" @click="runListAction(toggleSelectMode)">
            <Icon name="check" />
            {{
              store.selecting ? t('sessions.sidebar.selectExit') : t('sessions.sidebar.selectMode')
            }}
          </div>
          <div :class="ITEM" @click="runListAction(() => (showFilters = !showFilters))">
            <Icon name="filter" />
            {{ t('sessions.filter.tooltip') }}
            <Icon v-if="showFilters" name="check" class="ml-auto text-primary" />
          </div>
          <div :class="ITEM" @click="runListAction(toggleFoldAll)">
            <Icon name="foldv" />
            {{ t('sessions.foldAll.tooltip') }}
          </div>
          <div :class="ITEM" @click="runListAction(claudeImport.open)">
            <Icon name="download" />
            {{ t('sessions.claudeImport.button') }}
          </div>
        </div>
      </span>
    </div>

    <!-- Drawer bộ lọc: gom nhóm · sắp xếp · hiện phiên lưu trữ. -->
    <div v-if="showFilters" class="flex flex-col gap-2 border-b bg-muted px-3 pt-3 pb-2">
      <div class="flex items-center gap-2.5">
        <span class="w-15.5 flex-none text-sm text-dim">{{ t('sessions.filter.groupBy') }}</span>
        <AppSelect
          :model-value="groupBy"
          :options="groupOptions"
          size="sm"
          width="100%"
          class="flex-1"
          @update:model-value="selectGroup"
        />
      </div>
      <div class="flex items-center gap-2.5">
        <span class="w-15.5 flex-none text-sm text-dim">{{ t('sessions.filter.sortBy') }}</span>
        <AppSelect
          :model-value="sortBy"
          :options="sortOptions"
          size="sm"
          width="100%"
          class="flex-1"
          @update:model-value="selectSort"
        />
      </div>
      <!-- Archived sessions are hidden by default; the toggle pulls them in on first
           use (store.loadArchivedSessions) and then only filters, so flipping it is
           instant. Persisted next to group-by / sort-by. Cả hàng là vùng bấm — ô tick
           chỉ hiển thị (tắt pointer cho khỏi lật hai lần). -->
      <div
        class="group/arch flex cursor-pointer items-center gap-2 select-none"
        @click="toggleShowArchived"
      >
        <Checkbox :model-value="showArchived" class="pointer-events-none" tabindex="-1" />
        <span class="text-sm text-muted-foreground group-hover/arch:text-foreground">
          {{ t('sessionsSearch.archive.show') }}
        </span>
      </div>
    </div>

    <!-- Bulk bar shows whenever select mode is ON — even with 0 selected — so
         select-all and the exit affordance are always reachable. (A context-menu
         "Select" that later ends up with 0 selected used to hide the bar entirely,
         stranding the user in select mode with no way to select-all or exit.) -->
    <div
      v-if="store.selecting"
      class="flex items-center gap-2 border-b bg-muted px-3 py-2 text-sm text-foreground"
    >
      <!-- Cụm trái (ô tick + nhãn) là một vùng bấm cho chọn hết / bỏ chọn hết. -->
      <span
        class="inline-flex min-w-0 cursor-pointer items-center gap-2"
        :title="
          allFilteredSelected ? t('sessions.sidebar.deselectAll') : t('sessions.sidebar.selectAll')
        "
        @click="selectAllFiltered"
      >
        <Checkbox :model-value="allFilteredSelected" class="pointer-events-none" tabindex="-1" />
        <span>
          {{
            selectedCount
              ? t('sessions.sidebar.selected', { n: selectedCount })
              : t('sessions.sidebar.selectAll')
          }}
        </span>
      </span>
      <span class="flex-1" />
      <Button
        v-if="selectedCount"
        variant="ghost"
        size="iconSm"
        class="size-5.5 text-destructive hover:text-destructive [&_svg]:size-3.5"
        :title="t('sessions.sidebar.deleteSelected')"
        @click="askBulkRemove"
      >
        <Icon name="trash" />
      </Button>
      <Button
        variant="ghost"
        size="iconSm"
        class="size-5.5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
        :title="t('sessions.sidebar.selectExit')"
        @click="store.setSelectMode(false)"
      >
        <Icon name="x" />
      </Button>
    </div>

    <!-- Hàng cuộn dưới container proto `p-2 pt-0`: chỉ lề hai bên + đáy; padding dưới
         của header đã lo khe trên hàng đầu. -->
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <template v-if="groupBy === 'none'">
        <template v-if="filtered.length">
          <div>
            <SessionListItem
              v-for="s in flatPage.items"
              :key="s.id"
              :session="s"
              :active="s.id === activeId"
              :selecting="store.selecting"
              hide-project
              :rename-req="renameReq"
              :menu-open="ctx.target.value?.id === s.id"
              @click="$emit('select', s.id)"
              @ctxmenu="(p) => openCtx(p, s)"
            />
          </div>
          <!-- Phân trang mỗi khu: trước/sau + "Trang X / Y", căn giữa, nhẹ. -->
          <div
            v-if="flatPage.totalPages > 1"
            class="mt-0.5 mb-1.5 flex items-center justify-center gap-2 py-0.5"
          >
            <Button
              variant="ghost"
              size="iconSm"
              :class="PAGE_BTN"
              type="button"
              :disabled="flatPage.page <= 1"
              :title="t('sessions.list.pagePrev')"
              @click="setPage(FLAT_KEY, flatPage.page - 1)"
            >
              <Icon name="chev" class="rotate-90" />
            </Button>
            <span class="min-w-17 text-center text-sm text-muted-foreground tabular-nums">
              {{ t('sessions.list.pageOf', { page: flatPage.page, total: flatPage.totalPages }) }}
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              :class="PAGE_BTN"
              type="button"
              :disabled="flatPage.page >= flatPage.totalPages"
              :title="t('sessions.list.pageNext')"
              @click="setPage(FLAT_KEY, flatPage.page + 1)"
            >
              <Icon name="chev" class="-rotate-90" />
            </Button>
          </div>
        </template>
        <div v-else :class="EMPTY">{{ t('sessions.list.noMatch') }}</div>
      </template>
      <!-- Chế độ "Nhóm": cây kiểu trang Notion, phiên con nằm dưới phiên cha. Cây đã
           được làm phẳng thành mảng có `depth` (useSessionTree) nên đây vẫn là MỘT
           v-for phẳng — hàng phiên giữ nguyên rename inline / select / context menu. -->
      <template v-else-if="groupBy === 'tree'">
        <template v-if="treeRows.length">
          <div>
            <SessionListItem
              v-for="r in treeRows"
              :key="r.session.id"
              :session="r.session"
              :active="r.session.id === activeId"
              :selecting="store.selecting"
              hide-project
              :rename-req="renameReq"
              :depth="r.depth"
              :has-children="r.hasChildren"
              :collapsed="r.collapsed"
              :descendants="r.descendants"
              :in-group="r.inGroup"
              :group-top="r.groupTop"
              :group-bottom="r.groupBottom"
              :menu-open="ctx.target.value?.id === r.session.id"
              @click="$emit('select', r.session.id)"
              @ctxmenu="(p) => openCtx(p, r.session)"
              @toggle-children="toggleTree(r.session.engineId)"
            />
          </div>
          <div
            v-if="treeTotalPages > 1"
            class="mt-0.5 mb-1.5 flex items-center justify-center gap-2 py-0.5"
          >
            <Button
              variant="ghost"
              size="iconSm"
              :class="PAGE_BTN"
              type="button"
              :disabled="treePage <= 1"
              :title="t('sessions.list.pagePrev')"
              @click="setTreePage(treePage - 1)"
            >
              <Icon name="chev" class="rotate-90" />
            </Button>
            <span class="min-w-17 text-center text-sm text-muted-foreground tabular-nums">
              {{ t('sessions.list.pageOf', { page: treePage, total: treeTotalPages }) }}
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              :class="PAGE_BTN"
              type="button"
              :disabled="treePage >= treeTotalPages"
              :title="t('sessions.list.pageNext')"
              @click="setTreePage(treePage + 1)"
            >
              <Icon name="chev" class="-rotate-90" />
            </Button>
          </div>
        </template>
        <div v-else :class="EMPTY">{{ t('sessions.list.noMatch') }}</div>
      </template>
      <template v-else>
        <template v-if="groups.length">
          <!-- Mỗi nhóm là một khối riêng, cách nhau 11px. -->
          <div
            v-for="(grp, gi) in groups"
            :key="grp.key"
            class="mb-0.5"
            :class="{ 'mt-2.75': gi > 0 }"
            :data-grp="grp.key"
          >
            <!-- Header nhóm (provider / model / agent / unread): nhãn mục nhỏ trên nền
                 sidebar, dính trên cùng khi cuộn qua các hàng của nó; hairline dưới để
                 đọc như một vạch chia chứ không phải thêm một hàng. -->
            <div
              class="group/grph sticky top-0 z-2 flex cursor-pointer items-center gap-2 border-b bg-sidebar px-2.25 py-1.75 select-none hover:bg-accent"
              @click="toggleGroup(grp.key)"
            >
              <Icon
                name="chev"
                class="size-3 flex-none text-faint transition-transform motion-reduce:transition-none"
                :class="[collapsed[grp.key] ? '-rotate-90' : '']"
              />
              <span class="size-2.25 flex-none rounded-sm" :style="{ background: grp.dot }" />
              <span
                class="text-xs font-semibold text-muted-foreground group-hover/grph:text-foreground"
              >
                {{ grp.label }}
              </span>
              <span class="ml-auto text-xs text-muted-foreground tabular-nums">
                {{ grp.total }}
              </span>
            </div>
            <div class="pt-1" :class="{ hidden: collapsed[grp.key] }">
              <SessionListItem
                v-for="s in grp.items"
                :key="s.id"
                :session="s"
                :active="s.id === activeId"
                :selecting="store.selecting"
                hide-project
                :rename-req="renameReq"
                :menu-open="ctx.target.value?.id === s.id"
                @click="$emit('select', s.id)"
                @ctxmenu="(p) => openCtx(p, s)"
              />
              <div
                v-if="grp.totalPages > 1"
                class="mt-0.5 mb-1.5 flex items-center justify-center gap-2 py-0.5"
              >
                <Button
                  variant="ghost"
                  size="iconSm"
                  :class="PAGE_BTN"
                  type="button"
                  :disabled="grp.page <= 1"
                  :title="t('sessions.list.pagePrev')"
                  @click="setPage(grp.key, grp.page - 1)"
                >
                  <Icon name="chev" class="rotate-90" />
                </Button>
                <span class="min-w-17 text-center text-sm text-muted-foreground tabular-nums">
                  {{ t('sessions.list.pageOf', { page: grp.page, total: grp.totalPages }) }}
                </span>
                <Button
                  variant="ghost"
                  size="iconSm"
                  :class="PAGE_BTN"
                  type="button"
                  :disabled="grp.page >= grp.totalPages"
                  :title="t('sessions.list.pageNext')"
                  @click="setPage(grp.key, grp.page + 1)"
                >
                  <Icon name="chev" class="-rotate-90" />
                </Button>
              </div>
            </div>
          </div>
        </template>
        <div v-else :class="EMPTY">{{ t('sessions.list.noMatch') }}</div>
      </template>
    </div>

    <!-- Cross-session content search (docs/features/cross-session-search.md). The box
         above still filters TITLES instantly and locally; this section answers the
         other half — which transcript, anywhere, contains this text. Neo dưới danh
         sách (danh sách co lại), trần 46% để phía trên luôn còn vài hàng, tự cuộn. -->
    <div v-if="searchOpen" class="flex max-h-[46%] min-h-0 flex-none flex-col border-t bg-muted">
      <div class="flex items-center gap-1.75 px-2.75 py-1.75 text-muted-foreground">
        <Icon name="search" class="size-3" />
        <span class="text-xs font-semibold">{{ t('sessionsSearch.section.title') }}</span>
        <span v-if="hits.length" class="ml-auto text-xs text-muted-foreground tabular-nums">
          {{ hits.length }}
        </span>
      </div>
      <div class="overflow-y-auto px-1.75 pb-1.75">
        <div v-if="searchLoading" :class="NOTE">{{ t('sessionsSearch.loading') }}</div>
        <div v-else-if="searchError" :class="NOTE" class="text-destructive">
          {{ searchError }}
        </div>
        <template v-else-if="hits.length">
          <div :class="NOTE">{{ t('sessionsSearch.hint') }}</div>
          <div
            v-for="h in hits"
            :key="`${h.sessionId}:${h.messageId}`"
            class="cursor-pointer rounded-md border border-transparent px-2 py-1.75 hover:bg-accent"
            @click="openHit(h)"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {{ h.sessionTitle }}
              </span>
              <span class="flex-none text-xs text-muted-foreground tabular-nums">
                {{ hitTime(h.at) }}
              </span>
            </div>
            <!-- Hai dòng ngữ cảnh là đủ nhận ra kết quả; phần còn lại nằm trong phiên. -->
            <div class="mt-0.75 line-clamp-2 text-xs leading-(--lh-sm) text-muted-foreground">
              <span class="mr-1.25 text-muted-foreground">
                {{ t(`sessionsSearch.role.${h.role}`) }}
              </span>
              <span
                v-for="(part, i) in snippetParts(h)"
                :key="i"
                :class="{ 'rounded-sm bg-primary/16 font-semibold text-foreground': part.hit }"
              >
                {{ part.text }}
              </span>
            </div>
          </div>
          <div v-if="searchTruncated" :class="NOTE">
            {{ t('sessionsSearch.truncated', { n: hits.length }) }}
          </div>
          <!-- Phiên đã lưu trữ bị loại khỏi kết quả. Nói ra, nếu không người dùng
               tìm mãi không thấy mà không hiểu vì sao. -->
          <div v-if="searchArchivedHidden > 0" :class="NOTE">
            {{ t('sessionsSearch.archivedHidden', { n: searchArchivedHidden }) }}
          </div>
        </template>
        <div v-else :class="NOTE">{{ t('sessionsSearch.empty', { q: filter.trim() }) }}</div>
      </div>
    </div>

    <SessionRunPicker
      v-if="runPickerFor"
      :session="runPickerFor"
      :sessions="props.sessions"
      @pick="applyRunPick"
      @close="runPickerFor = null"
    />

    <!-- Right-click context menu — items from the shared `useSessionActions`. -->
    <Teleport to="body">
      <AppContextMenu
        :open="ctx.pos.value !== null"
        :position="ctx.pos.value ?? { x: 0, y: 0 }"
        :items="ctxItems"
        @close="ctx.close()"
        @select="onCtxSelect"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// Session list column for the active project tab: search, a group-by drawer
// (tree/provider/model/unread/none — project grouping now lives in the SessionTabBar),
// select mode + bulk bar, and a per-row context menu. The page passes
// `store.tabSessions` (the active tab's sessions), so this list is always scoped to
// one project; rows hide their project label since the tab already names it.
import { isBoardSession } from '~/composables/useSessionsData'
import type { Session, SortBy } from '~/composables/useSessionsData'
import { PROJECT_COLOR_DEFAULT } from '~/composables/useProjectColors'
import {
  highlightSnippet,
  SESSION_SEARCH_MIN_CHARS,
  useSessionSearch,
  type SessionSearchHit,
} from '~/composables/useSessionSearch'
import AppContextMenu from '~/components/common/AppContextMenu.vue'

const props = defineProps<{ sessions: Session[]; activeId: number | null; listWidth: number }>()

// ── Class dùng chung trong template ──
const LIST_CLASS = 'flex min-w-0 flex-col overflow-hidden border-r-0 bg-background'
// Bề rộng cột áp inline kèm !important để thắng `.list{flex:0 0 auto}` của prototype và
// luật media ≤720px `width:192px !important` ở mọi breakpoint, cập nhật sống khi kéo.
const listStyle = computed(() => ({
  flex: `0 0 ${props.listWidth}px !important`,
  width: `${props.listWidth}px !important`,
}))
// Menu tự dựng (neo absolute dưới nút) + hàng mục.
const MENU =
  'absolute z-50 min-w-44 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md'
const ITEM =
  'flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-3.5'
const PAGE_BTN =
  'size-5.5 text-muted-foreground hover:text-primary disabled:opacity-50 [&_svg]:size-3.5'
const EMPTY = 'px-3.5 py-8.5 text-center text-sm text-muted-foreground'
const NOTE = 'px-1 py-1.5 text-xs leading-(--lh-sm) text-muted-foreground'

const emit = defineEmits<{ select: [id: number] }>()

const { t } = useI18n()
const { GROUPBY, SORTBY, providerOf } = useSessionsData()
const store = useSessionsStore()
const { confirm } = useConfirm()
const claudeImport = useClaudeImportModal()

// Confirm before deleting selected sessions (bulk bar trash). Destructive +
// unrecoverable, so gate even though the rows are explicitly selected.
async function askBulkRemove() {
  const n = selectedCount.value
  if (!n) return
  const ok = await confirm({
    title: t('sessions.delete.manyTitle', { n }),
    description: t('sessions.delete.many', { n }),
  })
  if (ok) store.bulkRemove()
}

// Group-by persists across restarts via localStorage; search text stays transient
// (a per-look query, not a saved preference). The project filter moved to the tab
// bar, so a persisted legacy 'project' value no longer matches GROUPBY → 'none'.
const STORAGE_GROUPBY = 'awog.sessions.filter.groupBy'

function readGroupBy(): string {
  const v = localStorage.getItem(STORAGE_GROUPBY)
  return v && GROUPBY.some(([value]) => value === v) ? v : 'none'
}

// "Show archived" is a saved preference like group-by / sort-by (same key family).
// Default OFF: archived sessions stay out of the way until asked for.
const STORAGE_SHOW_ARCHIVED = 'awog.sessions.filter.showArchived'

const filter = ref('')
const groupBy = ref(readGroupBy())
// Sort-by dùng chung với view Phiên của workbench (useSessionSort — nhớ qua restart,
// mặc định 'updated').
const { sortBy, sortSessions } = useSessionSort()
const showArchived = ref(localStorage.getItem(STORAGE_SHOW_ARCHIVED) === '1')
const showFilters = ref(false)
const listMenu = ref(false)
// Mỗi hàng đóng menu rồi chạy đúng handler mà nút cũ của nó gọi.
function runListAction(fn: () => void) {
  listMenu.value = false
  fn()
}

watch(groupBy, (v) => localStorage.setItem(STORAGE_GROUPBY, v))
watch(
  showArchived,
  (v) => {
    localStorage.setItem(STORAGE_SHOW_ARCHIVED, v ? '1' : '0')
    // sessions.list omits archived sessions, so the first "show" needs one extra
    // pull; afterwards the toggle is pure client-side filtering.
    if (v) void store.loadArchivedSessions()
  },
  { immediate: true },
)
function toggleShowArchived() {
  showArchived.value = !showArchived.value
}

// ── Cross-session content search ──────────────────────────────────────────────
// Second, asynchronous half of the search box: `sessions.search` scans every
// transcript on disk. Debounce + race guard live in the composable.
const {
  results: hits,
  loading: searchLoading,
  error: searchError,
  truncated: searchTruncated,
  archivedHidden: searchArchivedHidden,
  matchedQuery,
} = useSessionSearch(() => filter.value)

const searchOpen = computed(() => filter.value.trim().length >= SESSION_SEARCH_MIN_CHARS)

// Static "3 giờ trước" label for a hit (results are transient — no live ticking
// like the list rows, which re-render off useNow). Wrapped in a script binding so
// the template does not depend on a bare auto-import.
function hitTime(at: string): string {
  return relativeTime(at)
}

// Emphasis follows the query the RESULTS belong to, never the live input — while a
// new query is in flight the rows on screen are already cleared, so the two can't
// disagree.
function snippetParts(h: SessionSearchHit) {
  return highlightSnippet(h.snippet, matchedQuery.value)
}

// Open the session holding the match and hand the message anchor to the transcript
// surface (the list column is a sibling of the detail column, so it cannot inject
// that surface itself — ADR 0075). An archived session is not in the list until it
// has been pulled in, hence the one retry.
async function openHit(h: SessionSearchHit) {
  let opened = await store.openByEngineId(h.sessionId)
  if (!opened) {
    await store.loadArchivedSessions()
    opened = await store.openByEngineId(h.sessionId)
  }
  if (!opened) {
    useToast().add({ title: t('sessionsSearch.open.notFound'), color: 'error' })
    return
  }
  const s = store.sessions.find((x) => x.engineId === h.sessionId)
  if (s) store.requestMessageJump(s.id, h.messageId)
}

// Multi-select mode (§1) lives in the store (the tab context menu also enters it);
// when on, every row shows its checkbox and a row click toggles selection. The bulk
// bar appears whenever ≥1 session is selected.
const selectedCount = computed(() => store.selectedIds.size)
// Whether every currently-visible (filtered) row is selected — drives the select-all
// toggle's checked state + its title (Select all ↔ Deselect all).
const allFilteredSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((s) => store.selectedIds.has(s.id)),
)
function toggleSelectMode() {
  store.setSelectMode(!store.selecting)
}
// Toggle-all over the currently visible (filtered) sessions: if every visible row is
// already selected, clear; otherwise select the ones not yet selected.
function selectAllFiltered() {
  const allSelected = filtered.value.every((s) => store.selectedIds.has(s.id))
  if (allSelected) store.clearSelection()
  else
    filtered.value.forEach((s) => {
      if (!store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
}

// Group-by / sort-by: AppSelect (ruột shadcn Select) tự lo mở/đóng, click ra ngoài.
const groupOptions = computed(() =>
  GROUPBY.map(([value]) => ({ value, label: t(`sessions.team.${value}`) })),
)
const sortOptions = computed(() =>
  SORTBY.map((value) => ({ value, label: t(`sessions.sort.${value}`) })),
)

// Per-group collapse state, keyed by the group's stable key (groupKeyOf).
const collapsed = ref<Record<string, boolean>>({})

// Epoch ms of an ISO timestamp (0 when missing/invalid) — for the time-based sorts.
const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  // Archived rows are out unless the filter drawer asks for them. Phiên "của
  // board" (member/lead của một team run — `teamId`; lone-agent dispatch —
  // `origin:'board'`) cũng ẩn: vòng đời của chúng sống trong board item và
  // trang Teams, không phải danh sách chat (isBoardSession).
  const f = props.sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(q) &&
      (showArchived.value || !store.isArchived(s.id)) &&
      !isBoardSession(s),
  )
  // Pinned-first, then the chosen sort. Applies to the flat list and — since buckets
  // are filled from this order — keeps pinned sessions atop each group too.
  return sortSessions(f)
})

// Per-group pagination (UI-5) — a controlled page instead of infinite/virtual scroll.
// Each group (and the flat list, keyed as FLAT_KEY) tracks its own zero-based page
// index in `pageIndex`; only the current page's rows render, keeping the DOM small.
// Bulk/select actions still operate on the full `filtered` set, not what's rendered.
const SESSIONS_PAGE_SIZE = 20
const FLAT_KEY = '__flat__'

// Zero-based page index keyed by group key (FLAT_KEY for the flat list). Absent
// keys fall back to page 0. Reassigning the record (not mutating) keeps readers
// reactive — same discipline as useGroupLoadMore's limits map.
const pageIndex = ref<Record<string, number>>({})
const pageOf = (key: string) => pageIndex.value[key] ?? 0
// Total pages for a bucket of `count` items (≥1 so an empty bucket still reads "1/1").
const totalPagesOf = (count: number) => Math.max(1, Math.ceil(count / SESSIONS_PAGE_SIZE))
// Clamp + set a group's page. Consumers pass 1-based page numbers (the UI shows
// "Page X / Y"); we store zero-based. next/prev overshoot is clamped here, so the
// pager buttons can stay dumb.
function setPage(key: string, page1Based: number) {
  const items = key === FLAT_KEY ? filtered.value.length : groupCount(key)
  const max = totalPagesOf(items)
  const clamped = Math.min(Math.max(page1Based, 1), max)
  pageIndex.value = { ...pageIndex.value, [key]: clamped - 1 }
}

// Snap every group + the flat list back to page 1 (clear the map) when the query
// narrows (results from the top) OR when group/sort/tab changes — otherwise a page
// index from the previous view would point past a smaller result set. A new session
// appearing live in the same tab must NOT reset paging (handled by not watching
// `filtered` here — only the user-driven controls).
watch([filter, groupBy, sortBy, () => store.activeTab], () => {
  pageIndex.value = {}
})

// The flat list's current page: the 20-row slice plus its 1-based page / total for
// the pager. Clamps the stored index against live count so a deletion that empties
// the last page falls back to a valid page without needing a separate watcher.
const flatPage = computed(() => {
  const all = filtered.value
  const totalPages = totalPagesOf(all.length)
  const page = Math.min(pageOf(FLAT_KEY), totalPages - 1)
  const start = page * SESSIONS_PAGE_SIZE
  return { items: all.slice(start, start + SESSIONS_PAGE_SIZE), page: page + 1, totalPages }
})

// Stable identity for a bucket. Project grouping is gone (the tab is the project),
// so the buckets are provider / model / the unread split.
function groupKeyOf(s: Session): string {
  if (groupBy.value === 'provider') return providerOf(s.account)
  if (groupBy.value === 'unread') return s.unread ? 'unreadBucket' : 'read'
  if (groupBy.value === 'agent') return s.agent?.id ?? 'noAgent'
  return s.model
}
function groupLabelOf(key: string): string {
  // Unread/read + phiên không bind agent đi qua i18n; provider/model/agent id
  // hiện giá trị thô.
  if (groupBy.value === 'unread' || (groupBy.value === 'agent' && key === 'noAgent'))
    return t(`sessions.team.${key}`)
  return key
}

// Filtered sessions bucketed by group key (full buckets, not yet paginated).
// `groups` slices these to the current page; `groupCount` reads sizes for clamping.
const buckets = computed(() => {
  const map = new Map<string, Session[]>()
  filtered.value.forEach((s) => {
    const k = groupKeyOf(s)
    const bucket = map.get(k)
    if (bucket) bucket.push(s)
    else map.set(k, [s])
  })
  return map
})
function groupCount(key: string): number {
  return buckets.value.get(key)?.length ?? 0
}

const groups = computed(() =>
  [...buckets.value.entries()].map(([key, all]) => {
    const totalPages = totalPagesOf(all.length)
    // Clamp against live size so deleting the last row on a group's final page
    // falls back to a valid page (per-group clamp, no separate watcher).
    const page = Math.min(pageOf(key), totalPages - 1)
    const start = page * SESSIONS_PAGE_SIZE
    return {
      key,
      label: groupLabelOf(key),
      // Header count reflects the whole group (all pages), not the current slice.
      total: all.length,
      // Only the current page's rows render (DOM stays small).
      items: all.slice(start, start + SESSIONS_PAGE_SIZE),
      page: page + 1,
      totalPages,
      // No per-bucket color (provider/model/unread aren't projects) — neutral dot.
      dot: PROJECT_COLOR_DEFAULT,
    }
  }),
)

function selectGroup(value: string) {
  groupBy.value = value
}
function selectSort(value: string) {
  sortBy.value = value as SortBy
}

// ── Tạo phiên: đơn, hay nằm trong một nhóm ───────────────────────────────────
// Menu liệt kê MỌI nhóm đang có, không chỉ nhóm của phiên đang mở. Bản đầu gate theo
// "phiên đang mở có thuộc nhóm không" — nên đứng ở một phiên lẻ là `+` tạo thẳng và
// người dùng không bao giờ thấy dropdown. Gate đúng là "có nhóm nào tồn tại không":
// không có nhóm nào thì menu chỉ còn một mục thật, mở ra cũng để làm gì.
//
// Quét TOÀN BỘ store chứ không phải `props.sessions` (đã lọc theo tab project): một
// nhóm không nhất thiết nằm trong project đang mở.
const newMenu = ref(false)

type GroupTarget = { engineId: string; title: string; project: string; current: boolean }
const groupTargets = computed<GroupTarget[]>(() => {
  const all = store.sessions
  const active = all.find((s) => s.id === props.activeId)
  const activeRoot = active ? store.groupRootEid(active) : undefined
  // Gốc nhóm = phiên không có cha VÀ có ít nhất một con.
  const parents = new Set(all.map((s) => s.teamRunId).filter(Boolean) as string[])
  return (
    all
      .filter((s) => s.engineId && !s.teamRunId && parents.has(s.engineId))
      .map((s) => ({
        engineId: s.engineId as string,
        title: s.title,
        project: s.project,
        current: s.engineId === activeRoot,
      }))
      // Nhóm của phiên đang mở lên đầu — đó là thứ người dùng hay chọn nhất.
      .sort((a, b) => Number(b.current) - Number(a.current))
  )
})

// Phiên đang mở, khi nó CHƯA phải gốc của một nhóm nào (những gốc đó đã nằm trong
// `groupTargets`). Chọn mục này biến nó thành gốc — tức tạo nhóm ngay tại đây.
const activeAsParent = computed<GroupTarget | null>(() => {
  const active = store.sessions.find((s) => s.id === props.activeId)
  if (!active?.engineId) return null
  // Nhóm chỉ có HAI CẤP: một phiên đã là con thì không làm cha được. Nhóm của nó đã
  // nằm trong `groupTargets` rồi, nên người dùng vẫn thêm được vào đúng nhóm đó.
  if (active.teamRunId) return null
  if (groupTargets.value.some((g) => g.engineId === active.engineId)) return null
  return {
    engineId: active.engineId,
    title: active.title,
    project: active.project,
    current: false,
  }
})

// Có gì để CHỌN không. Không có thì `+` tạo thẳng — mở một menu chỉ có đúng một mục
// thật là bắt người dùng bấm thêm một nhát để không được lựa chọn gì.
const hasChoice = computed(() => groupTargets.value.length > 0 || activeAsParent.value !== null)

function onNewClick() {
  if (hasChoice.value) newMenu.value = !newMenu.value
  else createNew(null)
}
// Phiên con sinh ra trong project của CHÍNH NHÓM, không phải tab đang mở: xếp một phiên
// vào nhóm ở project khác rồi để nó mang project khác là tự tạo một hàng mồ côi.
function createNew(target: GroupTarget | null) {
  newMenu.value = false
  if (target) store.create(target.project || undefined, undefined, target.engineId)
  else store.create(store.activeTab || undefined)
}

// ── Chế độ xem "Nhóm" (cây kiểu trang Notion) ─────────────────────────────────
// Dựng trên `filtered` nên tìm kiếm + "Sort by" + bộ lọc lưu trữ vẫn có tác dụng
// BÊN TRONG cây; phân trang của cây đếm theo GỐC (một nhóm không bị cắt đôi giữa
// hai trang) nên nó không dùng chung `pageIndex` với các chế độ gom nhóm kia.
const {
  rows: treeRows,
  page: treePage,
  totalPages: treeTotalPages,
  setPage: setTreePage,
  toggle: toggleTree,
} = useSessionTree(() => filtered.value)

// Phiên đang mở hộp chọn nhóm (null = hộp đóng).
const runPickerFor = ref<Session | null>(null)

// Đóng hộp NGAY khi chọn, không đợi RPC: thao tác sai (chu trình, phiên chưa lưu) đã
// được lọc khỏi danh sách ứng viên và vẫn bị sidecar chặn, còn giữ hộp mở trong lúc
// chờ thì người dùng bấm được lần thứ hai vào một dòng khác.
function applyRunPick(parentClientId: number | null, role: string | null) {
  const s = runPickerFor.value
  runPickerFor.value = null
  if (s) void store.setRunMembership(s.id, parentClientId, role)
}

// ── Right-click context menu ───────────────────────────────────────────────────
// Items + handlers come from `useSessionActions` (shared with the Workbench sessions
// explorer); this column only supplies the UI-local hooks. `renameReq` signals a row
// to start its inline rename (the edit state is local to SessionListItem).
const ctx = useContextMenu<Session>()
const renameReq = ref<{ id: number; n: number }>({ id: -1, n: 0 })
const actions = useSessionActions({
  open: (s) => emit('select', s.id),
  rename: (s) => {
    renameReq.value = { id: s.id, n: renameReq.value.n + 1 }
  },
  group: (s) => {
    runPickerFor.value = s
  },
})
const ctxItems = computed(() =>
  ctx.target.value ? actions.items(ctx.target.value, { select: true }) : [],
)

function openCtx(p: { id: number; x: number; y: number }, s: Session) {
  ctx.open(new MouseEvent('contextmenu', { clientX: p.x, clientY: p.y }), s)
}
async function onCtxSelect(id: string) {
  const s = ctx.target.value
  ctx.close() // close the menu before any dialog opens
  if (s) await actions.run(id, s)
}

function toggleGroup(key: string) {
  collapsed.value[key] = !collapsed.value[key]
}
// Fold-all: if any current group is expanded, collapse them all; else expand all.
function toggleFoldAll() {
  const keys = groups.value.map((g) => g.key)
  const collapseAll = keys.some((k) => !collapsed.value[k])
  const next: Record<string, boolean> = {}
  keys.forEach((k) => {
    next[k] = collapseAll
  })
  collapsed.value = next
}
</script>
