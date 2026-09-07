// Bộ điều phối lịch chạy (ADR 0082).
//
// Bộ ĐẾM GIỜ nằm ở Electron main (electron/src/scheduler.ts) — nó tick thưa rồi
// gọi RPC `schedules.tick`. Module này chỉ lo phần "tới hạn thì làm gì": chọn
// lịch quá hạn, chặn chạy chồng, bấm cò, ghi lịch sử, neo lại mốc kế tiếp.
//
// Bấm cò = gọi lại đúng RPC mà UI vẫn dùng (`dispatch(...)` trên registry) chứ
// KHÔNG dựng đường chạy thứ hai:
//   • session-prompt → sessions.upsert (create) + sessions.sendMessage
//   • workflow-task  → tasks.create
// Nhờ vậy lịch thừa hưởng nguyên vẹn phần lắp ráp context, cổng quyền, ghi JSONL
// và luồng event của đường chạy thường — không có nhánh "chạy nền" nào để lệch.

import { randomBytes } from 'node:crypto'
import { dispatch } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { activeSessionIds } from '../sessions/runner.js'
import { listSessionSummaries } from '../sessions/store.js'
import { loadTask } from '../tasks/store.js'
import { CATCH_UP_THRESHOLD_MS, computeNextRun, isDue } from './cron.js'
import { tickWakeup } from './wakeup.js'
import { listSchedules, loadSchedule, saveSchedule } from './store.js'

// Trần chi tiêu MẶC ĐỊNH cho một lượt chạy theo lịch. Lượt này chạy khi không có
// ai ngồi trước máy, và ở mode `execute` thì không có cổng quyền nào bấm phanh —
// nên "không đặt trần" ở đây nghĩa là một vòng lặp hỏng có thể chạy tới khi hết
// tiền. Người dùng đặt trần riêng thì bản của họ thắng; bỏ trống KHÔNG có nghĩa
// là vô hạn. Env chỉnh được, cùng khuôn với budget cấp task (tasks/budget.ts).
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function defaultScheduleBudget(): {
  hardLimitUsd: number
  maxToolCalls: number
  maxWallclockMs: number
} {
  return {
    hardLimitUsd: envNumber('AWOG_SCHEDULE_MAX_USD', 3),
    maxToolCalls: envNumber('AWOG_SCHEDULE_MAX_TOOL_CALLS', 300),
    maxWallclockMs: envNumber('AWOG_SCHEDULE_MAX_WALLCLOCK_MS', 15 * 60_000),
  }
}
import { MAX_RUN_HISTORY, type Schedule, type ScheduleRun } from './schema.js'

// Trạng thái task coi như đã xong — lần chạy sau được phép bấm cò.
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed'])

// Chống hai tick chồng nhau (tick chậm vì I/O còn timer thì vẫn đập).
let tickInFlight = false

// Lịch đang trong khoảng "đã bấm cò, chưa kịp có dấu vết bên thực thi". Cửa sổ
// này ngắn nhưng thật: giữa lúc tạo phiên và lúc lượt chat vào `activeSessionIds`
// không có gì để hỏi, nên tick kế tiếp sẽ bấm cò lần hai nếu thiếu cờ này.
const firing = new Set<string>()

