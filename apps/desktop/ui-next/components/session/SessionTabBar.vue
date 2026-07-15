<template>
  <div class="stabs">
    <div ref="tablistEl" class="stabs-scroll" role="tablist" :aria-label="t('sessions.tabs.label')">
      <div
        v-for="(tab, i) in tabs"
        :key="tab.id"
        class="stab"
        :class="{ on: tab.active }"
        role="tab"
        :aria-selected="tab.active"
        :tabindex="tab.active ? 0 : -1"
        @click="setActiveTab(tab.id)"
        @keydown="onTabKeydown($event, tab.id, i)"
        @contextmenu.prevent="openTabCtx(tab.id, $event)"
      >
        <span
          class="stab-dot"
          :class="{ running: tab.running }"
          :style="{ background: tab.color, '--stab-dot': tab.color }"
          :role="tab.running ? 'img' : undefined"
          :aria-label="tab.running ? t('sessions.tabs.running') : undefined"
          :title="tab.running ? t('sessions.tabs.running') : undefined"
        />
        <span class="stab-nm">{{ tab.name }}</span>
        <span
          v-if="tab.unread"
          class="stab-unread"
          :title="t('sessions.tabs.unread', { n: tab.unread })"
        >
          {{ tab.unread }}
        </span>
        <button
          v-if="tab.closable"
          class="stab-x"
          :aria-label="t('sessions.tabs.closeName', { name: tab.name })"
          :title="t('sessions.tabs.close')"
          @click.stop="closeTab(tab.id)"
          @keydown.stop
        >
          <Icon name="x" style="width: 12px; height: 12px" />
        </button>
      </div>
    </div>

    <button
      class="stab-btn"
      :aria-label="t('sessions.tabs.addProject')"
      :title="t('sessions.tabs.addProject')"
      @click.stop="toggleAdd"
    >
      <Icon name="plus" style="width: 14px; height: 14px" />
    </button>
    <button
      v-if="tabs.length > 1"
      class="stab-btn"
      :aria-label="t('sessions.tabs.overflow')"
      :title="t('sessions.tabs.overflow')"
      @click.stop="toggleOverflow"
    >
      <Icon name="chev" style="width: 14px; height: 14px" />
    </button>

    <!-- "+" project picker: projects not already open as a tab. -->
    <div v-if="addMenu" class="smenu stabs-drop" @click.stop>
      <template v-if="openableProjects.length">
        <div v-for="p in openableProjects" :key="p.id" class="mi" @click="pickProject(p.id)">
          {{ p.id === '' ? t('sessions.defaultProject') : p.name }}
        </div>
      </template>
      <div v-else class="stabs-empty">{{ t('sessions.tabs.noProjects') }}</div>
    </div>

    <!-- Overflow: jump to any open tab (when the strip scrolls). -->
    <div v-if="overflowMenu" class="smenu stabs-drop" @click.stop>
      <div v-for="tab in tabs" :key="tab.id" class="mi" @click="jumpTab(tab.id)">
        <span
          class="stab-dot"
          :class="{ running: tab.running }"
          :style="{ background: tab.color, '--stab-dot': tab.color }"
        />
        {{ tab.name }}
        <Icon v-if="tab.active" name="check" class="ck" style="width: 13px; height: 13px" />
      </div>
    </div>

    <div
      v-if="addMenu || overflowMenu"
      style="position: fixed; inset: 0; z-index: 40"
      @click="closeMenus"
    />

    <!-- Right-click a tab → project-scoped actions (migrated from the old session
         list group header). Same `.smenu`/`.ctxmenu` chrome as SessionList. -->
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
        <!-- Tab management (VSCode-style) — closing tabs never deletes sessions. -->
        <template v-if="showCloseGroup">
          <div class="ctxsep" />
          <div v-if="pctxClosable" class="mi" @click="pClose">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.close') }}
          </div>
          <div v-if="othersCount" class="mi" @click="pCloseOthers">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.closeOthers') }}
          </div>
          <div v-if="rightCount" class="mi" @click="pCloseRight">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.closeRight') }}
          </div>
          <div v-if="showCloseAll" class="mi" @click="pCloseAll">
            <Icon name="x" style="width: 13px; height: 13px" />
            {{ t('sessions.tabs.closeAll') }}
          </div>
        </template>
        <template v-if="pctxIsProject">
          <div class="ctxsep" />
          <div class="mi" @click="pLlmDefaults">
            <Icon name="brain" style="width: 13px; height: 13px" />
            {{ t('sessions.pctx.llmDefaults') }}
          </div>
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
              <!-- Custom color: a <label> wrapping a hidden native color input so
                   clicking the swatch opens the OS color picker anchored right here.
                   When a custom hex is active the swatch shows it; otherwise a
                   palette glyph hints "pick your own". -->
              <label
                class="swatch custom"
                :class="{ on: pctxCustom }"
                :style="pctxCustom ? { background: pctxColor } : undefined"
                :title="t('sessions.pctx.colorCustom')"
              >
                <Icon v-if="!pctxCustom" name="palette" style="width: 11px; height: 11px" />
                <input
                  type="color"
                  class="ctxcolorinput"
                  :value="customColorValue"
                  @input="onCustomColorInput"
                />
              </label>
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
          {{ t('sessions.pctx.selectAll', { n: pctxCount }) }}
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
          {{ t('sessions.pctx.deleteAll', { n: pctxCount }) }}
        </div>
      </div>
    </template>

    <!-- Per-project "Session LLM defaults" — opened from the tab context menu. -->
    <ProjectLlmDefaultsModal
      :open="!!llmModalProject"
      :project="llmModalProject"
      @saved="llmModalProject = null"
      @cancel="llmModalProject = null"
    />
  </div>
