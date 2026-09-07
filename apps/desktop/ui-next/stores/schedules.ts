import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Schedules store — lịch chạy agent theo giờ (ADR 0082).
//
// Bộ đếm giờ nằm ở Electron main, việc bấm cò nằm ở sidecar; store này chỉ là
// CRUD + "chạy ngay" + nghe event `schedules.changed` để danh sách luôn tươi.
// Không có mock cho browser-dev: không có bridge thì không có lịch nào cả (khác
// với git store — ở đây một danh sách giả sẽ nói dối về việc có thứ đang chạy).

export type ScheduleTrigger =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; weekdays: number[]; time: string }

export type ScheduleSessionSettings = {
  provider: 'anthropic' | 'openai' | 'google'
  modelId: string
  level: 'low' | 'medium' | 'high' | 'extra-high' | 'max'
  mode: 'ask' | 'accept-edits' | 'plan' | 'execute'
  accountId?: string
}

export type ScheduleJob =
  | {
      kind: 'session-prompt'
      prompt: string
      title?: string
      projectId?: string
      settings: ScheduleSessionSettings
    }
  | {
      kind: 'workflow-task'
      workflowId: string
      projectId: string
      title: string
      description: string
    }

export type ScheduleRunStatus = 'running' | 'ok' | 'error' | 'skipped'

export type ScheduleRun = {
  id: string
  startedAt: string
  finishedAt?: string
  status: ScheduleRunStatus
  trigger: 'timer' | 'manual'
  catchUp?: boolean
  taskId?: string
  sessionId?: string
  message?: string
}

export type Schedule = {
  id: string
  name: string
  enabled: boolean
  trigger: ScheduleTrigger
  job: ScheduleJob
  createdAt: string
  updatedAt: string
  nextRunAt: string | null
  lastRunAt?: string
  lastStatus?: ScheduleRunStatus
  runs: ScheduleRun[]
}

// Đúng những trường người dùng đặt được. `nextRunAt` / `runs` / `lastStatus` do
// sidecar tính và giữ — UI không gửi lên, để không tự bịa được lịch sử chạy.
export type ScheduleInput = Pick<Schedule, 'id' | 'name' | 'enabled' | 'trigger' | 'job'>

type ListResponse = { schedules: Schedule[] }
type UpsertResponse = { schedule: Schedule }
type RunNowResponse = { run: ScheduleRun }

export const useSchedulesStore = defineStore('schedules', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const schedules = ref<Schedule[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  const scheduleById = (id: string): Schedule | undefined =>
    schedules.value.find((s) => s.id === id)

  async function loadSchedules(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<ListResponse>('schedules.list', {})
      schedules.value = Array.isArray(res.schedules) ? res.schedules : []
    } catch (err) {
      console.warn('[schedules] loadSchedules failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Tạo hoặc sửa. Sidecar trả về bản đã tính `nextRunAt` — nhận nguyên bản đó
  // thay vì đoán ở client, để hai bên không bao giờ lệch mốc.
  async function saveSchedule(input: ScheduleInput): Promise<Schedule | null> {
    if (!available.value) return null
    const res = await sc.request<UpsertResponse>('schedules.upsert', input)
    const saved = res.schedule
    const idx = schedules.value.findIndex((s) => s.id === saved.id)
    if (idx >= 0) schedules.value[idx] = saved
    else schedules.value.push(saved)
    schedules.value.sort((a, b) => a.name.localeCompare(b.name))
    return saved
  }

  async function removeSchedule(id: string): Promise<void> {
    schedules.value = schedules.value.filter((s) => s.id !== id)
    if (!available.value) return
    try {
      await sc.request('schedules.delete', { id })
    } catch (err) {
      console.warn('[schedules] removeSchedule failed', err)
    }
  }

  // Bật/tắt nhanh từ danh sách. Đi qua upsert nên `nextRunAt` được tính lại ở
  // sidecar khi bật lại (bật lại một lịch với mốc cũ đã trôi qua = chạy ngay).
  async function toggleSchedule(id: string): Promise<void> {
    const s = scheduleById(id)
    if (!s) return
    await saveSchedule({
      id: s.id,
      name: s.name,
      enabled: !s.enabled,
      trigger: s.trigger,
      job: s.job,
    })
  }

  // "Chạy ngay". Trả về dòng lịch sử vừa mở (`running`), hoặc `skipped` khi lần
  // chạy trước còn đang chạy.
  async function runNow(id: string): Promise<ScheduleRun | null> {
    if (!available.value) return null
    const res = await sc.request<RunNowResponse>('schedules.runNow', { id })
    return res.run
  }

  // Mở phiên do lịch tạo. Phải là CỬA SỔ RIÊNG: cửa sổ chính chỉ nạp danh sách
  // phiên đúng một lần lúc khởi động, nên phiên vừa sinh ra sau đó không có
  // trong danh sách của nó; cửa sổ popout là renderer mới nên tự nạp lại và
  // thấy phiên ngay.
  async function openRunSession(engineId: string, title: string): Promise<void> {
    if (!available.value) return
    await sc.openSessionWindow(engineId, title)
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'schedules.changed') return
        void loadSchedules()
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    schedules,
    loaded,
    available,
    // getters
    scheduleById,
    // actions
    loadSchedules,
    saveSchedule,
    removeSchedule,
    toggleSchedule,
    runNow,
    openRunSession,
  }
})