function randomId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`
}

// Id phiên do lịch tạo. Tiền tố `sch-` để phân biệt với phiên người dùng tự mở,
// charset an toàn cho sanitizeChild (id phiên là một đoạn đường dẫn).
function newSessionId(nowMs: number): string {
  const d = new Date(nowMs)
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `sch-${yy}${mm}${dd}-${randomBytes(4).toString('hex')}`
}

function shortMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

// ─── Bấm cò từng loại việc ───────────────────────────────────────────────────

async function runSessionPrompt(schedule: Schedule, run: ScheduleRun, nowMs: number): Promise<void> {
  if (schedule.job.kind !== 'session-prompt') return
  const job = schedule.job
  const sessionId = newSessionId(nowMs)
  const at = new Date(nowMs).toISOString()

  // Trần đi kèm phiên (sessions.upsert nhận `budget` ở cấp params, cạnh `session`),
  // nên gate quyền và vòng lặp tool đọc được nó ngay từ lượt đầu.
  const budget = { ...defaultScheduleBudget(), ...(job.budget ?? {}) }

  await dispatch('sessions.upsert', {
    mode: 'create',
    budget,
    session: {
      id: sessionId,
      title: job.title?.trim() || schedule.name,
      projectId: job.projectId ?? null,
      createdAt: at,
      updatedAt: at,
      invitedAgentIds: [],
      messages: [],
      pendingAgentIds: [],
      settings: job.settings,
    },
  })
  run.sessionId = sessionId
  // Ghi id xuống đĩa NGAY: nếu sidecar chết giữa lượt chạy, dòng lịch sử vẫn chỉ
  // được về phiên nào — nếu đợi tới lúc kết thúc thì lần chạy đó thành mồ côi.
  await patchRun(schedule.id, run)

  // Lượt chat thật, qua đúng RPC của UI. `history: []` — sidecar tự fold JSONL.
  const res = (await dispatch('sessions.sendMessage', {
    sessionId,
    messageId: randomId('m'),
    text: job.prompt,
    history: [],
    settings: job.settings,
    ...(job.projectId ? { projectId: job.projectId } : {}),
  })) as { stopReason?: string | null; errorMessage?: string }

  // Pi báo lỗi giữa dòng bằng một `error` stop chứ không throw — không kiểm chỗ
  // này thì mọi lượt chạy hỏng đều được ghi là "thành công".
  if (res?.stopReason === 'error') {
    throw new Error(res.errorMessage ?? 'the model turn ended with an error')
  }
}

async function runWorkflowTask(schedule: Schedule, run: ScheduleRun): Promise<void> {
  if (schedule.job.kind !== 'workflow-task') return
  const job = schedule.job
  const taskId = randomId('t')

  await dispatch('tasks.create', {
    id: taskId,
    title: job.title,
    projectId: job.projectId,
    source: { type: 'manual' },
    description: job.description,
    workflowId: job.workflowId,
  })
  run.taskId = taskId
  await patchRun(schedule.id, run)
}

// ─── Lịch sử chạy ────────────────────────────────────────────────────────────

// Đọc lại từ đĩa trước mỗi lần ghi: một lượt chạy kéo dài vài phút, người dùng
// có thể đã sửa lịch trong lúc đó — ghi đè bằng bản chụp cũ là mất chỉnh sửa.
async function withFreshSchedule(id: string, mutate: (s: Schedule) => void): Promise<void> {
  const fresh = await loadSchedule(id)
  if (!fresh) return
  mutate(fresh)
  await saveSchedule(fresh)
  emit('schedules.changed', { id })
}

// Ghi đè một dòng lịch sử đang mở bằng bản trong bộ nhớ (khớp theo `run.id`).
async function patchRun(scheduleId: string, run: ScheduleRun): Promise<void> {
  await withFreshSchedule(scheduleId, (s) => {
    const idx = s.runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) s.runs[idx] = { ...run }
  })
}

// Mở một dòng lịch sử ở trạng thái `running` và ghi ngay, để UI thấy lượt chạy
// từ lúc nó bắt đầu chứ không phải lúc nó kết thúc.
async function beginRun(
  scheduleId: string,
  trigger: 'timer' | 'manual',
  nowMs: number,
  catchUp: boolean,
): Promise<ScheduleRun> {
  const run: ScheduleRun = {
    id: randomId('run'),
    startedAt: new Date(nowMs).toISOString(),
    status: 'running',
    trigger,
    ...(catchUp ? { catchUp: true } : {}),
  }
  await withFreshSchedule(scheduleId, (s) => {
    s.runs = [run, ...s.runs].slice(0, MAX_RUN_HISTORY)
    s.lastRunAt = run.startedAt
    s.lastStatus = run.status
  })
  return run
}

// Đóng dòng lịch sử đã mở (khớp theo `runId` — bản trên đĩa mới là bản thật).
async function finishRun(scheduleId: string, run: ScheduleRun): Promise<void> {
  const finished: ScheduleRun = { ...run, finishedAt: new Date().toISOString() }
  await withFreshSchedule(scheduleId, (s) => {
    const idx = s.runs.findIndex((r) => r.id === run.id)
    if (idx >= 0) s.runs[idx] = finished
    else s.runs = [finished, ...s.runs].slice(0, MAX_RUN_HISTORY)
    s.lastRunAt = finished.startedAt
    s.lastStatus = finished.status
  })
}

// Ghi một lượt bị bỏ qua (lần trước chưa xong). Một dòng cho một nhịp đã lỡ —
// mốc kế tiếp đã được neo lại trước đó nên không có chuyện ghi mỗi 30 giây.
async function recordSkipped(
  scheduleId: string,
  trigger: 'timer' | 'manual',
  reason: string,
): Promise<ScheduleRun> {
  const at = new Date().toISOString()
  const run: ScheduleRun = {
    id: randomId('run'),
    startedAt: at,
    finishedAt: at,
    status: 'skipped',
    trigger,
    message: reason,
  }
  await withFreshSchedule(scheduleId, (s) => {
    s.runs = [run, ...s.runs].slice(0, MAX_RUN_HISTORY)
    s.lastRunAt = run.startedAt
    s.lastStatus = run.status
  })
  return run
}

// ─── Dọn dấu vết của lần chạy bị cắt ngang ───────────────────────────────────

// Sidecar chết giữa lượt chạy thì dòng lịch sử nằm lại ở `running` mãi mãi — UI
// báo "đang chạy" cho một thứ không còn chạy, và `lastStatus` kẹt luôn ở đó.
// Không cần timeout để nhận ra: một dòng `running` mà tiến trình NÀY không cầm
// (`firing`) và bên thực thi cũng không biết tới thì chắc chắn đã bị cắt ngang.
async function reconcileInterrupted(schedule: Schedule): Promise<void> {
  const run = schedule.runs[0]
  if (!run || run.status !== 'running') return
  if (firing.has(schedule.id)) return
  if (run.taskId) {
    const task = await loadTask(run.taskId)
    if (task && !TERMINAL_TASK_STATUSES.has(task.status)) return
  } else if (run.sessionId && activeSessionIds().includes(run.sessionId)) {
    return
  }
  log.info('schedules: marking interrupted run', { id: schedule.id, run: run.id })
  const patched: ScheduleRun = {
    ...run,
    status: 'error',
    finishedAt: new Date().toISOString(),
    message: 'interrupted — the app or engine stopped mid-run',
  }
  await patchRun(schedule.id, patched)
  await withFreshSchedule(schedule.id, (s) => {
    s.lastStatus = patched.status
  })
  schedule.runs[0] = patched
  schedule.lastStatus = patched.status
}

// ─── Chặn chạy chồng ─────────────────────────────────────────────────────────

// Lần chạy trước còn đang chạy? Hỏi thẳng bên thực thi (task store / session
// runner) chứ không tin một cờ trong bộ nhớ, nên vẫn đúng sau khi sidecar khởi
// động lại giữa chừng. Trả lý do (để log + hiện lên UI) hoặc null.
async function busyReason(schedule: Schedule): Promise<string | null> {
  if (firing.has(schedule.id)) return 'previous run is still starting'
  const last = schedule.runs.find((r) => r.taskId || r.sessionId)
  if (!last) return null
  if (last.taskId) {
    const task = await loadTask(last.taskId)
    if (task && !TERMINAL_TASK_STATUSES.has(task.status)) {
      return `task ${last.taskId} is still ${task.status}`
    }
    return null
  }
  if (last.sessionId && activeSessionIds().includes(last.sessionId)) {
    return `session ${last.sessionId} still has a turn running`
  }
  return null
}

// ─── Chạy một lịch ───────────────────────────────────────────────────────────

// Bấm cò rồi TRẢ VỀ NGAY dòng lịch sử `running`; phần việc thật chạy tách rời
// (một lượt chat có thể mất vài phút — không được giữ tick hay RPC lại chờ).
// UI cập nhật qua event `schedules.changed`.
async function fire(
  schedule: Schedule,
  trigger: 'timer' | 'manual',
  nowMs: number,
  catchUp: boolean,
): Promise<ScheduleRun> {
  // Đặt cờ TRƯỚC lần await đầu tiên: `beginRun` có await, và một `runNow` gọi
  // xen vào đúng khoảng đó sẽ lọt qua `busyReason` nếu cờ đặt sau.
  firing.add(schedule.id)
  let run: ScheduleRun
  try {
    run = await beginRun(schedule.id, trigger, nowMs, catchUp)
  } catch (err) {
    firing.delete(schedule.id)
    throw err
  }
  const work =
    schedule.job.kind === 'session-prompt'
      ? runSessionPrompt(schedule, run, nowMs)
      : runWorkflowTask(schedule, run)

  void work
    .then(
      () => {
        run.status = 'ok'
      },
      (err: unknown) => {
        run.status = 'error'
        run.message = shortMessage(err)
        log.warn('schedules: run failed', { id: schedule.id, err: run.message })
      },
    )
    .then(() => finishRun(schedule.id, run))
    .catch((err: unknown) => {
      log.error('schedules: failed to persist run result', {
        id: schedule.id,
        err: shortMessage(err),
      })
    })
    .finally(() => firing.delete(schedule.id))

  return run
}

// "Chạy ngay" từ UI. KHÔNG đụng `nextRunAt`: chạy tay là việc phát sinh, nhịp
// định kỳ phải giữ nguyên.
export async function runScheduleNow(id: string): Promise<ScheduleRun> {
  const schedule = await loadSchedule(id)
  if (!schedule) throw new Error(`Schedule not found: ${id}`)
  // Lời hẹn của agent (gói #14) không phải thứ "chạy" được: nó chỉ đặt một lời
  // nhắc vào hộp thư đúng một lần, đúng giờ của nó. Chặn ở đây thay vì để `fire`
  // mở một dòng lịch sử rồi không làm gì.
  if (schedule.job.kind === 'session-wakeup') {
    throw new Error(`Schedule ${id} is an agent wake-up; it cannot be run on demand.`)
  }
  const busy = await busyReason(schedule)
  if (busy) {
    log.info('schedules: manual run skipped (overlap)', { id, reason: busy })
    return recordSkipped(id, 'manual', busy)
  }
  return fire(schedule, 'manual', Date.now(), false)
}

// ─── Tick ────────────────────────────────────────────────────────────────────

export type TickResult = { checked: number; fired: string[]; skipped: string[] }

// Một nhịp quét. Với mỗi lịch đang bật và đã quá hạn:
//   1. neo lại `nextRunAt` từ BÂY GIỜ (lỡ N nhịp vẫn chỉ chạy đúng một lần),
//   2. lần trước chưa xong → ghi một dòng `skipped` rồi thôi,
//   3. còn lại → bấm cò.
// Bước 1 chạy TRƯỚC và ghi xuống đĩa ngay: nếu để mốc cũ nằm đó thì tick sau
// (30 giây nữa) lại thấy quá hạn và bấm cò thêm lần nữa.
export async function tickSchedules(): Promise<TickResult> {
  if (tickInFlight) return { checked: 0, fired: [], skipped: [] }
  tickInFlight = true
  const result: TickResult = { checked: 0, fired: [], skipped: [] }
  // Phiên còn sống (chưa xoá, chưa lưu trữ) — nạp NHIỀU NHẤT một lần cho cả tick,
  // và chỉ khi thật sự có lời hẹn cần kiểm.
  let liveSessions: Set<string> | null = null
  const liveSessionIds = async (): Promise<Set<string>> => {
    if (!liveSessions) {
      const summaries = await listSessionSummaries()
      liveSessions = new Set(summaries.filter((s) => !s.archived).map((s) => s.id))
    }
    return liveSessions
  }
  try {
    const schedules = await listSchedules()
    result.checked = schedules.length
    for (const schedule of schedules) {
      // Lời hẹn agent tự đặt (gói #14) đi đường riêng: không lịch sử chạy, không
      // chặn chạy chồng, không trần chi tiêu — vì nó KHÔNG chạy lượt LLM nào. Tới
      // giờ thì đặt một lời nhắc vào hộp thư của phiên rồi tự xoá mình.
      if (schedule.job.kind === 'session-wakeup') {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await tickWakeup(schedule, Date.now(), await liveSessionIds())
        if (outcome === 'delivered') result.fired.push(schedule.id)
        else if (outcome !== 'pending') result.skipped.push(schedule.id)
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await reconcileInterrupted(schedule)
      if (!schedule.enabled) continue
      const nowMs = Date.now()
      const parsed = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : NaN
      const dueAtMs = Number.isNaN(parsed) ? null : parsed
      if (!isDue(dueAtMs, nowMs)) continue

      const catchUp = dueAtMs !== null && nowMs - dueAtMs > CATCH_UP_THRESHOLD_MS
      const next = computeNextRun(schedule.trigger, nowMs)
      // Vá ĐÚNG hai trường trên bản mới nhất của đĩa, không ghi đè bằng bản chụp
      // lấy ở đầu tick: một lượt chạy trước đó có thể vừa kết thúc và ghi kết quả
      // vào giữa hai thời điểm ấy — ghi đè là nuốt mất kết quả đó.
      // eslint-disable-next-line no-await-in-loop
      await withFreshSchedule(schedule.id, (s) => {
        s.nextRunAt = next === null ? null : new Date(next).toISOString()
        s.updatedAt = new Date(nowMs).toISOString()
      })

      // eslint-disable-next-line no-await-in-loop
      const current = (await loadSchedule(schedule.id)) ?? schedule
      // eslint-disable-next-line no-await-in-loop
      const busy = await busyReason(current)
      if (busy) {
        log.info('schedules: run skipped (overlap)', { id: schedule.id, reason: busy })
        result.skipped.push(schedule.id)
        // eslint-disable-next-line no-await-in-loop
        await recordSkipped(schedule.id, 'timer', busy)
        continue
      }

      log.info('schedules: firing', { id: current.id, kind: current.job.kind, catchUp })
      result.fired.push(current.id)
      // eslint-disable-next-line no-await-in-loop
      await fire(current, 'timer', nowMs, catchUp)
    }
  } finally {
    tickInFlight = false
  }
  return result
}
