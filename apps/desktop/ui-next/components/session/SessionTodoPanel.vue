<template>
  <!-- Biến thể `chip` (session-ui-refactor §3.2): checklist sống trong hàng ngữ cảnh
       dùng chung thay vì một dải riêng chiếm trọn bề ngang. Hành vi giữ nguyên luật
       của ADR 0069 — chip KHÔNG tự ẩn khi xong, và nó không tự bung: danh sách đầy
       đủ vẫn là một cú bấm, y như strip `done/total` trước đây. -->
  <span v-if="variant === 'chip' && bannerVisible && !dismissed" class="ctxwrap2">
    <button
      class="ctxchip"
      :class="{ acc: allDone, on: popOpen }"
      :title="t('sessions.todo.title')"
      @click.stop="popOpen = !popOpen"
    >
      <Icon
        :name="allDone ? 'check' : 'tasks'"
        style="width: var(--icon-xs); height: var(--icon-xs)"
      />
      <span class="tdn">{{ doneCount }}/{{ total }}</span>
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
    </button>
    <template v-if="popOpen">
      <div class="ctxbackdrop2" @click="popOpen = false" />
      <div class="pop todopop" @click.stop>
        <div class="pl todopop-h">
          {{ t('sessions.todo.title') }}
          <button type="button" class="todox" :title="t('sessions.todo.hide')" @click="hide">
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>
        <SessionTodoList :todos="todos" editable @cycle="cycleTodo" />
      </div>
    </template>
  </span>

  <!-- Session-level pinned checklist. Docked above the composer, it shows the LATEST
       TodoWrite and stays available for as long as the session has one — including
       after the turn ends, which is exactly when the user needs to see where work
       stopped. It opens as a one-line `done/total` strip and NEVER expands itself:
       the full list is a click away, or in the Plan & Progress tab / the inline
       transcript step. The × dismisses it for this session.
       Rows are editable — a click cycles a row's status (see useSessionTodo). -->
  <div
    v-else-if="variant === 'bar' && bannerVisible && !dismissed"
    class="todop"
    :class="{ col: collapsed }"
  >
    <div
      class="todoh"
      :title="collapsed ? t('sessions.todo.expand') : t('sessions.todo.collapse')"
      @click="collapsed = !collapsed"
    >
      <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
      <Icon
        :name="allDone ? 'check' : 'tasks'"
        style="width: var(--icon-sm); height: var(--icon-sm)"
      />
      <span>{{ t('sessions.todo.title') }}</span>
      <span class="tdn">{{ doneCount }}/{{ total }}</span>
      <button
        type="button"
        class="todox"
        :title="t('sessions.todo.hide')"
        @click.stop="dismissed = true"
      >
        <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>
    <SessionTodoList :todos="todos" editable @cycle="cycleTodo" />
  </div>
</template>

<script setup lang="ts">
// To-do panel (todoHtml ~1882): collapsible header (chevron) + checklist rows. The
// rows are editable — a click cycles a row's status and persists the whole list — see
// useSessionTodo for the shared source-of-truth and banner/inline rules.
import type { Session } from '~/composables/useSessionsData'

const props = withDefaults(defineProps<{ session: Session; variant?: 'bar' | 'chip' }>(), {
  variant: 'bar',
})
const { t } = useI18n()
const popOpen = ref(false)
function hide() {
  popOpen.value = false
  dismissed.value = true
}

const { todos, total, doneCount, allDone, bannerVisible, cycleTodo } = useSessionTodo(
  () => props.session,
)

// Always starts collapsed — the banner is a progress strip, not a panel. It used to
// expand itself whenever a turn was live, which meant the tallest thing on screen was
// a list the user had already read, pushing the conversation out of view on every run.
// Nothing re-collapses or re-expands it behind the user's back; only a session switch
// re-applies the default.
const collapsed = ref(true)
const dismissed = ref(false)

// A different session means a different checklist — re-apply both defaults.
watch(
  () => props.session.id,
  () => {
    collapsed.value = true
    dismissed.value = false
  },
)

// Dismissal covers the checklist that was on screen, not the session forever: a brand
// new list (0 → n) brings the strip back — as a strip, collapsed like any first sight
// of a list — so closing it can never hide work the user has not seen. Updates to an
// existing list change nothing: neither the dismissal nor the open/closed state.
watch(total, (n, prev) => {
  if (n > 0 && prev === 0) {
    dismissed.value = false
    collapsed.value = true
  }
})
</script>

<style scoped>
/* Sits after `.tdn` (which holds `margin-left:auto`), so it pins to the right edge of
   the header row. Icon-only, revealed on hover of the row — the header is a click
   target itself, so a permanently loud × would compete with it. */
.todox {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin: -4px -4px -4px 2px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}
.todoh:hover .todox,
.todox:focus-visible {
  opacity: 1;
}
.todox:hover {
  color: var(--text);
  background: var(--bgHover);
}

/* ── Biến thể chip: popover neo vào chip trong hàng ngữ cảnh (§3.2) ─────── */
.ctxwrap2 {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
.ctxbackdrop2 {
  position: fixed;
  inset: 0;
  z-index: 40;
}
/* Strip nằm ở ĐẦU cột chat nên popover mở XUỐNG. */
.todopop {
  position: absolute;
  top: 128%;
  left: 0;
  z-index: 50;
  width: 340px;
  max-height: 360px;
  overflow-y: auto;
}
.todopop-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
.todopop-h .todox {
  margin-left: auto;
}
</style>
