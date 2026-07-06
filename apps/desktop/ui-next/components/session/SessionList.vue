<template>
  <div
    id="slistcol"
    class="list"
    :class="{ selecting: store.selecting }"
    :style="{ flex: `0 0 ${listWidth}px !important`, width: `${listWidth}px !important` }"
  >
    <div class="ltop">
      <div class="srch">
        <Icon name="search" style="width: 13px; height: 13px" />
        <input v-model="filter" :placeholder="t('sessions.search.placeholder')" />
      </div>
      <button
        class="iconbtn"
        :title="t('sessions.new')"
        style="width: 28px; height: 28px"
        @click="store.create(store.activeTab || undefined)"
      >
        <Icon name="plus" style="width: 13px; height: 13px" />
      </button>
      <button
        class="iconbtn"
        :title="
          store.selecting ? t('sessions.sidebar.selectExit') : t('sessions.sidebar.selectMode')
        "
        :style="{
          width: '28px',
          height: '28px',
          ...(store.selecting ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
        }"
        @click="toggleSelectMode"
      >
        <Icon name="check" style="width: 13px; height: 13px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.filter.tooltip')"
        style="width: 28px; height: 28px"
        @click="showFilters = !showFilters"
      >
        <Icon name="filter" style="width: 13px; height: 13px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.foldAll.tooltip')"
        style="width: 28px; height: 28px"
        @click="toggleFoldAll"
      >
        <Icon name="foldv" style="width: 13px; height: 13px" />
      </button>
    </div>

    <div v-if="showFilters" class="sfdrawer">
      <div class="csrow">
        <span class="cslbl">{{ t('sessions.filter.groupBy') }}</span>
        <div class="csval" style="position: relative" @click.stop="groupMenu = !groupMenu">
          {{ groupByLabel }}
          <Icon name="chev" style="width: 13px; height: 13px" />
          <div
            v-if="groupMenu"
            class="smenu"
            style="position: absolute; top: 116%; left: 0; right: 0; z-index: 50"
            @click.stop
          >
            <div
              v-for="[value, label] in GROUPBY"
              :key="value"
              class="mi"
              @click="selectGroup(value)"
            >
              {{ label }}
              <Icon
                v-if="value === groupBy"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="selectedCount" class="bulkbar">
      <span class="lcbox on" :title="t('sessions.sidebar.selectAll')" @click="selectAllFiltered">
        <Icon name="check" style="width: 11px; height: 11px" />
      </span>
      <span>{{ t('sessions.sidebar.selected', { n: selectedCount }) }}</span>
      <span style="flex: 1" />
      <span
        class="del"
        :title="t('sessions.sidebar.clearSelection')"
        @click="store.clearSelection()"
      >
        <Icon name="x" style="width: 13px; height: 13px" />
      </span>
      <span
        class="del"
        :title="t('sessions.sidebar.deleteSelected')"
        style="color: var(--danger)"
        @click="askBulkRemove"
      >
        <Icon name="trash" style="width: 13px; height: 13px" />
      </span>
    </div>

    <div class="lscroll">
      <template v-if="groupBy === 'none'">
        <div v-if="filtered.length" class="grpitems" style="padding-top: 5px">
          <SessionListItem
            v-for="s in visible"
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
              <span class="gct">{{ grp.items.length }}</span>
            </div>
            <div class="grpitems">
              <SessionListItem
                v-for="s in grp.visible"
                :key="s.id"
                :session="s"
                :active="s.id === activeId"
                :selecting="store.selecting"
                hide-project
                :rename-req="renameReq"
                @click="$emit('select', s.id)"
                @ctxmenu="(p) => openCtx(p, s)"
              />
              <LoadMoreSentinel
                v-if="grp.hasMore"
                :remaining="grp.remaining"
                @load="groupLoad.loadMore(grp.key)"
              />
            </div>
          </div>
        </template>
        <div v-else class="listempty">{{ t('sessions.list.noMatch') }}</div>
      </template>

      <LoadMoreSentinel
        v-if="groupBy === 'none' && hasMore"
        auto
        :remaining="remaining"
        @load="loadMore()"
      />
    </div>

    <div v-if="groupMenu" style="position: fixed; inset: 0; z-index: 40" @click="closeMenus" />

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
          <Icon name="sessions" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.open') }}
        </div>
        <div class="mi" @click="ctxRename">
          <Icon name="edit" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.rename') }}
        </div>
        <div class="mi" @click="ctxAutoTitle">
          <Icon name="sparkles" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.autoTitle') }}
        </div>
        <div class="mi" @click="ctxPin">
          <Icon name="pin" style="width: 13px; height: 13px" />
          {{ ctx.session.pinned ? t('sessions.ctx.unpin') : t('sessions.ctx.pin') }}
        </div>
        <div class="mi" @click="ctxSelect">
          <Icon name="check" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.select') }}
        </div>
        <div class="mi" @click="ctxDuplicate">
          <Icon name="fork" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.duplicate') }}
        </div>
        <div class="mi" @click="ctxExport">
          <Icon name="save" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.export') }}
        </div>
        <div class="ctxsep" />
        <div v-if="ctxPath" class="mi" @click="ctxCopyPath">
          <Icon name="copy" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.copyPath') }}
        </div>
        <div v-if="ctxPath" class="mi" @click="ctxOpenFinder">
          <Icon name="folder" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.openFinder') }}
        </div>
        <div class="mi" @click="ctxCopyId">
          <Icon name="commands" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.copyId') }}
        </div>
        <div class="ctxsep" />
        <div class="mi danger" @click="ctxDelete">
          <Icon name="trash" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.delete') }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Session list column for the active project tab: search, a group-by drawer
