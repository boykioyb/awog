// Ngân sách cho MỘT lần chạy task (ADR 0081, phần B).
//
// Session đã có SessionBudget được enforce thật, còn task thì chạy không cap gì —
// trong khi chính comment ở types/shared.ts tự nhận là "closes the budget per task
// invariant". Module này đóng khoảng cách đó ở cấp TASK (tổng mọi node), không
// phải per-turn: một DAG 8 node vẫn có thể đốt tiền dù từng node đều "bình thường".
//
// Ba chiều đo, chiều nào chạm trần trước thì dừng:
//   • cost      — USD cộng dồn từ event `run.usage` (event-sourced ⇒ sống sót
//                 restart; tính cả run đã superseded vì tiền đã tiêu là đã tiêu).
//   • toolCalls — tổng số tool call của mọi node, đếm trong bộ nhớ.
//   • wallclock — thời gian task chạy liên tục kể từ start/resume, trong bộ nhớ.
//
// toolCalls + wallclock reset khi sidecar khởi động lại (chúng đo "đợt chạy này",
// và persist mỗi tool call sẽ làm phình events.log). cost thì không reset.
//
// Vượt trần KHÔNG kill cụt: engine dừng phát node mới, node đang chạy bị abort thì
// phase quay về `pending` (đúng đường resume-sau-crash đã có), task treo ở `paused`
// và một event `task.budget` được ghi vào events.log.

import { costUsd, loadPricingTables } from '../pricing/effective.js'
import type { Task } from '../types/shared.js'

export type BudgetDimension = 'cost' | 'toolCalls' | 'wallclock'

export interface BudgetBreach {
  dimension: BudgetDimension
  limit: number
  observed: number
  // Câu giải thích ngắn, an toàn để đẩy lên UI + ghi vào events.log.
  message: string
}

export interface TaskBudget {
  maxCostUsd: number
  maxToolCalls: number
  maxWallclockMs: number
}

// Mặc định: đủ rộng cho một DAG thật (vài node, mỗi node vài chục tool call),
// đủ chặt để một vòng lặp hỏng không đốt hết hạn mức trong đêm. Chỉnh bằng biến
// môi trường của sidecar (xem docs/features/task-node-isolation.md); 0 hoặc số âm
// = tắt chiều đó.
export const DEFAULT_TASK_BUDGET: TaskBudget = {
  maxCostUsd: 20,
  maxToolCalls: 1500,
  maxWallclockMs: 4 * 60 * 60 * 1000,
}

const ENV_KEYS = {
  maxCostUsd: 'AWOG_TASK_MAX_USD',
  maxToolCalls: 'AWOG_TASK_MAX_TOOL_CALLS',
  maxWallclockMs: 'AWOG_TASK_MAX_WALLCLOCK_MS',
} as const

