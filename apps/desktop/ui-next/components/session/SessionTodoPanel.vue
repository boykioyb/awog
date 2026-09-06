<template>
  <!-- Session-level pinned checklist. Docked above the composer, it shows the LATEST
       TodoWrite and stays visible for as long as the session has one — including after
       the turn ends, which is exactly when the user needs to see where work stopped.
       Expanded while work is active, auto-collapsed to a one-line `done/total` strip
       when it is not; the completed list also lands inline as a transcript step so the
       conversation keeps the record (see useSessionTodo + SessionStepItem).
       Read-only: the model owns the list. -->
  <div v-if="bannerVisible" class="todop" :class="{ col: collapsed }">
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
    </div>
    <SessionTodoList :todos="todos" editable @cycle="cycleTodo" />
  </div>
</template>

<script setup lang="ts">
// To-do panel (todoHtml ~1882): collapsible header (chevron) + checklist rows. The
// rows are editable — a click cycles a row's status and persists the whole list — see
// useSessionTodo for the shared source-of-truth and banner/inline rules.
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()

const { todos, total, doneCount, allDone, isActive, bannerVisible, cycleTodo } = useSessionTodo(
  () => props.session,
)

// Expanded while work is live, collapsed to the one-line strip otherwise. Watching
// `isActive` instead of binding `collapsed` to it keeps a manual toggle sticky until
// the activity state actually changes.
const collapsed = ref(!isActive.value)
watch(isActive, (active) => {
  collapsed.value = !active
})

// A different session means a different checklist — re-apply the default.
watch(
  () => props.session.id,
  () => {
    collapsed.value = !isActive.value
  },
)
</script>
