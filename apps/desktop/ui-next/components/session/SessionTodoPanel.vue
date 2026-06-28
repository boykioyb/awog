<template>
  <div class="todop" :class="{ col: collapsed }">
    <div class="todoh" @click="collapsed = !collapsed">
      <Icon name="chev" style="width: 12px; height: 12px" />
      <Icon name="tasks" style="width: 13px; height: 13px" />
      <span>{{ t('sessions.todo.title') }}</span>
      <span class="tdn">{{ doneCount }}/{{ todos.length }}</span>
    </div>
    <div class="todol">
      <div
        v-for="(td, i) in todos"
        :key="i"
        class="tdrow"
        :class="{ done: td.done }"
        @click="emit('toggle', i)"
      >
        <span class="tdck">
          <Icon v-if="td.done" name="check" style="width: 12px; height: 12px" />
        </span>
        {{ td.t }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// To-do panel (todoHtml ~1882): collapsible header (chevron) + rows that toggle done.
import type { Todo } from '~/composables/useSessionsData'

const props = defineProps<{ todos: Todo[] }>()
const emit = defineEmits<{ toggle: [i: number] }>()
const { t } = useI18n()

const collapsed = ref(false)
const doneCount = computed(() => props.todos.filter((td) => td.done).length)
</script>
