<template>
  <section class="page on sessions-page" data-page="sessions">
    <!-- VSCode-style project tab strip: one tab per opened project; selecting a tab
         filters the list below (store.tabSessions) + restores its last-viewed session. -->
    <SessionTabBar />
    <div class="md">
      <!-- Collapsed → hidden with v-show, not v-if: the list keeps its transient state
           (search text, per-group page) and its cross-session search results across a
           collapse, and expanding is instant. In compact mode the list is an off-canvas
           drawer with its own top-bar toggle, so the collapse flag must not hide it
           there — it would leave that toggle opening nothing. -->
      <SessionList
        v-show="!listHidden"
        :sessions="store.tabSessions"
        :active-id="store.activeId"
        :list-width="listWidth"
        @select="store.setActive($event)"
      />
      <!-- Collapsed icon rail (proto parity): a thin column keeps the sessions of the
           active tab reachable — expand button on top, then one status icon per
           session; tooltip carries the title, click selects. Rendered only in the
           wide layout — compact mode uses the off-canvas drawer instead. -->
      <div v-if="listHidden" class="listrail">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="iconSm"
              :aria-label="t('sessions.list.expand')"
              :title="t('sessions.list.expand')"
              @click="toggleList"
            >
              <PanelLeftOpen class="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ t('sessions.list.expand') }}</TooltipContent>
        </Tooltip>
        <Separator class="my-1" />
        <Tooltip v-for="s in store.tabSessions.slice(0, 6)" :key="s.id">
          <TooltipTrigger as-child>
            <button
              class="lritem"
              :class="{ on: s.id === store.activeId }"
              :aria-label="s.title"
              @click="store.setActive(s.id)"
            >
              <component
                :is="RAIL_META[s.status].icon"
                :class="['lrico', RAIL_META[s.status].cls]"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ s.title }}</TooltipContent>
        </Tooltip>
      </div>
      <div
        v-if="!listHidden"
        class="rsz"
        :class="{ drag: listDragging }"
        :title="t('sessions.resizeList')"
        @pointerdown="onListResize"
      />
      <!-- Cache recent detail instances (keyed by session id) so switching back to a
           session — including the last-active session of each project tab — is instant
           instead of tearing down + rebuilding the whole composer + workspace panel +
           transcript. `:max` bounds how many stay mounted (their terminals/watchers keep
           running in the background); 5 keeps a handful of projects warm while switching
           between them. Shared singletons (chatAttach consumer, workspace footer bridge)
           are gated on the active instance inside SessionDetail so cached ones don't
           cross-talk.

           A session popped out into its own window is owned by THAT window
           (docs/features/session-popout-window.md) — the handoff card shows the way back
           instead of a second, stale transcript, under one `handoff` key so the
           placeholder is cached once, not per session.

           NOTE: every comment must stay OUTSIDE <KeepAlive> — dev builds keep comment
           nodes, and a comment counts as a child, so an inline one fails the compiler's
           "expects exactly one child component" check. -->
      <KeepAlive :max="5">
        <SessionHandoffCard
          v-if="store.active && store.isHandedOff(store.active.engineId)"
          key="handoff"
          :session="store.active"
        />
        <SessionDetail v-else-if="store.active" :key="store.active.id" :session="store.active" />
        <div v-else class="detail">
          <div class="empty">
            <span class="ei"><Icon name="sessions" style="width: 22px; height: 22px" /></span>
            <div class="et">
              {{ t('sessions.empty.title') }}
              <br />
              {{ t('sessions.empty.subtitle') }}
            </div>
            <Button @click="store.create(store.activeTab)">
              <Icon name="plus" />
              {{ t('sessions.new') }}
            </Button>
          </div>
        </div>
      </KeepAlive>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, watch } from 'vue'
import { CircleCheck, CircleHelp, CircleX, FileText, Loader2, PanelLeftOpen } from 'lucide-vue-next'
import type { SessionStatus } from '~/composables/useSessionsData'
// Sessions page — project tab strip on top, then list + resize handle + detail,
// all backed by the reactive `useSessionsStore`. The list operates on the active
// tab's sessions (store.tabSessions); the empty-state "+" creates a session scoped
// to the active tab. Per-area interactions live in the child components.
const { t } = useI18n()
const store = useSessionsStore()

