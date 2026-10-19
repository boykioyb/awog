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
  | {
      // Chạy một chương trình không qua model (ADR 0108). Duyệt nằm ở sổ duyệt của
      // sidecar, không ở file lịch — xem `Schedule.approved`.
      kind: 'command'
      program: string
      args: string[]
      timeoutMinutes?: number
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
  // Job `command`: có log đầy đủ của lượt này (RPC `schedules.runLog`).
  hasLog?: boolean
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
  // Chỉ job `command`: sidecar vừa kiểm lệnh + nội dung file với sổ duyệt. false ⇒ lệnh
  // mới, hoặc nó / file nó chạy đã đổi từ lần duyệt — lượt chạy sẽ bị từ chối.
  approved?: boolean
  // Lịch do agent đề xuất (tool `propose_schedule`): tắt, chưa chạy được tới khi người
  // dùng mở ra Sửa → Lưu (upsert dựng lại lịch nên trường này mất).
  proposedBy?: { sessionId: string; at: string }
}

// Đúng những trường người dùng đặt được. `nextRunAt` / `runs` / `lastStatus` do
// sidecar tính và giữ — UI không gửi lên, để không tự bịa được lịch sử chạy.
// `approve` chỉ cho job `command`, và chỉ gửi SAU khi người dùng xác nhận program + từng
// arg trong hộp thoại (ScheduleEditor) — đó là bước duyệt lệnh duy nhất.
export type ScheduleInput = Pick<Schedule, 'id' | 'name' | 'enabled' | 'trigger' | 'job'> & {
  approve?: boolean
}

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

  // Bật/tắt nhanh từ danh sách. RPC riêng chỉ đổi cờ — KHÔNG gửi lại `job` đọc từ đĩa
  // qua upsert: với job `command` đó là đường "lưu" một lệnh lạ mà không ai đọc nó
  // (ADR 0108). Sidecar tính lại `nextRunAt` khi bật lại.
  async function toggleSchedule(id: string): Promise<void> {
    const s = scheduleById(id)
    if (!s || !available.value) return
    const res = await sc.request<UpsertResponse>('schedules.setEnabled', {
      id,
      enabled: !s.enabled,
    })
    const idx = schedules.value.findIndex((x) => x.id === id)
    if (idx >= 0) schedules.value[idx] = { ...res.schedule, approved: s.approved }
  }

  // "Chạy ngay". Trả về dòng lịch sử vừa mở (`running`), hoặc `skipped` khi lần
  // chạy trước còn đang chạy.
  async function runNow(id: string): Promise<ScheduleRun | null> {
    if (!available.value) return null
    const res = await sc.request<RunNowResponse>('schedules.runNow', { id })
    return res.run
  }

  // Log đầy đủ (đã che secret) của một lượt chạy job `command`.
  async function fetchRunLog(id: string, runId: string): Promise<string> {
    const res = await sc.request<{ text: string }>('schedules.runLog', { id, runId })
    return res.text
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
    fetchRunLog,
  }
})
