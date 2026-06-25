<template>
  <section class="page on" data-page="tasks">
    <LibraryView
      :items="tasks"
      :item-key="(task) => task.id"
      :search-text="(task) => task.title"
      :placeholder="t('tasks.search')"
      show-new
      @new="openNew"
    >
      <template #row="{ item: task }">
        <TaskListItem :task="task" :progress="progressOf(task)" />
      </template>

      <template #detail="{ item: task }">
        <TaskDetail
          :task="task"
          @approve="(nodeId) => approve(task.id, nodeId)"
          @rerun="(nodeId, instr) => rerun(task.id, nodeId, instr)"
          @discuss="(nodeId, v, text) => discuss(task.id, nodeId, v, text)"
          @cancel="cancel(task.id)"
          @pause="pause(task.id)"
          @resume="resume(task.id)"
          @delete="askDelete(task)"
        />
      </template>
    </LibraryView>

    <!-- new task -->
    <NewTaskModal :open="newOpen" :data="newTaskData" @save="onCreate" @cancel="closeNew" />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('tasks.delete.title')"
      :description="deleteDescription"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- transient toasts -->
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: toastColor(tt.kind) }"
    >
      {{ tt.text }}
    </div>
  </section>
</template>

<script setup lang="ts">
// Tasks — live Task Execution Engine slice (ADR 0024). Replaces the static mock
// from the prototype port. Master-detail shell from <LibraryView>; all state +
// IPC live in useTasksPage (page-controller). Rows show status + progress;
// the detail renders the pipeline (phase cards with approve / rerun / discuss /
// cancel) wired to the event-sourced tasks store. The standalone Monaco artifact
// editor route (old UI /edit/[taskId]) is intentionally OUT OF SCOPE here.
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import LibraryView from '~/components/library/LibraryView.vue'
import NewTaskModal from '~/components/task/NewTaskModal.vue'
import TaskDetail from '~/components/task/TaskDetail.vue'
import TaskListItem from '~/components/task/TaskListItem.vue'
import { useI18n } from '~/composables/useI18n'
import { useTasksPage } from '~/composables/useTasksPage'

const { t } = useI18n()

const {
  tasks,
  progressOf,
  newOpen,
  openNew,
  closeNew,
  onCreate,
  newTaskData,
  approve,
  rerun,
  discuss,
  cancel,
  pause,
  resume,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  toasts,
  toastColor,
} = useTasksPage()
</script>