const {
  width: listWidth,
  dragging: listDragging,
  onPointerDown: onListResize,
} = useResizable(296, { min: 200, max: 520 })

// Keep the app-wide terminal dock aligned with the DETAIL column: publish the list
// width (+ the 6px resize handle) so the dock starts where the list ends instead of
// spanning under it — the list itself keeps its FULL height (the dock floats over the
// detail column only; see useDockMetrics). In compact mode the list is an off-canvas
// drawer, so there is no rail to clear and the inset must be 0.
//
// This page is inside <NuxtPage keepalive>, so `onUnmounted` never fires on navigation —
// the inset has to be dropped on `onDeactivated` and restored on `onActivated`, or every
// other page would render the dock indented by a list it does not have.
const RSZ_W = 6
const { setInset, clearInset } = useDockMetrics()
const { compact } = useResponsiveShell()

// The list column can also be collapsed away entirely (toggle in the tab strip).
// Collapsed it becomes a 40px icon rail — the dock inset must still clear it.
const { collapsed: listCollapsed, toggle: toggleList } = useSessionListCollapse()
const listHidden = computed(() => listCollapsed.value && !compact.value)

// Status→icon cho rail — cùng map STATUS_META của SessionListItem (giữ đồng bộ).
const RAIL_META: Record<SessionStatus, { icon: typeof CircleCheck; cls: string }> = {
  idle: { icon: FileText, cls: 'text-muted-foreground' },
  streaming: { icon: Loader2, cls: 'text-primary lrspin' },
  awaiting: { icon: CircleHelp, cls: 'text-warning' },
  done: { icon: CircleCheck, cls: 'text-success' },
  error: { icon: CircleX, cls: 'text-destructive' },
}

const RAIL_W = 40
const publishInset = () =>
  setInset(compact.value ? 0 : listCollapsed.value ? RAIL_W : listWidth.value + RSZ_W)
watch([listWidth, compact, listHidden], publishInset)
onMounted(publishInset)
onActivated(publishInset)
onDeactivated(clearInset)
onUnmounted(clearInset)
</script>

<style scoped>
/* The global `.page.on` is a flex ROW; this page stacks the tab strip above the
   list+detail row, so make its own page a column. The tab strip is fixed-height
   (flex:0 0 auto, set in SessionTabBar); `.md` fills the rest. */
.sessions-page.page {
  flex-direction: column;
}

/* shadcn token pass (alias bridge): the empty-state tile reads as a raised card,
   copy in muted-foreground; the resize handle's active/hover line uses --ring
   (the emerald-42% accent border) instead of a solid accent stripe. */
.sessions-page .empty .ei {
  background: var(--card);
  border-color: var(--border);
  color: var(--muted-foreground);
}
.sessions-page .empty .et {
  color: var(--muted-foreground);
}
.sessions-page .rsz:hover::after,
.sessions-page .rsz.drag::after {
  background: var(--ring);
}

/* Collapsed list → icon rail (proto: w-10 flex-col items-center gap-1 border-r
   bg-background py-2). Sessions can exceed the rail's height — scroll the item
   column, scrollbar hidden since it would eat most of a 40px strip. */
.listrail {
  width: 40px;
  flex: 0 0 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
  border-right: 1px solid var(--border);
  background: var(--background);
  overflow-y: auto;
  scrollbar-width: none;
}
.lritem {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.lritem:hover {
  background: var(--accent-wash);
}
.lritem.on {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.lritem .lrico {
  width: 14px;
  height: 14px;
}
/* Loader2 spin — animate-spin của proto; giữ keyframes cục bộ để không phụ thuộc
   tailwind utility trong trang không-dùng-tailwind này. */
.lritem .lrspin {
  animation: lrspin 1s linear infinite;
}
@keyframes lrspin {
  to {
    transform: rotate(360deg);
  }
}
</style>
