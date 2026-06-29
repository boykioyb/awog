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
          width: '28px',
          height: '28px',
          ...(selecting ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
        }"
        @click="toggleSelectMode"
      >
        <Icon name="check" style="width: 13px; height: 13px" />
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.filter.tooltip')"
        style="width: 28px; height: 28px; position: relative"
        @click="showFilters = !showFilters"
      >
        <Icon name="filter" style="width: 13px; height: 13px" />
        <span v-if="activeFilters" class="fbadge">{{ activeFilters }}</span>
      </button>
      <button
        class="iconbtn"
        :title="t('sessions.foldAll.tooltip')"
        style="width: 28px; height: 28px"
        @click="toggleFoldAll"
      >
        <Icon name="foldv" style="width: 13px; height: 13px" />
      </button>
      <button
        class="iconbtn pri"
        :title="t('sessions.new.tooltip')"
        style="width: 28px; height: 28px"
        @click="store.create()"
      >
        <Icon name="plus" style="width: 14px; height: 14px" />
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
          {{ projectFilterLabel }}
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
                v-if="p.id === 'all' ? !projectFilter.size : projectFilter.has(p.id)"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </div>
      </div>
      <span v-if="activeFilters" class="clearf" @click="projectFilter = new Set()">
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
        @click="askBulkRemove"
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
            <div
              class="grph"
              @click="toggleGroup(grp.key)"
              @contextmenu.prevent="openProjectCtx(grp, $event)"
            >
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
                :hide-project="groupBy === 'project'"
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

    <!-- Right-click a group header → project-scoped actions. -->
    <template v-if="pctx">
      <div
        class="ctxbackdrop"
        @click="pctx = null"
        @contextmenu.prevent="pctx = null"
        @wheel="pctx = null"
      />
      <div ref="pctxMenuEl" class="smenu ctxmenu" :style="pctxStyle">
        <div class="mi" @click="pNewSession">
          <Icon name="plus" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.newSession') }}
        </div>
        <template v-if="pctxIsProject">
          <div class="ctxsep" />
          <div class="ctxcolor">
            <span class="ctxcolorlbl">{{ t('sessions.pctx.color') }}</span>
            <div class="ctxsw">
              <span
                v-for="c in PROJECT_COLOR_PALETTE"
                :key="c.token"
                class="swatch"
                :class="{ on: pctxColor === c.token }"
                :style="{ background: c.token }"
                :title="c.label"
                @click="pSetColor(c.token)"
              />
              <span
                class="swatch clear"
                :class="{ on: pctxColor === PROJECT_COLOR_DEFAULT }"
                :title="t('sessions.pctx.colorClear')"
                @click="pSetColor(null)"
              >
                <Icon name="x" style="width: 11px; height: 11px" />
              </span>
            </div>
          </div>
        </template>
        <div class="ctxsep" />
        <div class="mi" @click="pSelectAll">
          <Icon name="check" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.selectAll', { n: pctx.grp.items.length }) }}
        </div>
        <div class="mi" @click="pDeselectAll">
          <Icon name="x" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.deselectAll') }}
        </div>
        <div v-if="pctxPath" class="mi" @click="pOpenFinder">
          <Icon name="folder" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.openFinder') }}
        </div>
        <div class="ctxsep" />
        <div class="mi danger" @click="pDeleteAll">
          <Icon name="trash" style="width: 13px; height: 13px" />
          {{ t('sessions.pctx.deleteAll', { n: pctx.grp.items.length }) }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Session list column (renderList ~1264 + renderFilters ~1253): search, filter
// drawer, group-by buckets. Filter / group / collapse state is local UI state;
// data mutations go through `useSessionsStore`.
import type { Session } from '~/composables/useSessionsData'
import {
  PROJECT_COLOR_DEFAULT,
  PROJECT_COLOR_PALETTE,
  useProjectColors,
} from '~/composables/useProjectColors'

const props = defineProps<{ sessions: Session[]; activeId: number | null; listWidth: number }>()
const emit = defineEmits<{ select: [id: number] }>()

const { t } = useI18n()
const { GROUPBY, providerOf } = useSessionsData()
const { colorOf, setColor } = useProjectColors()
const { projects, projectName, projectPath } = useProjects()
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

// Filter state (group-by + project selection) persists across restarts via
// localStorage so re-opening the app restores the last filter. Search text stays
// transient — it's a per-look query, not a saved preference.
const STORAGE_GROUPBY = 'awog.sessions.filter.groupBy'
const STORAGE_PROJECTS = 'awog.sessions.filter.projects'

function readGroupBy(): string {
  const v = localStorage.getItem(STORAGE_GROUPBY)
  return v && GROUPBY.some(([value]) => value === v) ? v : 'project'
}
function readProjectFilter(): Set<string> {
  try {
    const arr: unknown = JSON.parse(localStorage.getItem(STORAGE_PROJECTS) ?? '[]')
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    // Corrupt value → fall back to "no filter".
  }
  return new Set()
}

const filter = ref('')
const groupBy = ref(readGroupBy())
// Multi-select project filter: a set of selected projectIds. Empty = no filter
// (all projects shown). Reassign a fresh Set on every change so the ref triggers.
const projectFilter = ref<Set<string>>(readProjectFilter())
const showFilters = ref(false)

// Persist on change. projectFilter is always reassigned (never mutated in place),
// so a shallow watch fires correctly without deep tracking.
watch(groupBy, (v) => localStorage.setItem(STORAGE_GROUPBY, v))
watch(projectFilter, (v) => localStorage.setItem(STORAGE_PROJECTS, JSON.stringify([...v])))

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

// Sessions with no project assigned (s.project === '') bucket under a "Default"
// group in the list, so the filter needs a matching entry to target them. The
// store has no "Default" project (it's the empty-id bucket), so derive it — and
// only when ≥1 such session exists, mirroring the conditional group header.
const hasUnassigned = computed(() => props.sessions.some((s) => !s.project))
// Filter options: an "all" sentinel + the "Default" bucket (when present) + the
// real projects (id + display name).
const projectOptions = computed(() => [
  { id: 'all', name: t('sessions.filter.allProjects') },
  ...(hasUnassigned.value ? [{ id: '', name: t('sessions.defaultProject') }] : []),
  ...projects.value,
])
const activeFilters = computed(() => projectFilter.value.size)
const groupByLabel = computed(() => t(`sessions.group.${groupBy.value}`))
// "All" when nothing picked, the project name for a single pick, "N projects" beyond.
const projectFilterLabel = computed(() => {
  const sel = [...projectFilter.value]
  if (sel.length === 0) return t('sessions.filter.allProjects')
  if (sel.length === 1) return projectName(sel[0]!)
  return t('sessions.filter.nProjects', { n: sel.length })
})

const filtered = computed(() => {
  let f = props.sessions.filter((s) => s.title.toLowerCase().includes(filter.value.toLowerCase()))
  if (projectFilter.value.size) f = f.filter((s) => projectFilter.value.has(s.project))
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
    dot: groupBy.value === 'project' ? colorOf(key) : PROJECT_COLOR_DEFAULT,
  }))
})

