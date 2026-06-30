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
      <SessionDetail v-if="store.active" :key="store.active.id" :session="store.active" />
      <div v-else class="detail">
        <div class="empty">
          <span class="ei"><Icon name="sessions" style="width: 21px; height: 21px" /></span>
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
    </div>
  </section>
</template>

<script setup lang="ts">
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
</script>

<style scoped>
/* The global `.page.on` is a flex ROW; this page stacks the tab strip above the
   list+detail row, so make its own page a column. The tab strip is fixed-height
   (flex:0 0 auto, set in SessionTabBar); `.md` fills the rest. */
.sessions-page.page {
  flex-direction: column;
}
</style>