</template>

<script setup lang="ts">
// VSCode-style project tab strip for the Sessions screen. Each tab = an OPENED
// project ('' = the Default tab for unassigned sessions); selecting a tab filters
// the session list (store.tabSessions) and restores that tab's last-viewed session.
// Tab state + open/close/activate logic live in the sessions store; this component
// is presentation + the project context menu (migrated from the old list group
// header). SoC: state via the store, no IPC except open-in-Finder.
import type { Project } from '~/types'
import ProjectLlmDefaultsModal from '~/components/project/ProjectLlmDefaultsModal.vue'
import {
  isCustomColor,
  PROJECT_COLOR_DEFAULT,
  PROJECT_COLOR_PALETTE,
  useProjectColors,
} from '~/composables/useProjectColors'
import { placeMenu } from '~/utils/context-menu'

const { t } = useI18n()
const { tabs, openableProjects, projectPath, setActiveTab, closeTab } = useSessionTabs()
const store = useSessionsStore()
const projectsStore = useProjectsStore()
const { colorOf, setColor } = useProjectColors()
const sc = useSidecar()
const { confirm } = useConfirm()

// ── Keyboard nav (roving tabindex, desktop keyboard-first) ──────────────────────
// Active tab is the only tab in the page tab order; Enter/Space activates the
// focused tab and Arrow keys move (selection follows focus, like editor tabs).
const tablistEl = useTemplateRef<HTMLElement>('tablistEl')
function focusTab(i: number) {
  const els = tablistEl.value?.querySelectorAll<HTMLElement>('[role="tab"]')
  els?.[i]?.focus()
}
function onTabKeydown(e: KeyboardEvent, id: string, index: number) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    setActiveTab(id)
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault()
    const n = tabs.value.length
    if (!n) return
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
    setActiveTab(tabs.value[next]!.id)
    nextTick(() => focusTab(next))
  }
}

// ── "+" picker + overflow dropdowns ─────────────────────────────────────────────
const addMenu = ref(false)
const overflowMenu = ref(false)
function toggleAdd() {
  addMenu.value = !addMenu.value
  overflowMenu.value = false
}
function toggleOverflow() {
  overflowMenu.value = !overflowMenu.value
  addMenu.value = false
}
function closeMenus() {
  addMenu.value = false
  overflowMenu.value = false
}
function pickProject(id: string) {
  setActiveTab(id)
  addMenu.value = false
}
function jumpTab(id: string) {
  setActiveTab(id)
  overflowMenu.value = false
}

// ── Tab context menu (project-scoped actions) ────────────────────────────────────
const pctx = ref<{ x: number; y: number; id: string } | null>(null)
const pctxMenuEl = useTemplateRef<HTMLElement>('pctxMenuEl')
const pctxStyle = ref<Record<string, string>>({})

function openTabCtx(id: string, e: MouseEvent) {
  const { clientX: x, clientY: y } = e
  pctx.value = { x, y, id }
  pctxStyle.value = { left: `${x}px`, top: `${y}px` }
  nextTick(() => {
    pctxStyle.value = placeMenu(pctxMenuEl.value, x, y)
  })
}

