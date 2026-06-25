<template>
  <div
    id="slistcol"
    class="list"
    :class="{ selecting }"
    :style="{ flex: `0 0 ${listWidth}px !important`, width: `${listWidth}px !important` }"
  >
    <div class="ltop">
      <div class="srch">
        <Icon name="search" style="width: 13px; height: 13px" />
        <input v-model="filter" :placeholder="t('sessions.search.placeholder')" />
      </div>
      <button
        class="iconbtn"
        :title="selecting ? t('sessions.sidebar.selectExit') : t('sessions.sidebar.selectMode')"
        :style="{
          width: '32px',
          height: '32px',
          ...(selecting ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
        }"
        @click="toggleSelectMode"
      >
        <Icon name="check" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.filter.tooltip')"
        style="width: 32px; height: 32px; position: relative"
        @click="showFilters = !showFilters"
      >
        <Icon name="filter" style="width: 14px; height: 14px" />
        <span v-if="activeFilters" class="fbadge">{{ activeFilters }}</span>
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.foldAll.tooltip')"
        style="width: 32px; height: 32px"
        @click="toggleFoldAll"
      >
        <Icon name="foldv" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.new.tooltip')"
        style="width: 32px; height: 32px"
        @click="store.create()"
      >
        <Icon name="plus" />
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
      <div class="csrow">
        <span class="cslbl">{{ t('sessions.filter.project') }}</span>
        <div class="csval" style="position: relative" @click.stop="projMenu = !projMenu">
          {{
            projectFilter === 'all' ? t('sessions.filter.allProjects') : projectName(projectFilter)
          }}
          <Icon name="chev" style="width: 13px; height: 13px" />
          <div
            v-if="projMenu"
            class="smenu"
            style="position: absolute; top: 116%; left: 0; right: 0; z-index: 50"
            @click.stop
          >
            <div v-for="p in projectOptions" :key="p.id" class="mi" @click="selectProject(p.id)">
              {{ p.id === 'all' ? t('sessions.filter.allProjects') : p.name }}
              <Icon
                v-if="p.id === projectFilter"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </div>
      </div>
      <span v-if="activeFilters" class="clearf" @click="projectFilter = 'all'">
        {{ t('sessions.filter.clear') }}
      </span>
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
        @click="store.bulkRemove()"
      >
        <Icon name="trash" style="width: 13px; height: 13px" />
      </span>
    </div>

    <div class="lscroll">
      <template v-if="groupBy === 'none'">
        <div v-if="filtered.length" class="grpitems" style="padding-top: 5px">
          <SessionListItem
            v-for="s in filtered"
            :key="s.id"
            :session="s"
            :active="s.id === activeId"
            :selecting="selecting"
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
              <span class="grpadd" :title="t('sessions.group.add')" @click.stop="addInGroup(grp)">
                <Icon name="plus" style="width: 13px; height: 13px" />
              </span>
            </div>
            <div class="grpitems">
              <SessionListItem
                v-for="s in grp.items"
                :key="s.id"
                :session="s"
                :active="s.id === activeId"
                :selecting="selecting"
                :rename-req="renameReq"
                @click="$emit('select', s.id)"
                @ctxmenu="(p) => openCtx(p, s)"
              />
            </div>
          </div>
        </template>
        <div v-else class="listempty">{{ t('sessions.list.noMatch') }}</div>
      </template>
    </div>

    <div
      v-if="groupMenu || projMenu"
      style="position: fixed; inset: 0; z-index: 40"
      @click="closeMenus"
    />

    <!-- Right-click context menu (one shared menu, positioned at the cursor). -->
    <template v-if="ctx">
      <div
        class="ctxbackdrop"
        @click="ctx = null"
        @contextmenu.prevent="ctx = null"
        @wheel="ctx = null"
      />
      <div class="smenu ctxmenu" :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }">
        <div class="mi" @click="ctxOpen">
          <Icon name="sessions" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.open') }}
        </div>
        <div class="mi" @click="ctxRename">
          <Icon name="edit" style="width: 13px; height: 13px" />
          {{ t('sessions.ctx.rename') }}
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
// Session list column (renderList ~1264 + renderFilters ~1253): search, filter
// drawer, group-by buckets. Filter / group / collapse state is local UI state;
// data mutations go through `useSessionsStore`.
import type { Session } from '~/composables/useSessionsMock'

const props = defineProps<{ sessions: Session[]; activeId: number | null; listWidth: number }>()
const emit = defineEmits<{ select: [id: number] }>()

const { t } = useI18n()
const { GROUPBY, providerOf, projColor } = useSessionsMock()
const { projects, projectName, projectPath } = useProjects()
const store = useSessionsStore()
const sc = useSidecar()

const filter = ref('')
const groupBy = ref('project')
const projectFilter = ref('all')
const showFilters = ref(false)