function selectGroup(value: string) {
  groupBy.value = value
  groupMenu.value = false
}
// Toggle a project in/out of the filter set; "all" clears it. The menu stays open
// so several projects can be picked in one pass (backdrop click closes it).
function selectProject(p: string) {
  if (p === 'all') {
    projectFilter.value = new Set()
    return
  }
  const next = new Set(projectFilter.value)
  if (next.has(p)) next.delete(p)
  else next.add(p)
  projectFilter.value = next
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
const ctxMenuEl = useTemplateRef<HTMLElement>('ctxMenuEl')
const ctxStyle = ref<Record<string, string>>({})

// Place a context menu at the click point but keep it fully on-screen: flip up when
// it would overflow the bottom (a click near the bottom edge), clamp horizontally,
// and cap height with a scroll when taller than the viewport. Measured AFTER render
// (the height isn't known up front), so it self-corrects regardless of item count.
function placeMenu(el: HTMLElement | null, x: number, y: number): Record<string, string> {
  if (!el) return { left: `${x}px`, top: `${y}px` }
  const M = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = el.offsetWidth
  const h = el.scrollHeight
  const left = x + w > vw - M ? Math.max(M, vw - w - M) : x
  const avail = vh - M * 2
  const maxH = h > avail ? avail : null
  const effH = maxH ?? h
  const top = y + effH > vh - M ? Math.max(M, vh - effH - M) : y
  return {
    left: `${left}px`,
    top: `${top}px`,
    ...(maxH != null ? { maxHeight: `${maxH}px`, overflowY: 'auto' } : {}),
  }
}

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

// ── Project group context menu ─────────────────────────────────────────────────
// Right-click a group header → actions scoped to that group's sessions (new in
// project, (de)select all, delete all, open folder). Same menu chrome as `ctx`.
type GroupRef = { key: string; items: Session[] }
const pctx = ref<{ x: number; y: number; grp: GroupRef } | null>(null)
const pctxMenuEl = useTemplateRef<HTMLElement>('pctxMenuEl')
const pctxStyle = ref<Record<string, string>>({})

function openProjectCtx(grp: GroupRef, e: MouseEvent) {
  const { clientX: x, clientY: y } = e
  pctx.value = { x, y, grp }
  pctxStyle.value = { left: `${x}px`, top: `${y}px` }
  nextTick(() => {
    pctxStyle.value = placeMenu(pctxMenuEl.value, x, y)
  })
}
// Open-folder only when grouping by project (other groupings carry no path).
const pctxPath = computed<string | null>(() =>
  pctx.value && groupBy.value === 'project' ? projectPath(pctx.value.grp.key) : null,
)
// Color picker only makes sense for project buckets (the dot maps to a project).
const pctxIsProject = computed(() => !!pctx.value && groupBy.value === 'project')
const pctxColor = computed(() => (pctx.value ? colorOf(pctx.value.grp.key) : PROJECT_COLOR_DEFAULT))
// Paint (or clear, with null) the right-clicked project's dot. Keep the menu open
// so several swatches can be tried in one pass; the backdrop click dismisses it.
function pSetColor(token: string | null) {
  if (pctx.value) setColor(pctx.value.grp.key, token)
}
function pNewSession() {
  if (pctx.value) store.create(groupBy.value === 'project' ? pctx.value.grp.key : undefined)
  pctx.value = null
}
function pSelectAll() {
  if (pctx.value) {
    selecting.value = true
    pctx.value.grp.items.forEach((s) => {
      if (!store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
  }
  pctx.value = null
}
function pDeselectAll() {
  if (pctx.value)
    pctx.value.grp.items.forEach((s) => {
      if (store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
  pctx.value = null
}
async function pDeleteAll() {
  const grp = pctx.value?.grp
  pctx.value = null // close the menu before the dialog opens
  if (!grp) return
  const n = grp.items.length
  const ok = await confirm({
    title: t('sessions.delete.manyTitle', { n }),
    description: t('sessions.delete.many', { n }),
  })
  if (ok) store.bulkRemove(grp.items.map((s) => s.id))
}
function pOpenFinder() {
  const path = pctxPath.value
  if (path && sc.available) sc.openPath(path, '.').catch(() => undefined)
  pctx.value = null
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
/* Project-dot color picker (inside the group context menu). A small label over a
   row of swatches; the active swatch gets an accent ring, the trailing "clear"
   swatch resets to the neutral default. */
.ctxcolor {
  padding: 4px 10px 6px;
}
.ctxcolorlbl {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--textDim);
}
.ctxsw {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.ctxsw .swatch {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border-radius: 99px;
  cursor: pointer;
  color: var(--textDim);
  box-shadow: 0 0 0 1px var(--border);
  transition:
    transform 0.1s,
    box-shadow 0.1s;
}
.ctxsw .swatch:hover {
  transform: scale(1.12);
}
.ctxsw .swatch.on {
  box-shadow:
    0 0 0 2px var(--bgPanel),
    0 0 0 4px var(--accent);
}
/* "Clear" swatch reads as an outline (no fill) carrying the reset glyph. */
.ctxsw .swatch.clear {
  background: transparent;
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
/* Toolbar icon buttons sit beside the ~28px-tall search field — the global 32px
   .iconbtn reads oversized here, so scope them down to match the search box. */
.ltop .iconbtn {
  width: 28px;
  height: 28px;
}
/* Toolbar: "New session" is the one primary CTA on this surface (filled accent);
   select / filter / fold-all stay subordinate ghost icon buttons (design §4). */
.ltop .iconbtn.pri {
  background: var(--accent);
  border-color: transparent;
  color: var(--accentText);
}
.ltop .iconbtn.pri:hover {
  border-color: transparent;
  color: var(--accentText);
  filter: brightness(1.07);
}
</style>