// Color / LLM-defaults / open-Finder only make sense for a real project tab (the
// Default tab '' carries no project id / on-disk path).
const pctxIsProject = computed(() => !!pctx.value && pctx.value.id !== '')
const pctxColor = computed(() => (pctx.value?.id ? colorOf(pctx.value.id) : PROJECT_COLOR_DEFAULT))
// True when the active project's dot uses a user-picked hex (not a palette token).
const pctxCustom = computed(() => isCustomColor(pctxColor.value))
// Native <input type="color"> only accepts `#rrggbb`; seed it with the current
// custom hex, else a neutral start so the OS picker opens somewhere sensible.
const customColorValue = computed(() => (pctxCustom.value ? pctxColor.value : '#888888'))
const pctxPath = computed<string | null>(() => (pctx.value?.id ? projectPath(pctx.value.id) : null))
const pctxCount = computed(() =>
  pctx.value ? store.sessions.filter((s) => s.project === pctx.value!.id).length : 0,
)

// Tab-close visibility gates (VSCode-style). The Default tab ('') is never closable;
// "Close all" stays available from it so it can close the remaining project tabs.
const pctxClosable = computed(() => !!pctx.value && pctx.value.id !== '')
const othersCount = computed(() =>
  pctx.value ? store.openProjectTabs.filter((p) => p !== '' && p !== pctx.value!.id).length : 0,
)
const rightCount = computed(() => {
  if (!pctx.value) return 0
  const i = store.openProjectTabs.indexOf(pctx.value.id)
  return i < 0 ? 0 : store.openProjectTabs.slice(i + 1).filter((p) => p !== '').length
})
const totalClosable = computed(() => store.openProjectTabs.filter((p) => p !== '').length)
const showCloseAll = computed(
  () => totalClosable.value > 1 || (totalClosable.value === 1 && !pctxClosable.value),
)
const showCloseGroup = computed(
  () => pctxClosable.value || othersCount.value > 0 || rightCount.value > 0 || showCloseAll.value,
)
function pClose() {
  const id = pctx.value?.id
  pctx.value = null
  if (id) closeTab(id)
}
function pCloseOthers() {
  const id = pctx.value?.id
  pctx.value = null
  if (id != null) store.closeOtherTabs(id)
}
function pCloseRight() {
  const id = pctx.value?.id
  pctx.value = null
  if (id != null) store.closeTabsToRight(id)
}
function pCloseAll() {
  pctx.value = null
  store.closeAllTabs()
}