// Multi-select mode (§1): when on, every row shows its checkbox and a row click
// toggles selection instead of opening the session. The bulk action bar appears
// whenever ≥1 session is selected.
const selecting = ref(false)
const selectedCount = computed(() => store.selectedIds.size)
function toggleSelectMode() {
  selecting.value = !selecting.value
  if (!selecting.value) store.clearSelection()
}
// Toggle-all over the currently visible (filtered) sessions: if every visible
// row is already selected, clear; otherwise select the ones not yet selected.
// Goes through the store's public actions only.
function selectAllFiltered() {
  const allSelected = filtered.value.every((s) => store.selectedIds.has(s.id))
  if (allSelected) store.clearSelection()
  else
    filtered.value.forEach((s) => {
      if (!store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
}

// Dropdown open state (backdrop pattern mirrors SessionDetail `.dproj`).
const groupMenu = ref(false)
const projMenu = ref(false)

// Per-group collapse state, keyed by the group's stable key (groupKeyOf).
const collapsed = ref<Record<string, boolean>>({})

// Filter options: an "all" sentinel + the real projects (id + display name).
const projectOptions = computed(() => [
  { id: 'all', name: t('sessions.filter.allProjects') },
  ...projects.value,
])
const activeFilters = computed(() => (projectFilter.value !== 'all' ? 1 : 0))
const groupByLabel = computed(() => t(`sessions.group.${groupBy.value}`))

const filtered = computed(() => {
  let f = props.sessions.filter((s) => s.title.toLowerCase().includes(filter.value.toLowerCase()))
  if (projectFilter.value !== 'all') f = f.filter((s) => s.project === projectFilter.value)
  // Pinned-first, otherwise preserve the incoming order (stable sort). Applies to
  // the flat list and — since buckets are filled from this order — keeps pinned
  // sessions at the top within each group too.
  return f.slice().sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
})

// Stable identity for a bucket (data value for project/provider/model; a token
// for the unread split). The display label is resolved separately so chrome
// (unread/read bucket names) goes through i18n while data stays literal.
function groupKeyOf(s: Session): string {
  if (groupBy.value === 'provider') return providerOf(s.account)
  if (groupBy.value === 'model') return s.model
  if (groupBy.value === 'unread') return s.unread ? 'unreadBucket' : 'read'
  return s.project
}
function groupLabelOf(key: string): string {
  if (groupBy.value === 'unread') return t(`sessions.group.${key}`)
  // Project buckets key on the engine projectId → show the resolved display name.
  if (groupBy.value === 'project') return projectName(key)
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
    items,
    dot: groupBy.value === 'project' ? projColor(key) : 'var(--textDim)',
  }))
})

function selectGroup(value: string) {
  groupBy.value = value
  groupMenu.value = false
}
function selectProject(p: string) {
  projectFilter.value = p
  projMenu.value = false
}
function closeMenus() {
  groupMenu.value = false
  projMenu.value = false
}

// ── Right-click context menu ───────────────────────────────────────────────────
// One shared menu positioned at the cursor. `renameReq` signals a row to start
// its inline rename (the edit state is local to SessionListItem).
const ctx = ref<{ x: number; y: number; session: Session } | null>(null)
const renameReq = ref<{ id: number; n: number }>({ id: -1, n: 0 })

function openCtx(p: { id: number; x: number; y: number }, s: Session) {
  // Clamp so the menu stays on-screen (rough menu size ≈ 170×230).
  const x = Math.min(p.x, window.innerWidth - 184)
  const y = Math.min(p.y, window.innerHeight - 236)
  ctx.value = { x: Math.max(8, x), y: Math.max(8, y), session: s }
}
function ctxOpen() {
  if (ctx.value) emit('select', ctx.value.session.id)
  ctx.value = null
}
function ctxRename() {
  if (ctx.value) renameReq.value = { id: ctx.value.session.id, n: renameReq.value.n + 1 }
  ctx.value = null
}
function ctxPin() {
  if (ctx.value) store.togglePin(ctx.value.session.id)
  ctx.value = null
}
function ctxSelect() {
  if (ctx.value) {
    selecting.value = true
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
function ctxDelete() {
  if (ctx.value) store.remove(ctx.value.session.id)
  ctx.value = null
}

function toggleGroup(key: string) {
  collapsed.value[key] = !collapsed.value[key]
}
// Per-group quick-add: create a session already scoped to this group's project
// (only project groups carry a project; other groupings → default/unset project).
function addInGroup(grp: { key: string }) {
  store.create(groupBy.value === 'project' ? grp.key : undefined)
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
/* Per-group quick-add "+" — hover-revealed on the group header so it doesn't
   clutter every row. Click is stopped from toggling the group collapse. */
.grpadd {
  display: grid;
  place-items: center;
  margin-left: 4px;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--textFaint);
  opacity: 0;
  transition: opacity 0.12s;
}
.grph:hover .grpadd {
  opacity: 1;
}
.grpadd:hover {
  color: var(--accent);
  background: var(--bgHover);
}
/* Destructive item (Delete): danger tint + hover. */
.ctxmenu .mi.danger {
  color: var(--danger);
}
.ctxmenu .mi.danger:hover {
  background: var(--dangerDim, color-mix(in srgb, var(--danger) 14%, transparent));
}
</style>
