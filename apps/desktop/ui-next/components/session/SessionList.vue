<template>
  <div
    id="slistcol"
    class="list"
    :class="{ selecting: store.selecting }"
    :style="{ flex: `0 0 ${listWidth}px !important`, width: `${listWidth}px !important` }"
  >
    <div class="ltop">
      <div class="srch">
        <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <input v-model="filter" :placeholder="t('sessions.search.placeholder')" />
      </div>
      <!-- Tạo phiên. KHÔNG thêm nút thứ hai cạnh nó — header này chỉ vừa đúng ba điều
           khiển (ô tìm · + · ⋯). Thay vào đó `+` mở một menu: phiên đơn · phiên con của
           phiên đang mở (tạo nhóm mới) · hoặc thả vào một nhóm đã có. Chỉ khi KHÔNG có
           lựa chọn nào (chưa mở phiên nào, chưa có nhóm nào) nó mới tạo thẳng. Anchor là
           span RIÊNG của nút này — dùng chung span với nút khác thì hai nút xuống dòng. -->
      <span style="position: relative">
        <button
          class="iconbtn"
          :title="hasChoice ? t('sessions.newIn.tooltip') : t('sessions.new')"
          style="width: 28px; height: 28px"
          :style="newMenu ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}"
          @click.stop="onNewClick"
        >
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <div
          v-if="newMenu"
          style="position: fixed; inset: 0; z-index: 40"
          @click="newMenu = false"
        />
        <!-- `.list` có `overflow:hidden`, nên một menu absolute rộng hơn cột (280px) bị
             CẮT chứ không tràn ra ngoài. Vì vậy: menu kẹp bề rộng, và mọi nhãn mang tên
             phiên đều truncate — tên đầy đủ nằm ở `title`. -->
        <div
          v-if="newMenu"
          class="smenu newmenu"
          style="position: absolute; top: 116%; right: 0; z-index: 50"
          @click.stop
        >
          <div class="mi" @click="createNew(null)">
            <Icon name="sessions" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('sessions.newIn.standalone') }}
          </div>
          <!-- Phiên đang mở CHƯA là nhóm: cho tạo con ngay dưới nó. Đây là đường DUY
               NHẤT tạo một nhóm mới từ chỗ này — không có nó thì "thêm vào nhóm" chỉ
               dùng được sau khi đã đi xếp nhóm bằng chuột phải ở chỗ khác. -->
          <div
            v-if="activeAsParent"
            class="mi"
            :title="activeAsParent.title"
            @click="createNew(activeAsParent)"
          >
            <Icon name="fork" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="nmt">{{ t('sessions.newIn.underActive') }}</span>
          </div>
          <template v-if="groupTargets.length">
            <div class="msep" />
            <div class="nmlbl">{{ t('sessions.newIn.groupLabel') }}</div>
          </template>
          <div
            v-for="g in groupTargets"
            :key="g.engineId"
            class="mi"
            :title="g.title"
            @click="createNew(g)"
          >
            <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="nmt">{{ g.title }}</span>
            <span v-if="g.current" class="kb">{{ t('sessions.newIn.currentGroup') }}</span>
          </div>
        </div>
      </span>
      <!-- Overflow (session-ui-refactor §3.8): chế độ chọn · bộ lọc · gấp tất cả.
           Ba thao tác dùng vài lần một tuần nhưng đang chiếm chỗ thường trực ngang
           hàng với nút tạo phiên — thứ được bấm mỗi ngày. -->
      <span style="position: relative">
        <button
          class="iconbtn"
          :title="t('sessions.sidebar.more')"
          style="width: 28px; height: 28px"
          :style="
            store.selecting || listMenu
              ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
              : {}
          "
          @click.stop="listMenu = !listMenu"
        >
          <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <div
          v-if="listMenu"
          style="position: fixed; inset: 0; z-index: 40"
          @click="listMenu = false"
        />
        <div
          v-if="listMenu"
          class="smenu"
          style="position: absolute; top: 116%; right: 0; z-index: 50"
          @click.stop
        >
          <div class="mi" @click="runListAction(toggleSelectMode)">
            <Icon name="check" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{
              store.selecting ? t('sessions.sidebar.selectExit') : t('sessions.sidebar.selectMode')
            }}
          </div>
          <div class="mi" @click="runListAction(() => (showFilters = !showFilters))">
            <Icon name="filter" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('sessions.filter.tooltip') }}
            <Icon
              v-if="showFilters"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
          </div>
          <div class="mi" @click="runListAction(toggleFoldAll)">
            <Icon name="foldv" style="width: var(--icon-sm); height: var(--icon-sm)" />
            {{ t('sessions.foldAll.tooltip') }}
          </div>
        </div>
      </span>
    </div>

    <div v-if="showFilters" class="sfdrawer">
      <div class="csrow">
        <span class="cslbl">{{ t('sessions.filter.groupBy') }}</span>
        <div class="csval" style="position: relative" @click.stop="openGroupMenu">
          {{ groupByLabel }}
          <Icon name="chev" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <div
            v-if="groupMenu"
            class="smenu"
            style="position: absolute; top: 116%; left: 0; right: 0; z-index: 50"
            @click.stop
          >
            <div v-for="[value] in GROUPBY" :key="value" class="mi" @click="selectGroup(value)">
              {{ t(`sessions.group.${value}`) }}
              <Icon
                v-if="value === groupBy"
                name="check"
                class="ck"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </div>
          </div>
        </div>
      </div>
      <div class="csrow">
        <span class="cslbl">{{ t('sessions.filter.sortBy') }}</span>
        <div class="csval" style="position: relative" @click.stop="openSortMenu">
          {{ sortByLabel }}
          <Icon name="chev" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <div
            v-if="sortMenu"
            class="smenu"
            style="position: absolute; top: 116%; left: 0; right: 0; z-index: 50"
            @click.stop
          >
            <div v-for="value in SORTBY" :key="value" class="mi" @click="selectSort(value)">
              {{ t(`sessions.sort.${value}`) }}
              <Icon
                v-if="value === sortBy"
                name="check"
                class="ck"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
            </div>
          </div>
        </div>
      </div>
      <!-- Archived sessions are hidden by default; the toggle pulls them in on first
           use (store.loadArchivedSessions) and then only filters, so flipping it is
           instant. Persisted next to group-by / sort-by. -->
      <div class="csrow arch" @click="toggleShowArchived">
        <span class="lcbox" :class="{ on: showArchived }">
          <Icon
            v-if="showArchived"
            name="check"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
        </span>
        <span class="archlbl">{{ t('sessionsSearch.archive.show') }}</span>
      </div>
    </div>

    <!-- Bulk bar shows whenever select mode is ON — even with 0 selected — so
         select-all and the exit affordance are always reachable. (A context-menu
         "Select" that later ends up with 0 selected used to hide the bar entirely,
         stranding the user in select mode with no way to select-all or exit.) -->
    <div v-if="store.selecting" class="bulkbar">
      <span
        class="bulkall"
        :title="
          allFilteredSelected ? t('sessions.sidebar.deselectAll') : t('sessions.sidebar.selectAll')
        "
        @click="selectAllFiltered"
      >
        <span class="lcbox" :class="{ on: allFilteredSelected }">
          <Icon
            v-if="allFilteredSelected"
            name="check"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
        </span>
        <span>
          {{
            selectedCount
              ? t('sessions.sidebar.selected', { n: selectedCount })
              : t('sessions.sidebar.selectAll')
          }}
        </span>
      </span>
      <span style="flex: 1" />
      <span
        v-if="selectedCount"
        class="del"
        :title="t('sessions.sidebar.deleteSelected')"
        style="color: var(--danger)"
        @click="askBulkRemove"
      >
        <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>
      <span
        class="del"
        :title="t('sessions.sidebar.selectExit')"
        @click="store.setSelectMode(false)"
      >
        <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </span>
    </div>

    <div class="lscroll">
      <template v-if="groupBy === 'none'">
        <template v-if="filtered.length">
          <div class="grpitems" style="padding-top: 4px">
            <SessionListItem
              v-for="s in flatPage.items"
              :key="s.id"
              :session="s"
              :active="s.id === activeId"
              :selecting="store.selecting"
              hide-project
              :rename-req="renameReq"
              @click="$emit('select', s.id)"
              @ctxmenu="(p) => openCtx(p, s)"
            />
          </div>
          <div v-if="flatPage.totalPages > 1" class="pager">
            <button
              class="pgbtn"
              type="button"
              :disabled="flatPage.page <= 1"
              :title="t('sessions.list.pagePrev')"
              @click="setPage(FLAT_KEY, flatPage.page - 1)"
            >
              <Icon name="chev" class="pg-prev" />
            </button>
            <span class="pglbl">
              {{ t('sessions.list.pageOf', { page: flatPage.page, total: flatPage.totalPages }) }}
            </span>
            <button
              class="pgbtn"
              type="button"
              :disabled="flatPage.page >= flatPage.totalPages"
              :title="t('sessions.list.pageNext')"
              @click="setPage(FLAT_KEY, flatPage.page + 1)"
            >
              <Icon name="chev" class="pg-next" />
            </button>
          </div>
        </template>
        <div v-else class="listempty">{{ t('sessions.list.noMatch') }}</div>
      </template>
      <!-- Chế độ "Nhóm": cây kiểu trang Notion, phiên con nằm dưới phiên cha. Cây đã
           được làm phẳng thành mảng có `depth` (useSessionTree) nên đây vẫn là MỘT
           v-for phẳng — hàng phiên giữ nguyên rename inline / select / context menu. -->
      <template v-else-if="groupBy === 'tree'">
        <template v-if="treeRows.length">
          <div class="grpitems" style="padding-top: 4px">
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
              @click="$emit('select', r.session.id)"
              @ctxmenu="(p) => openCtx(p, r.session)"
              @toggle-children="toggleTree(r.session.engineId)"
            />
          </div>
          <div v-if="treeTotalPages > 1" class="pager">
            <button
              class="pgbtn"
              type="button"
              :disabled="treePage <= 1"
              :title="t('sessions.list.pagePrev')"
              @click="setTreePage(treePage - 1)"
            >
              <Icon name="chev" class="pg-prev" />
            </button>
            <span class="pglbl">
              {{ t('sessions.list.pageOf', { page: treePage, total: treeTotalPages }) }}
            </span>
            <button
              class="pgbtn"
              type="button"
              :disabled="treePage >= treeTotalPages"
              :title="t('sessions.list.pageNext')"
              @click="setTreePage(treePage + 1)"
            >
              <Icon name="chev" class="pg-next" />
            </button>
          </div>
        </template>
        <div v-else class="listempty">{{ t('sessions.list.noMatch') }}</div>
      </template>
      <template v-else>
        <template v-if="groups.length">
          <div
            v-for="grp in groups"
            :key="grp.key"
            class="grp"
            :class="{ col: collapsed[grp.key] }"
            :data-grp="grp.key"
          >
            <div class="grph" @click="toggleGroup(grp.key)">
              <Icon name="chev" class="gchv" />
              <span class="pdot" :style="{ background: grp.dot }" />
              <span class="gnm">{{ grp.label }}</span>
              <span class="gct">{{ grp.total }}</span>
            </div>
            <div class="grpitems">
              <SessionListItem
                v-for="s in grp.items"
                :key="s.id"
                :session="s"
                :active="s.id === activeId"
                :selecting="store.selecting"
                hide-project
                :rename-req="renameReq"
                @click="$emit('select', s.id)"
                @ctxmenu="(p) => openCtx(p, s)"
              />
              <div v-if="grp.totalPages > 1" class="pager">
                <button
                  class="pgbtn"
                  type="button"
                  :disabled="grp.page <= 1"
                  :title="t('sessions.list.pagePrev')"
                  @click="setPage(grp.key, grp.page - 1)"
                >
                  <Icon name="chev" class="pg-prev" />
                </button>
                <span class="pglbl">
                  {{ t('sessions.list.pageOf', { page: grp.page, total: grp.totalPages }) }}
                </span>
                <button
                  class="pgbtn"
                  type="button"
                  :disabled="grp.page >= grp.totalPages"
                  :title="t('sessions.list.pageNext')"
                  @click="setPage(grp.key, grp.page + 1)"
                >
                  <Icon name="chev" class="pg-next" />
                </button>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="listempty">{{ t('sessions.list.noMatch') }}</div>
      </template>
    </div>

    <!-- Cross-session content search (docs/features/cross-session-search.md). The box
         above still filters TITLES instantly and locally; this section answers the
         other half — which transcript, anywhere, contains this text. -->
    <div v-if="searchOpen" class="csearch">
      <div class="csh">
        <Icon name="search" style="width: var(--icon-xs); height: var(--icon-xs)" />
        <span class="csttl">{{ t('sessionsSearch.section.title') }}</span>
        <span v-if="hits.length" class="cscount">{{ hits.length }}</span>
      </div>
      <div class="csbody">
        <div v-if="searchLoading" class="csnote">{{ t('sessionsSearch.loading') }}</div>
        <div v-else-if="searchError" class="csnote err">{{ searchError }}</div>
        <template v-else-if="hits.length">
          <div class="csnote">{{ t('sessionsSearch.hint') }}</div>
          <div
            v-for="h in hits"
            :key="`${h.sessionId}:${h.messageId}`"
            class="cshit"
            @click="openHit(h)"
          >
            <div class="cshead">
              <span class="csname">{{ h.sessionTitle }}</span>
              <span class="cstime">{{ hitTime(h.at) }}</span>
            </div>
            <div class="cssnip">
              <span class="csrole">{{ t(`sessionsSearch.role.${h.role}`) }}</span>
              <span v-for="(part, i) in snippetParts(h)" :key="i" :class="{ hl: part.hit }">
                {{ part.text }}
              </span>
            </div>
          </div>
          <div v-if="searchTruncated" class="csnote">
            {{ t('sessionsSearch.truncated', { n: hits.length }) }}
          </div>
          <!-- Phiên đã lưu trữ bị loại khỏi kết quả. Nói ra, nếu không người dùng
               tìm mãi không thấy mà không hiểu vì sao. -->
          <div v-if="searchArchivedHidden > 0" class="csnote">
            {{ t('sessionsSearch.archivedHidden', { n: searchArchivedHidden }) }}
          </div>
        </template>
        <div v-else class="csnote">{{ t('sessionsSearch.empty', { q: filter.trim() }) }}</div>
      </div>
    </div>

    <div
      v-if="groupMenu || sortMenu"
      style="position: fixed; inset: 0; z-index: 40"
      @click="closeMenus"
    />

    <SessionGroupPicker
      v-if="groupPickerFor"
      :session="groupPickerFor"
      :sessions="props.sessions"
      @pick="applyGroupPick"
      @close="groupPickerFor = null"
    />

    <!-- Right-click context menu (one shared menu, positioned at the cursor). -->
    <template v-if="ctx">
      <div
        class="ctxbackdrop"
        @click="ctx = null"
        @contextmenu.prevent="ctx = null"
        @wheel="ctx = null"
      />
      <div ref="ctxMenuEl" class="smenu ctxmenu" :style="ctxStyle">
        <div class="mi" @click="ctxOpen">
          <Icon name="sessions" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.open') }}
        </div>
        <div class="mi" @click="ctxRename">
          <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.rename') }}
        </div>
        <div class="mi" @click="ctxAutoTitle">
          <Icon name="sparkles" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.autoTitle') }}
        </div>
        <div class="mi" @click="ctxPin">
          <Icon name="pin" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ ctx.session.pinned ? t('sessions.ctx.unpin') : t('sessions.ctx.pin') }}
        </div>
        <!-- Archive: hides the session from the list without deleting it. -->
        <div class="mi" @click="ctxArchive">
          <Icon
            :name="store.isArchived(ctx.session.id) ? 'eye' : 'eye-off'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
          {{
            store.isArchived(ctx.session.id)
              ? t('sessionsSearch.archive.unarchive')
              : t('sessionsSearch.archive.archive')
          }}
        </div>
        <div class="mi" @click="ctxSelect">
          <Icon name="check" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.select') }}
        </div>
        <div class="mi" @click="ctxDuplicate">
          <Icon name="fork" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.duplicate') }}
        </div>
        <div class="mi" @click="ctxExport">
          <Icon name="save" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.export') }}
        </div>
        <!-- Nhóm phiên: xếp phiên này xuống dưới một phiên cha (hoặc đổi vai của nó).
             Hiện ở MỌI chế độ xem, không chỉ chế độ "Nhóm" — xếp nhóm là thao tác trên
             dữ liệu, không phải trên cách đang nhìn. -->
        <div class="mi" @click="ctxGroup">
          <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{
            ctx.session.groupParentId
              ? t('sessions.ctx.changeGroup')
              : t('sessions.ctx.moveToGroup')
          }}
        </div>
        <!-- Lưới các phiên con. Chỉ hiện trên phiên CÓ con: mở lưới từ một phiên lẻ
             là mở ra một khung rỗng. Menu `⋯` của header vẫn giữ mục lưới cho MỌI
             phiên — ở đó còn ô tìm phiên để kéo một phiên bất kỳ lên lưới. -->
        <div v-if="ctxHasChildren" class="mi" @click="ctxGrid">
          <Icon name="layers" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.gridChildren') }}
        </div>
        <!-- Tự giao tin trong nhóm. CHỈ hiện trên phiên GỐC của nhóm (phiên có con và
             không có cha): cờ nằm ở gốc và là công tắc của cả nhóm, nên hiện nó ở một
             phiên con sẽ hứa một thứ mà bấm vào không có tác dụng. -->
        <div v-if="ctxIsGroupRoot" class="mi" @click="ctxToggleAutoDeliver">
          <Icon name="zap" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{
            ctx.session.groupAutoDeliver
              ? t('sessions.group.autoDeliverOff')
              : t('sessions.group.autoDeliverOn')
          }}
        </div>
        <div v-if="ctx.session.groupParentId" class="mi" @click="ctxUngroup">
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.group.detach') }}
        </div>
        <!-- Move the session to its own OS window / bring it back (popout hand-off). -->
        <div v-if="ctxCanWindow" class="mi" @click="ctxWindow">
          <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{
            store.isWindowed(ctx.session.engineId)
              ? t('sessions.ctx.bringBackWindow')
              : t('sessions.ctx.openWindow')
          }}
        </div>
        <div class="ctxsep" />
        <div class="mi" @click="ctxCopyPath">
          <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.copyPath') }}
        </div>
        <div v-if="canOpenFinder" class="mi" @click="ctxOpenFinder">
          <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.openFinder') }}
        </div>
        <div class="mi" @click="ctxCopyId">
          <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.copyId') }}
        </div>
        <div class="ctxsep" />
        <div class="mi danger" @click="ctxDelete">
          <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('sessions.ctx.delete') }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Session list column for the active project tab: search, a group-by drawer
