import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { loadWorkflowByIdAnyTier } from '../workflows/store.js'
import { firstRunAfter } from '../schedules/cron.js'
import { loadSchedule, saveSchedule } from '../schedules/store.js'
import {
  ScheduleJobSchema,
  ScheduleTriggerSchema,
  SCHEDULE_ID_RE,
  type Schedule,
} from '../schedules/schema.js'

// Payload từ UI là L1: chỉ nhận đúng các trường người dùng đặt được. `nextRunAt`,
// `lastRunAt`, `lastStatus`, `runs` KHÔNG nằm trong param — chúng do sidecar tính
// và giữ, nên một payload thù địch không thể bịa lịch sử chạy hay đẩy mốc chạy
// (mass-assignment: chọn trường tường minh, không spread nguyên payload).
const Params = z.object({
  id: z.string().regex(SCHEDULE_ID_RE),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  trigger: ScheduleTriggerSchema,
  job: ScheduleJobSchema,
})

register('schedules.upsert', async (raw) => {
  const params = Params.parse(raw)

  // Hai biến thể của gói #14 KHÔNG mở cho UI. `session-wakeup` là lời hẹn agent tự
  // đặt qua tool `schedule_wakeup` — nó tự dọn theo diễn biến của phiên, nên một
  // bản do người dùng tạo tay sẽ không có gì bảo đảm. `once` chỉ tồn tại để chở
  // lời hẹn đó; để nó lọt vào danh sách UI thì trang Lịch chạy phải diễn đạt một
  // dạng biểu thức nó không biết. Chặn cả hai ngay tại biên.
  if (params.job.kind === 'session-wakeup') {
    throw new RpcError(-32602, 'Agent wake-ups are created by the agent, not from the UI')
  }
  if (params.trigger.kind === 'once') {
    throw new RpcError(-32602, 'One-shot schedules are reserved for agent wake-ups')
  }

  // Fail fast ở biên: lịch chỉ mang ID, sidecar tự resolve ra đường dẫn khi chạy.
  // Kiểm ngay lúc lưu để người dùng biết liền, thay vì im lặng tới 3 giờ sáng.
  const { projectId } = params.job
  if (projectId) {
    const project = await loadProject(projectId)
    if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  }
  if (params.job.kind === 'workflow-task') {
    const workflow = await loadWorkflowByIdAnyTier(params.job.workflowId, [params.job.projectId])
    if (!workflow) throw new RpcError(-32602, `Workflow not found: ${params.job.workflowId}`)
  }

  const now = new Date()
  const existing = await loadSchedule(params.id)

  // Mốc kế tiếp tính lại khi biểu thức lịch đổi (hoặc khi lịch vừa được bật lại):
  // giữ mốc cũ của một biểu thức đã thay là để lại một cái hẹn không ai đặt.
  const triggerChanged =
    !existing || JSON.stringify(existing.trigger) !== JSON.stringify(params.trigger)
  const reuseNext = existing && !triggerChanged && existing.enabled === params.enabled
  const nextMs = firstRunAfter(params.trigger, now.getTime())

  const schedule: Schedule = {
    id: params.id,
    name: params.name,
    enabled: params.enabled,
    trigger: params.trigger,
    job: params.job,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    nextRunAt: reuseNext
      ? existing.nextRunAt
      : nextMs === null
        ? null
        : new Date(nextMs).toISOString(),
    runs: existing?.runs ?? [],
  }
  if (existing?.lastRunAt !== undefined) schedule.lastRunAt = existing.lastRunAt
  if (existing?.lastStatus !== undefined) schedule.lastStatus = existing.lastStatus

  await saveSchedule(schedule)
  return { schedule }
})
