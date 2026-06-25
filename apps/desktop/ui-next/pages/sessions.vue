<template>
  <section class="page on" data-page="sessions">
    <div class="md">
      <SessionList
        :sessions="store.sessions"
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
          <button class="btn pri" @click="store.create()">
            <Icon name="plus" />
            {{ t('sessions.new') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Sessions page — list + resize handle + detail, backed by the reactive
// `useSessionsStore` (CRUD/active/send). Per-area interactions live in the
// child components; data is still mock (no IPC). See tasks/session-screen-checklist.md.
const { t } = useI18n()
const store = useSessionsStore()

const {
  width: listWidth,
  dragging: listDragging,
  onPointerDown: onListResize,
} = useResizable(296, { min: 200, max: 520 })
</script>