// (tree/provider/model/unread/none — project grouping now lives in the SessionTabBar),
// select mode + bulk bar, and a per-row context menu. The page passes
// `store.tabSessions` (the active tab's sessions), so this list is always scoped to
// one project; rows hide their project label since the tab already names it.
import type { Session, SortBy } from '~/composables/useSessionsData'
import { PROJECT_COLOR_DEFAULT } from '~/composables/useProjectColors'
import {
  highlightSnippet,
  SESSION_SEARCH_MIN_CHARS,
  useSessionSearch,
  type SessionSearchHit,
} from '~/composables/useSessionSearch'
import { placeMenu } from '~/utils/context-menu'

const props = defineProps<{ sessions: Session[]; activeId: number | null; listWidth: number }>()
const emit = defineEmits<{ select: [id: number] }>()

const { t } = useI18n()
const { GROUPBY, SORTBY, providerOf } = useSessionsData()
const store = useSessionsStore()
const sc = useSidecar()
const { confirm } = useConfirm()
const exportModal = useSessionExportModal()

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

// Sort-by also persists across restarts. Default 'updated' — matches the sidecar's
// newest-updated-first list order, so an unset preference looks like today's order.
const STORAGE_SORTBY = 'awog.sessions.filter.sortBy'

function readSortBy(): SortBy {
  const v = localStorage.getItem(STORAGE_SORTBY)
  return v && (SORTBY as readonly string[]).includes(v) ? (v as SortBy) : 'updated'
}

