<template>
  <NewTaskModal
    :open="open"
    :data="data"
    :seed-project-id="seed.projectId"
    :seed-title="seed.title"
    :seed-workflow-id="seed.workflowId"
    :origin-session-id="seed.originSessionId"
    @save="onSave"
    @cancel="close"
  />
  <div
    v-for="tt in toasts"
    :key="tt.id"
    class="toast"
    :style="{ borderColor: toastColor(tt.kind) }"
  >
    {{ tt.text }}
  </div>
</template>

<script setup lang="ts">
// Single app-lifetime host for the New Task modal (ADR 0055). Mounted once in the
// default layout; owns the modal's data bundle + the create flow + the "created"
// toast so any page can pop the creator via useNewTaskModal().openModal(seed). The
// snapshot-resolve mirrors useTasksPage.onCreate (the Tasks page now delegates here).
import { watch } from 'vue'
import NewTaskModal from '~/components/task/NewTaskModal.vue'
import { useNewTaskModal } from '~/composables/useNewTaskModal'
import { useNewTaskData, type WorkflowOption } from '~/composables/useNewTaskData'
import { useTasksStore, type CreateTaskInput } from '~/stores/tasks'
import { useToasts } from '~/composables/useToasts'
import { useI18n } from '~/composables/useI18n'

const { open, seed, close } = useNewTaskModal()
const data = useNewTaskData()
const store = useTasksStore()
const { t } = useI18n()
const { toasts, pushToast, toastColor } = useToasts()

// Load the modal's data (workflows/projects/connections) when it opens.
watch(open, (v) => {
  if (v) void data.load()
})

function onSave(input: CreateTaskInput): void {
  const wf: WorkflowOption | undefined = data.workflows.value.find((w) => w.id === input.workflowId)
  const snapshot = wf ? { id: wf.id, name: wf.name, nodes: wf.nodes, edges: wf.edges } : undefined
  const task = store.createTask(input, snapshot)
  close()
  pushToast(t('tasks.toast.created', { title: task.title }), 'success')
}
</script>
