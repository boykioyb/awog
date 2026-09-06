<template>
  <section class="page on sessions-page" data-page="sessions">
    <!-- VSCode-style project tab strip: one tab per opened project; selecting a tab
         filters the list below (store.tabSessions) + restores its last-viewed session. -->
    <SessionTabBar />
    <div class="md">
      <SessionList
        :sessions="store.tabSessions"
        :active-id="store.activeId"
        :list-width="listWidth"
        @select="store.setActive($event)"
      />
      <div
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
            <button class="btn pri" @click="store.create(store.activeTab)">
              <Icon name="plus" />
              {{ t('sessions.new') }}
            </button>
          </div>
        </div>
      </KeepAlive>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted, watch } from 'vue'
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
const publishInset = () => setInset(compact.value ? 0 : listWidth.value + RSZ_W)
watch([listWidth, compact], publishInset)
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
</style>
