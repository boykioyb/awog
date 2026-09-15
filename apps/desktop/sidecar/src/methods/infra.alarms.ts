// `infra.alarm-*` — dải cảnh báo của màn Giám sát (Mốc 6, 6.3) và việc đặt cảnh
// báo ngay từ biểu đồ (6.4).
//
// BỐN METHOD, HAI LOẠI:
//   · `infra.alarm-list` / `infra.alarm-history` — ĐỌC, một cú bấm một lượt.
//   · `infra.alarm-put` — GHI. Không tự gọi `runGated()` ở đây: cổng quyền nằm
//     trong `infra/aws/alarms.ts:putAlarm()`, cùng chỗ với việc dựng argv. File
//     RPC chỉ validate ở biên rồi chuyển tiếp — đúng khuôn `infra.cicd-action.ts`
//     → `cicdAction()` → `runGated()`.
//
// Vé duyệt là trường CHUNG của `alarm-put`: UI gọi lần đầu, nhận `blocked` +
// `approvalTicket`, hỏi người dùng, rồi gọi lại ĐÚNG payload cũ kèm vé. Renderer
// không bao giờ tự khai "người dùng đã duyệt" (infosec audit #1).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import {
  ALARM_STATES,
  MAX_ALARM_LIMIT,
  MAX_HISTORY_LIMIT,
  alarmHistory,
  listAlarms,
  putAlarm,
} from '../infra/aws/alarms.js'

const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
  })
  .default({})

const Surface = z.enum(INFRA_SURFACES).default('explorer')
const Ticket = z.string().max(100).optional()

// ── Đọc: danh sách cảnh báo ─────────────────────────────────────────────────
const ListParams = z.object({
  context: Context,
  stateFilter: z.enum(ALARM_STATES).optional(),
  namePrefix: z.string().max(255).optional(),
  limit: z.number().int().positive().max(MAX_ALARM_LIMIT).optional(),
  surface: Surface,
})

register('infra.alarm-list', async (raw) => {
  const p = ListParams.parse(raw)
  const result = await listAlarms({
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    ...(p.context.region !== undefined ? { region: p.context.region } : {}),
    ...(p.stateFilter !== undefined ? { stateFilter: p.stateFilter } : {}),
    ...(p.namePrefix !== undefined ? { namePrefix: p.namePrefix } : {}),
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    surface: p.surface,
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return {
    ok: true as const,
    alarms: result.value.alarms,
    truncated: result.value.truncated,
  }
})

// ── Đọc: lịch sử một cảnh báo ───────────────────────────────────────────────
const HistoryParams = z.object({
  context: Context,
  alarmName: z.string().min(1).max(255),
  historyItemType: z.enum(['StateUpdate', 'Action', 'ConfigurationUpdate']).optional(),
  limit: z.number().int().positive().max(MAX_HISTORY_LIMIT).optional(),
  surface: Surface,
})

register('infra.alarm-history', async (raw) => {
  const p = HistoryParams.parse(raw)
  const result = await alarmHistory({
    alarmName: p.alarmName,
    ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
    ...(p.context.region !== undefined ? { region: p.context.region } : {}),
    ...(p.historyItemType !== undefined ? { historyItemType: p.historyItemType } : {}),
    ...(p.limit !== undefined ? { limit: p.limit } : {}),
    surface: p.surface,
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return {
    ok: true as const,
    entries: result.value.entries,
    truncated: result.value.truncated,
  }
})

// ── Ghi: đặt cảnh báo (đi qua cổng quyền) ───────────────────────────────────
const Dimension = z.object({
  name: z.string().min(1).max(255),
  value: z.string().min(1).max(1024),
})

const PutParams = z.object({
  context: Context,
  name: z.string().min(1).max(255),
  namespace: z.string().min(1).max(255),
  metricName: z.string().min(1).max(255),
  dimensions: z.array(Dimension).max(30).optional(),
  stat: z.string().min(1).max(16),
  periodSeconds: z.number().int().positive().max(86_400),
  evaluationPeriods: z.number().int().positive().max(100),
  threshold: z.number().finite(),
  comparisonOperator: z.enum([
    'GreaterThanThreshold',
    'GreaterThanOrEqualToThreshold',
    'LessThanThreshold',
    'LessThanOrEqualToThreshold',
  ]),
  treatMissingData: z.enum(['breaching', 'notBreaching', 'ignore', 'missing']),
  alarmDescription: z.string().max(1024).optional(),
  alarmActions: z.array(z.string().max(1024)).max(5).optional(),
  surface: Surface,
  approvalTicket: Ticket,
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
})

register('infra.alarm-put', async (raw) => {
  const p = PutParams.parse(raw)
  return putAlarm({
    name: p.name,
    namespace: p.namespace,
    metricName: p.metricName,
    stat: p.stat,
    periodSeconds: p.periodSeconds,
    evaluationPeriods: p.evaluationPeriods,
    threshold: p.threshold,
    comparisonOperator: p.comparisonOperator,
    treatMissingData: p.treatMissingData,
    context: {
      ...(p.context.profile !== undefined ? { profile: p.context.profile } : {}),
      ...(p.context.region !== undefined ? { region: p.context.region } : {}),
      ...(p.context.accountId !== undefined ? { accountId: p.context.accountId } : {}),
    },
    surface: p.surface,
    ...(p.dimensions !== undefined ? { dimensions: p.dimensions } : {}),
    ...(p.alarmDescription !== undefined ? { alarmDescription: p.alarmDescription } : {}),
    ...(p.alarmActions !== undefined ? { alarmActions: p.alarmActions } : {}),
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
})