// (provider/model/unread/none — project grouping now lives in the SessionTabBar),
// select mode + bulk bar, and a per-row context menu. The page passes
// `store.tabSessions` (the active tab's sessions), so this list is always scoped to
// one project; rows hide their project label since the tab already names it.
import type { Session } from '~/composables/useSessionsData'
import { PROJECT_COLOR_DEFAULT } from '~/composables/useProjectColors'
import { placeMenu } from '~/utils/context-menu'

const props = defineProps<{ sessions: Session[]; activeId: number | null; listWidth: number }>()
const emit = defineEmits<{ select: [id: number] }>()

const { t } = useI18n()
const { GROUPBY, providerOf } = useSessionsData()
const { projectPath } = useProjects()
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

const filter = ref('')
const groupBy = ref(readGroupBy())
const showFilters = ref(false)

watch(groupBy, (v) => localStorage.setItem(STORAGE_GROUPBY, v))

// Multi-select mode (§1) lives in the store (the tab context menu also enters it);
// when on, every row shows its checkbox and a row click toggles selection. The bulk
// bar appears whenever ≥1 session is selected.
const selectedCount = computed(() => store.selectedIds.size)
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

// Group-by dropdown open state (backdrop pattern mirrors SessionDetail `.dproj`).
const groupMenu = ref(false)

// Per-group collapse state, keyed by the group's stable key (groupKeyOf).
const collapsed = ref<Record<string, boolean>>({})

const groupByLabel = computed(() => t(`sessions.group.${groupBy.value}`))

const filtered = computed(() => {
  const f = props.sessions.filter((s) => s.title.toLowerCase().includes(filter.value.toLowerCase()))
  // Pinned-first, otherwise preserve the incoming order (stable sort). Applies to
  // the flat list and — since buckets are filled from this order — keeps pinned
  // sessions at the top within each group too.
  return f.slice().sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
})

// Incremental render windows — keep the DOM small on large histories.
//  • Flat (groupBy='none'): a single bottom window that grows on scroll.
//  • Grouped: each bucket shows GROUP_PAGE_SIZE rows with its own "load more".
// Bulk/select actions still operate on the full `filtered` set, not what's rendered.
const { visible, hasMore, remaining, loadMore, reset } = useLoadMore(() => filtered.value)
const groupLoad = useGroupLoadMore()
// Snap back to the first page when the query narrows (so results show from the top)
// OR when the project tab switches — otherwise a large window grown in the previous
// tab would try to mount hundreds of rows for the new project at once. A new session
// appearing in the live store (same tab) must NOT reset the window.
watch([filter, groupBy, () => store.activeTab], () => {
  reset()
  groupLoad.reset()
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

const groups = computed(() => {
  const map = new Map<string, Session[]>()
  filtered.value.forEach((s) => {
    const k = groupKeyOf(s)
    const bucket = map.get(k)
    if (bucket) bucket.push(s)
    else map.set(k, [s])
  })
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: groupLabelOf(key),
    // Per-group window (.items = full group, .visible = first GROUP_PAGE_SIZE).
    ...groupLoad.windowOf(key, items),
    // No per-bucket color (provider/model/unread aren't projects) — neutral dot.
    dot: PROJECT_COLOR_DEFAULT,
  }))
})

function selectGroup(value: string) {
  groupBy.value = value
  groupMenu.value = false
}
function closeMenus() {
  groupMenu.value = false
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
// Resolved absolute path of the right-clicked session's project (null = unknown /
// browser-dev). Gates the "Copy path" + "Open in Finder" items.
const ctxPath = computed<string | null>(() =>
  ctx.value ? projectPath(ctx.value.session.project) : null,
)
function ctxCopyPath() {
  if (ctxPath.value) void navigator.clipboard.writeText(ctxPath.value)
  ctx.value = null
}
function ctxOpenFinder() {
  const path = ctxPath.value
  if (path && sc.available) sc.openPath(path, '.').catch(() => undefined)
  ctx.value = null
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
  border-radius: 6px;
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
</style>