function envNumber(key: string): number | null {
  const raw = process.env[key]
  if (raw === undefined || raw.trim().length === 0) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

let cached: TaskBudget | null = null

// Trần hiệu lực = mặc định, ghi đè bởi env (env là L4 — tin được).
export function taskBudget(): TaskBudget {
  if (cached) return cached
  cached = {
    maxCostUsd: envNumber(ENV_KEYS.maxCostUsd) ?? DEFAULT_TASK_BUDGET.maxCostUsd,
    maxToolCalls: envNumber(ENV_KEYS.maxToolCalls) ?? DEFAULT_TASK_BUDGET.maxToolCalls,
    maxWallclockMs: envNumber(ENV_KEYS.maxWallclockMs) ?? DEFAULT_TASK_BUDGET.maxWallclockMs,
  }
  return cached
}

interface TaskMeter {
  startedAtMs: number
  toolCalls: number
  breach: BudgetBreach | null
  // Đã ghi event `task.budget` cho lần chạm trần này chưa. Hai nơi phát hiện
  // breach (scheduler trước khi phát node, và node-runner giữa lượt) nên cần cờ
  // để events.log không có hai dòng cho cùng một lần dừng.
  reported: boolean
}

const meters = new Map<string, TaskMeter>()

function meter(taskId: string): TaskMeter {
  let m = meters.get(taskId)
  if (!m) {
    m = { startedAtMs: Date.now(), toolCalls: 0, breach: null, reported: false }
    meters.set(taskId, m)
  }
  return m
}

// Mở/đặt lại cửa sổ đo cho một task (start + resume). Resume sau khi người dùng
// nới trần phải cho task chạy tiếp, nên đồng hồ + bộ đếm tool call về 0 và cờ
// breach được xoá. Chi phí USD thì không — nó derive từ events.log.
export function startBudgetWindow(taskId: string): void {
  meters.set(taskId, { startedAtMs: Date.now(), toolCalls: 0, breach: null, reported: false })
}

export function clearBudgetWindow(taskId: string): void {
  meters.delete(taskId)
}

export function budgetBreach(taskId: string): BudgetBreach | null {
  return meters.get(taskId)?.breach ?? null
}

// true đúng MỘT lần cho mỗi lần chạm trần — người gọi ghi event rồi thôi.
export function claimBudgetReport(taskId: string): boolean {
  const m = meters.get(taskId)
  if (!m || m.reported) return false
  m.reported = true
  return true
}

function remember(taskId: string, breach: BudgetBreach): BudgetBreach {
  meter(taskId).breach = breach
  return breach
}

// Đếm một tool call của node bất kỳ thuộc task. Trả về breach khi vượt trần —
// node-runner abort lượt đang chạy ngay tại chỗ.
export function recordToolCall(taskId: string): BudgetBreach | null {
  const m = meter(taskId)
  m.toolCalls += 1
  if (m.breach) return m.breach
  const { maxToolCalls, maxWallclockMs } = taskBudget()
  if (maxToolCalls > 0 && m.toolCalls > maxToolCalls) {
    return remember(taskId, {
      dimension: 'toolCalls',
      limit: maxToolCalls,
      observed: m.toolCalls,
      message: `Task tool-call budget exceeded (${m.toolCalls} > ${maxToolCalls}). Stopped to prevent a runaway loop.`,
    })
  }
  const elapsed = Date.now() - m.startedAtMs
  if (maxWallclockMs > 0 && elapsed > maxWallclockMs) {
    return remember(taskId, {
      dimension: 'wallclock',
      limit: maxWallclockMs,
      observed: elapsed,
      message: `Task time budget exceeded (${Math.round(elapsed / 1000)}s > ${Math.round(maxWallclockMs / 1000)}s). Stopped.`,
    })
  }
  return null
}

// Tổng USD đã tiêu của task, cộng từ usage đã persist của MỌI run (kể cả
// superseded). Model không có trong bảng giá ⇒ đóng góp 0 — lúc đó hai chiều
// toolCalls/wallclock là lưới an toàn.
export async function taskSpentUsd(task: Task): Promise<number> {
  const tables = await loadPricingTables()
  let total = 0
  for (const phase of Object.values(task.phases)) {
    for (const run of phase.runs) {
      const u = run.usage
      if (!u) continue
      total += costUsd(tables, u.model, {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
      })
    }
  }
  return total
}

// Kiểm tra trần trước khi phát node mới. Trả về breach (và ghi nhớ nó) hoặc null.
export async function checkTaskBudget(task: Task): Promise<BudgetBreach | null> {
  const m = meter(task.id)
  if (m.breach) return m.breach
  const { maxCostUsd, maxToolCalls, maxWallclockMs } = taskBudget()

  const elapsed = Date.now() - m.startedAtMs
  if (maxWallclockMs > 0 && elapsed > maxWallclockMs) {
    return remember(task.id, {
      dimension: 'wallclock',
      limit: maxWallclockMs,
      observed: elapsed,
      message: `Task time budget exceeded (${Math.round(elapsed / 1000)}s > ${Math.round(maxWallclockMs / 1000)}s). Stopped.`,
    })
  }
  if (maxToolCalls > 0 && m.toolCalls > maxToolCalls) {
    return remember(task.id, {
      dimension: 'toolCalls',
      limit: maxToolCalls,
      observed: m.toolCalls,
      message: `Task tool-call budget exceeded (${m.toolCalls} > ${maxToolCalls}). Stopped to prevent a runaway loop.`,
    })
  }
  if (maxCostUsd > 0) {
    const spent = await taskSpentUsd(task)
    if (spent >= maxCostUsd) {
      return remember(task.id, {
        dimension: 'cost',
        limit: maxCostUsd,
        observed: spent,
        message: `Task budget exceeded: $${spent.toFixed(2)} ≥ $${maxCostUsd.toFixed(2)} cap. Raise ${ENV_KEYS.maxCostUsd} and resume to continue.`,
      })
    }
  }
  return null
}
