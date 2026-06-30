<template>
  <!-- Session-level pinned checklist. Docked above the composer, it shows the LATEST
       TodoWrite ONLY while the turn is running with open items — a live progress
       affordance that stays visible while scrolling a long reply. The moment the list
       is all done (or the turn ends) the banner yields and the completed checklist
       re-appears inline as a transcript step instead (see useSessionTodo +
       SessionStepItem). Read-only: the model owns the list. -->
  <div v-if="bannerVisible" class="todop" :class="{ col: collapsed }">
    <div
      class="todoh"
      :title="collapsed ? t('sessions.todo.expand') : t('sessions.todo.collapse')"
      @click="collapsed = !collapsed"
    >
      <Icon name="chev" style="width: 12px; height: 12px" />
      <Icon name="tasks" style="width: 13px; height: 13px" />
      <span>{{ t('sessions.todo.title') }}</span>
      <span class="tdn">{{ doneCount }}/{{ total }}</span>
    </div>
    <SessionTodoList :todos="todos" />
  </div>
</template>

<script setup lang="ts">
// To-do panel (todoHtml ~1882): collapsible header (chevron) + checklist rows. The
// list is derived from the session transcript (the latest TodoWrite `note` step), not
// a static field — see useSessionTodo for the shared banner/inline rules.
import type { Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()

const { todos, total, doneCount, bannerVisible } = useSessionTodo(() => props.session)

const collapsed = ref(false)
</script>