function pSetColor(token: string | null) {
  if (pctx.value?.id) setColor(pctx.value.id, token)
}
// Native color picker → store the raw hex (fires live as the user drags in the
// OS picker, so the dot updates immediately). The menu stays open throughout.
function onCustomColorInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  if (pctx.value?.id) setColor(pctx.value.id, value)
}
function pNewSession() {
  const id = pctx.value?.id
  pctx.value = null
  store.create(id || undefined)
}
const llmModalProject = ref<Project | null>(null)
function pLlmDefaults() {
  const id = pctx.value?.id
  pctx.value = null
  if (id) llmModalProject.value = projectsStore.projectById(id) ?? null
}
function pSelectAll() {
  const id = pctx.value?.id
  pctx.value = null
  if (id == null) return
  store.setSelectMode(true)
  store.sessions
    .filter((s) => s.project === id)
    .forEach((s) => {
      if (!store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
}
function pDeselectAll() {
  const id = pctx.value?.id
  pctx.value = null
  if (id == null) return
  store.sessions
    .filter((s) => s.project === id)
    .forEach((s) => {
      if (store.selectedIds.has(s.id)) store.toggleSelect(s.id)
    })
}
function pOpenFinder() {
  const path = pctxPath.value
  pctx.value = null
  if (path && sc.available) sc.openPath(path, '.').catch(() => undefined)
}
async function pDeleteAll() {
  const id = pctx.value?.id
  pctx.value = null
  if (id == null) return
  const ids = store.sessions.filter((s) => s.project === id).map((s) => s.id)
  if (!ids.length) return
  const ok = await confirm({
    title: t('sessions.delete.manyTitle', { n: ids.length }),
    description: t('sessions.delete.many', { n: ids.length }),
  })
  if (ok) store.bulkRemove(ids)
}
</script>

<style scoped>
.stabs {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex: 0 0 auto;
  padding: 0 8px;
  min-height: 38px;
  border-bottom: 1px solid var(--border);
  background: var(--bgPanel);
}
.stabs-scroll {
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.stabs-scroll::-webkit-scrollbar {
  display: none;
}
/* One tab: flat by default, accent underline + brighter text when active. */
.stab {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  max-width: 200px;
  padding: 0 9px;
  cursor: pointer;
  color: var(--textDim);
  border-bottom: 2px solid transparent;
  user-select: none;
}
/* Hover only on inactive tabs — the active tab keeps its accent tint (no gray
   fill swap on hover). */
.stab:hover:not(.on) {
  background: var(--bgHover);
  color: var(--text);
}
/* Active tab: accent-tint fill (NOT a gray surface) + accent underline + brighter
   text, so it reads clearly as the open project. */
.stab.on {
  color: var(--text);
  background: var(--accentDim);
  border-bottom-color: var(--accent);
}
/* Keyboard focus ring (a11y) — never removed; the click :hover/:active states are
   separate. Inset so it reads inside the strip's bottom border. */
.stab:focus-visible,
.stab-btn:focus-visible,
.stab-x:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 6px;
}
.stab-dot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 99px;
  flex: 0 0 auto;
}
/* A session in this project is actively streaming → a spinner arc rotates around
   the dot in the PROJECT's own color (var(--stab-dot), set inline): an unmistakable
   "work in progress" cue that keeps project identity. The old opacity-breathe +
   expanding box-shadow ring read as subtle AND its ring was clipped by the strip's
   overflow-x:auto — the arc sits inside the dot's footprint (inset -3px) so it's
   never clipped. Only `transform` animates (GPU, no reflow). */
.stab-dot.running::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  border-top-color: var(--stab-dot, var(--accent));
  border-right-color: var(--stab-dot, var(--accent));
  animation: stab-dot-spin 0.7s linear infinite;
}
@keyframes stab-dot-spin {
  to {
    transform: rotate(360deg);
  }
}
.stab-nm {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.stab.on .stab-nm {
  font-weight: 600;
}
/* Unread / attention count — amber pill, same semantic + look as the NavRail
   sessions badge (.bdg.wait). Only rendered when > 0. */
.stab-unread {
  display: grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 5px;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  background: var(--amberDim);
  color: var(--amber);
  border: 1px solid var(--amberBorder);
}
.stab-x {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: 5px;
  color: var(--textFaint);
  opacity: 0;
  transition: opacity 0.12s;
}
.stab:hover .stab-x,
.stab.on .stab-x {
  opacity: 1;
}
.stab-x:hover {
  color: var(--text);
  background: var(--bgActive);
}
/* "+" / overflow buttons sit flush at the right of the strip. */
.stab-btn {
  display: grid;
  place-items: center;
  width: 28px;
  flex: 0 0 auto;
  align-self: center;
  height: 28px;
  border: 0;
  border-radius: 7px;
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
}
.stab-btn:hover {
  color: var(--text);
  background: var(--bgHover);
}
/* Dropdowns under the strip (add picker / overflow). Mirrors SessionList's inline
   `.smenu` dropdowns: absolutely placed, above the page body. */
.stabs-drop {
  position: absolute;
  top: 100%;
  right: 8px;
  z-index: 50;
  min-width: 180px;
  max-height: 60vh;
  overflow-y: auto;
}
.stabs-drop .stab-dot {
  margin-right: 2px;
}
.stabs-empty {
  padding: 8px 12px;
  color: var(--textFaint);
}
/* Context menu chrome (copied from SessionList — the project actions moved here). */
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
.ctxsep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
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
.ctxsw .swatch.clear {
  background: transparent;
}
/* Custom-color swatch: a rainbow hint when no custom hex is picked, else it wears
   the chosen color (background set inline). Relative so the native input overlays it. */
.ctxsw .swatch.custom {
  position: relative;
  overflow: hidden;
  color: var(--text);
  background: conic-gradient(
    from 0deg,
    #f87171,
    #fbbf24,
    #34d399,
    #60a5fa,
    #a78bfa,
    #f472b6,
    #f87171
  );
}
/* The native color input fills the swatch, fully transparent — clicking the swatch
   opens the OS picker anchored here. */
.ctxsw .swatch.custom .ctxcolorinput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  cursor: pointer;
}
.ctxmenu .mi.danger {
  color: var(--danger);
}
.ctxmenu .mi.danger:hover {
  background: var(--dangerDim, color-mix(in srgb, var(--danger) 14%, transparent));
}
@media (prefers-reduced-motion: reduce) {
  .stab-x,
  .ctxsw .swatch {
    transition: none;
  }
  /* No spin, but keep a STATIC full ring so a running project is still visible
     (dropping the cue entirely would hide it for reduced-motion users). */
  .stab-dot.running::after {
    animation: none;
    border-color: var(--stab-dot, var(--accent));
    opacity: 0.6;
  }
}
</style>