// "Show archived" is a saved preference like group-by / sort-by (same key family).
// Default OFF: archived sessions stay out of the way until asked for.
const STORAGE_SHOW_ARCHIVED = 'awog.sessions.filter.showArchived'

const filter = ref('')
const groupBy = ref(readGroupBy())
const sortBy = ref<SortBy>(readSortBy())
const showArchived = ref(localStorage.getItem(STORAGE_SHOW_ARCHIVED) === '1')
const showFilters = ref(false)
const listMenu = ref(false)
// Mỗi hàng đóng menu rồi chạy đúng handler mà nút cũ của nó gọi.
function runListAction(fn: () => void) {
  listMenu.value = false
  fn()
}

watch(groupBy, (v) => localStorage.setItem(STORAGE_GROUPBY, v))
watch(sortBy, (v) => localStorage.setItem(STORAGE_SORTBY, v))
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

// Group-by / sort-by dropdown open state (backdrop pattern mirrors SessionDetail
// `.dproj`). Only one is open at a time — opening one closes the other.
const groupMenu = ref(false)
const sortMenu = ref(false)
function openGroupMenu() {
  groupMenu.value = !groupMenu.value
  sortMenu.value = false
}
function openSortMenu() {
  sortMenu.value = !sortMenu.value
  groupMenu.value = false
}

