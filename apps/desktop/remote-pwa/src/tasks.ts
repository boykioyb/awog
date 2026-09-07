import { ref } from 'vue'
import { gateway } from './gateway'
import { capabilities } from './catalog'
import { errMsg } from './util'
import type { RemoteTaskDetail, RemoteTaskSummary } from './types'

// Task/Workflow từ điện thoại (#18). State phẳng, không Pinia — giống store.ts.
//
// Đọc đi qua hai method LOCAL của gateway (`remote.tasks` / `remote.task`): bản
// Task thật mang cả snapshot DAG lẫn trace + messages của từng run, không phải
// thứ một màn hình điện thoại cần thấy.
//
// Không có event `task.*` nào được đẩy ra thiết bị từ xa (egress allowlist chỉ có
// event của session), nên trang này làm tươi bằng cách hỏi lại — chủ động khi mở
// và sau mỗi hành động. Đơn giản hơn nhiều so với mở thêm một kênh event mới, và
// một trang giám sát thì poll là đủ.

export const taskList = ref<RemoteTaskSummary[]>([])
export const taskListLoading = ref(false)
export const taskListError = ref<string | null>(null)

export const openTask = ref<RemoteTaskDetail | null>(null)
export const openTaskLoading = ref(false)

export async function loadTasks(): Promise<void> {
  taskListLoading.value = true
  taskListError.value = null
  try {
    const res = await gateway.request<{ tasks: RemoteTaskSummary[] }>('remote.tasks', {})
    taskList.value = res.tasks
  } catch (e) {
    taskListError.value = errMsg(e)
  } finally {
    taskListLoading.value = false
  }
}

export async function loadTask(id: string): Promise<void> {
  openTaskLoading.value = true
  try {
    const res = await gateway.request<{ task: RemoteTaskDetail | null }>('remote.task', { id })
    openTask.value = res.task
  } catch (e) {
    openTask.value = null
    throw new Error(errMsg(e))
  } finally {
    openTaskLoading.value = false
  }
}

export function closeTask(): void {
  openTask.value = null
}

// Một hành động giám sát trên task đang mở. Trả về thông báo để view toast, ném
// lỗi để view hiện nguyên văn lý do gateway từ chối.
export async function taskAction(
  action: 'pause' | 'resume' | 'cancel',
  id: string,
): Promise<string> {
  const method = { pause: 'tasks.pause', resume: 'tasks.resume', cancel: 'tasks.cancel' }[action]
  await gateway.request<unknown>(method, { id })
  await Promise.all([loadTasks(), loadTask(id)])
  return { pause: 'Đã tạm dừng', resume: 'Đã chạy tiếp', cancel: 'Đã huỷ' }[action]
}

export async function approvePhase(taskId: string, nodeId: string): Promise<void> {
  await gateway.request<unknown>('tasks.approvePhase', { taskId, nodeId })
  await Promise.all([loadTasks(), loadTask(taskId)])
}

export interface NewTaskInput {
  projectId: string
  workflowId: string
  title: string
  description: string
}

// Tạo task = khởi động công việc chạy KHÔNG có thẻ duyệt nào (node của task chạy
// mode execute). Gateway từ chối khi công tắc trên desktop đang tắt; chặn sớm ở
// đây chỉ để người dùng đọc được lý do trước khi bấm, không phải để thay cho nó.
export async function createTask(input: NewTaskInput): Promise<void> {
  if (!capabilities.value.unattended) {
    throw new Error('Chạy không cần duyệt đang TẮT trên máy desktop (Settings → Devices).')
  }
  await gateway.request<unknown>('tasks.create', {
    projectId: input.projectId,
    workflowId: input.workflowId,
    title: input.title,
    description: input.description,
  })
  await loadTasks()
}