// Per-group collapse state, keyed by the group's stable key (groupKeyOf).
const collapsed = ref<Record<string, boolean>>({})

const groupByLabel = computed(() => t(`sessions.group.${groupBy.value}`))
const sortByLabel = computed(() => t(`sessions.sort.${sortBy.value}`))

// Epoch ms of an ISO timestamp (0 when missing/invalid) — for the time-based sorts.
function tsOf(iso?: string): number {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isNaN(n) ? 0 : n
}
// Secondary comparator per sort mode; pinned-first is applied ahead of it.
const SORT_CMP: Record<SortBy, (a: Session, b: Session) => number> = {
  updated: (a, b) => tsOf(b.updatedAt) - tsOf(a.updatedAt),
  created: (a, b) => tsOf(b.createdAt) - tsOf(a.createdAt),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
}

const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  // Archived rows are out unless the filter drawer asks for them.
  const f = props.sessions.filter(
    (s) => s.title.toLowerCase().includes(q) && (showArchived.value || !store.isArchived(s.id)),
  )
  const cmp = SORT_CMP[sortBy.value]
  // Pinned-first, then the chosen sort. Applies to the flat list and — since buckets
  // are filled from this order — keeps pinned sessions atop each group too.
  return f
    .slice()
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || cmp(a, b))
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
  return s.model
}
function groupLabelOf(key: string): string {
  // Unread/read bucket names go through i18n; provider/model show the raw value.
  if (groupBy.value === 'unread') return t(`sessions.group.${key}`)
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
  groupMenu.value = false
}
function selectSort(value: SortBy) {
  sortBy.value = value
  sortMenu.value = false
}
function closeMenus() {
  groupMenu.value = false
  sortMenu.value = false
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
  const parents = new Set(all.map((s) => s.groupParentId).filter(Boolean) as string[])
  return (
    all
      .filter((s) => s.engineId && !s.groupParentId && parents.has(s.engineId))
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
  if (active.groupParentId) return null
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
const groupPickerFor = ref<Session | null>(null)

// Đóng hộp NGAY khi chọn, không đợi RPC: thao tác sai (chu trình, phiên chưa lưu) đã
// được lọc khỏi danh sách ứng viên và vẫn bị sidecar chặn, còn giữ hộp mở trong lúc
// chờ thì người dùng bấm được lần thứ hai vào một dòng khác.
function applyGroupPick(parentClientId: number | null, role: string | null) {
  const s = groupPickerFor.value
  groupPickerFor.value = null
  if (s) void store.setGroupParent(s.id, parentClientId, role)
}

// ── Right-click context menu ───────────────────────────────────────────────────
// One shared menu positioned at the cursor. `renameReq` signals a row to start its
// inline rename (the edit state is local to SessionListItem).
const ctx = ref<{ x: number; y: number; session: Session } | null>(null)
const renameReq = ref<{ id: number; n: number }>({ id: -1, n: 0 })
const ctxMenuEl = useTemplateRef<HTMLElement>('ctxMenuEl')
const ctxStyle = ref<Record<string, string>>({})

function openCtx(p: { id: number; x: number; y: number }, s: Session) {
  // Seed at the click point, then refine once the menu has measurable dimensions.
  ctx.value = { x: p.x, y: p.y, session: s }
  ctxStyle.value = { left: `${p.x}px`, top: `${p.y}px` }
  nextTick(() => {
    ctxStyle.value = placeMenu(ctxMenuEl.value, p.x, p.y)
  })
}
function ctxGroup() {
  groupPickerFor.value = ctx.value?.session ?? null
  ctx.value = null
}
// Phiên được bấm có phải GỐC của một nhóm không: không có cha, và có ít nhất một
// phiên nhận nó làm cha. Một phiên lẻ (không cha không con) KHÔNG phải gốc nhóm —
// bật tự giao ở đó chẳng có ai để giao.
const ctxIsGroupRoot = computed(() => {
  const s = ctx.value?.session
  if (!s?.engineId || s.groupParentId) return false
  return props.sessions.some((x) => x.groupParentId === s.engineId)
})
// Phiên được bấm có phiên con nào không. Quét TOÀN BỘ store chứ không phải
// `props.sessions` (đã lọc theo tab project + ô tìm kiếm): một phiên con bị lọc khỏi
// danh sách vẫn là con, và lưới vẫn phải mở được nó ra.
const ctxHasChildren = computed(() => {
  const eid = ctx.value?.session.engineId
  return !!eid && store.sessions.some((x) => x.groupParentId === eid)
})
// Mở phiên cha RỒI đặt yêu cầu lưới: `gridMode` là ref cục bộ của SessionDetail, cột
// này không với tới được (xem `requestGridView` trong store).
function ctxGrid() {
  const s = ctx.value?.session
  ctx.value = null
  if (!s) return
  store.requestGridView(s.id)
  emit('select', s.id)
}
function ctxToggleAutoDeliver() {
  if (ctx.value) store.toggleGroupAutoDeliver(ctx.value.session.id)
  ctx.value = null
}
function ctxUngroup() {
  const s = ctx.value?.session
  ctx.value = null
  if (s) void store.setGroupParent(s.id, null)
}
function ctxOpen() {
  if (ctx.value) emit('select', ctx.value.session.id)
  ctx.value = null
}
function ctxRename() {
  if (ctx.value) renameReq.value = { id: ctx.value.session.id, n: renameReq.value.n + 1 }
  ctx.value = null
}
// Summarize the transcript into a concise title via the model (best-effort; keeps
// the current title on failure or an empty session).
function ctxAutoTitle() {
  if (ctx.value) void store.regenerateTitle(ctx.value.session.id)
  ctx.value = null
}
function ctxPin() {
  if (ctx.value) store.togglePin(ctx.value.session.id)
  ctx.value = null
}
// Archive / un-archive the right-clicked session. Non-destructive: the transcript
// stays on disk and searchable, the row just leaves the list.
function ctxArchive() {
  const s = ctx.value?.session
  ctx.value = null
  if (s) void store.setArchived(s.id, !store.isArchived(s.id))
}
function ctxSelect() {
  if (ctx.value) {
    store.setSelectMode(true)
    store.toggleSelect(ctx.value.session.id)
  }
  ctx.value = null
}
function ctxDuplicate() {
  if (ctx.value) {
    const s = ctx.value.session
    store.fork(s.id, s.msgs.length - 1, 'copy')
  }
  ctx.value = null
}
// The right-clicked session's on-disk engineId ("ses-…" slug). A session only has
// one once it's been persisted (first message sent); until then Copy path / Open in
// Finder have no real folder to point at, so both items gate on this (spec AC5).
// NB: this is the SESSION folder (~/.awog/sessions/<engineId>), not the project path
// the items used to (wrongly) copy — the session dir is independent of any project.
const ctxSessionId = computed<string | null>(() => ctx.value?.session.engineId ?? null)
// Open in Finder needs the Electron shell (browser-dev has no OS file manager), so the
// item is hidden there. When shown but the session isn't persisted yet (no engineId),
// the handler toasts "not saved" — symmetric with Copy path, no silently-missing item.
const canOpenFinder = computed(() => sc.available)
async function ctxCopyPath() {
  const engineId = ctxSessionId.value
  ctx.value = null
  if (!engineId) {
    useToast().add({ title: t('sessions.ctx.notSaved'), color: 'info' })
    return
  }
  // Main derives the absolute path from the engineId (invariant #4). Browser-dev
  // has no bridge → sessionFolderPath throws; degrade to a no-op toast.
  try {
    const path = sc.available ? await sc.sessionFolderPath(engineId) : null
    if (path) await navigator.clipboard.writeText(path)
  } catch {
    // best-effort: bridge unavailable or clipboard blocked → no-op
  }
}
function ctxOpenFinder() {
  const engineId = ctxSessionId.value
  ctx.value = null
  if (!engineId) {
    useToast().add({ title: t('sessions.ctx.notSaved'), color: 'info' })
    return
  }
  if (sc.available) void sc.revealSessionFolder(engineId).catch(() => undefined)
}
function ctxCopyId() {
  if (ctx.value) {
    const s = ctx.value.session
    void navigator.clipboard.writeText(s.engineId ?? String(s.id))
  }
  ctx.value = null
}
function ctxExport() {
  if (ctx.value) exportModal.open(ctx.value.session.id)
  ctx.value = null
}

// Popout hand-off (docs/features/session-popout-window.md): move the row's session to
// its own OS window, or — when it already has one — close that window to bring it back
// here. Offered only for a session the sidecar knows about (it is addressed by engine
// id) and never mid-turn, matching the header button's gate.
const ctxCanWindow = computed(() => {
  const s = ctx.value?.session
  if (!s?.engineId || !sc.available) return false
  return store.isWindowed(s.engineId) || (s.status !== 'streaming' && s.status !== 'awaiting')
})
function ctxWindow() {
  const s = ctx.value?.session
  ctx.value = null
  if (!s) return
  if (store.isWindowed(s.engineId)) void store.closeWindowFor(s.id)
  else void store.openInWindow(s.id)
}
async function ctxDelete() {
  const s = ctx.value?.session
  ctx.value = null // close the menu before the dialog opens
  if (!s) return
  const ok = await confirm({
    title: t('sessions.delete.title'),
    description: t('sessions.delete.one', { title: s.title }),
  })
  if (ok) store.remove(s.id)
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

<style scoped>
/* Menu tạo phiên sống TRONG `.list` (overflow:hidden), nên nó không được rộng hơn cột.
   240px vừa khít cột hẹp nhất mà danh sách có thể bị kéo xuống. */
.newmenu {
  max-width: 240px;
}
.newmenu .mi {
  min-width: 0;
}
/* Nhãn nhóm mục. KHÔNG dùng `.cslbl` — class đó là cột nhãn của drawer bộ lọc và có
   `width: 62px`, nên "Trong nhóm" bị bẻ làm hai dòng. */
.nmlbl {
  padding: 4px 10px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
}
/* Nhãn mang tên phiên: một dòng, cắt bằng ellipsis. Tên đầy đủ ở `title`. */
.nmt {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* In select mode every row's checkbox stays visible (the shared prototype.css
   only reveals .lcbox on hover / when selected). :deep reaches the child rows. */
.list.selecting :deep(.lcbox) {
  display: grid;
}
/* Bulk-bar action icons: the shared .del rule is scoped to .li, so style the
   bar's own clear/delete affordances here (clickable, hover feedback). */
.bulkbar .del {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r-xs);
  cursor: pointer;
  color: var(--textDim);
}
.bulkbar .del:hover {
  color: var(--text);
  background: var(--bgActive);
}
.bulkbar .lcbox {
  cursor: pointer;
}
/* Left cluster (checkbox + label) is one hit target for select-all / deselect-all. */
.bulkall {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  min-width: 0;
}
/* Context menu: a `.smenu`-styled popover pinned at the cursor (fixed), above all. */
.ctxbackdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.ctxmenu {
  position: fixed;
  z-index: 61;
  min-width: 178px;
}
/* Thin divider between context-menu groups. */
.ctxsep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
/* Destructive item (Delete): danger tint + hover. */
.ctxmenu .mi.danger {
  color: var(--danger);
}
.ctxmenu .mi.danger:hover {
  background: var(--dangerDim, color-mix(in srgb, var(--danger) 14%, transparent));
}
/* Toolbar icon buttons sit beside the ~28px-tall search field — the global 32px
   .iconbtn reads oversized here, so scope them down to match the search box. */
.ltop .iconbtn {
  width: 28px;
  height: 28px;
}
/* Per-group / flat pager: prev/next + "Page X / Y" at the bottom of a list section.
   Centered, subtle — sits under the rows like the old load-more link but with
   explicit page control. */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 2px 0 6px;
  padding: 2px 0;
}
.pgbtn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
.pgbtn:hover:not(:disabled) {
  color: var(--accent);
  background: var(--bgHover);
}
.pgbtn:disabled {
  color: var(--textFaint);
  cursor: default;
  opacity: 0.5;
}
.pgbtn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.pgbtn .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
/* The sprite only ships a down-chevron; rotate it into left/right arrows. */
.pg-prev {
  transform: rotate(90deg);
}
.pg-next {
  transform: rotate(-90deg);
}
.pglbl {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 12px;
  color: var(--textDim);
  min-width: 68px;
  text-align: center;
}
/* "Show archived" row in the filter drawer. The shared .lcbox only shows on a row
   hover / when checked — here it is a standing checkbox, so force it visible. */
.sfdrawer .csrow.arch {
  gap: 9px;
  cursor: pointer;
  user-select: none;
}
.sfdrawer .csrow.arch .lcbox {
  display: grid;
}
.archlbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sfdrawer .csrow.arch:hover .archlbl {
  color: var(--text);
}
/* Content-search section: docked under the (shrinking) list, capped so the list
   above always keeps some rows, with its own scroll for the hits. */
.csearch {
  flex: 0 0 auto;
  max-height: 46%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--border);
  background: var(--bgSubtle);
}
.csh {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  color: var(--textMuted);
}
.csttl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 700;
}
.cscount {
  margin-left: auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
  color: var(--textFaint);
}
.csbody {
  overflow-y: auto;
  padding: 0 7px 7px;
}
.csnote {
  padding: 6px 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.csnote.err {
  color: var(--danger);
}
.cshit {
  padding: 7px 8px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  cursor: pointer;
}
.cshit:hover {
  background: var(--bgHover);
}
.cshead {
  display: flex;
  align-items: center;
  gap: 8px;
}
.csname {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cstime {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
  color: var(--textFaint);
}
.cssnip {
  margin-top: 3px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textDim);
  /* Two lines of context is enough to recognise the hit; the rest is in the session. */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.csrole {
  color: var(--textFaint);
  margin-right: 5px;
}
.cssnip .hl {
  background: var(--accentDim);
  color: var(--text);
  border-radius: var(--r-xs);
  font-weight: 650;
}
</style>
