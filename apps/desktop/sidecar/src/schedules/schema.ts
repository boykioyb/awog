// Zod schema cho Scheduled Runs (ADR 0082) — lịch chạy agent theo thời gian.
//
// Một lịch = một file `~/.awog/schedules/<id>.json` (AWOG-only data ⇒ `.awog`,
// ADR 0070). File trên đĩa là input L1: mọi lần đọc phải đi qua schema này.
//
// Lịch KHÔNG bao giờ mang đường dẫn tuỳ ý. `projectId` là một id trong project
// store — sidecar tự resolve ra đường dẫn khi chạy — nên một file lịch bị sửa
// tay (hoặc do model ghi) không thể trỏ runtime vào thư mục bất kỳ.
//
// Type được suy thẳng từ z.infer: module này tự chứa, schema là single source of
// truth (không dựng thêm một bản mirror trong types/shared.ts để rồi lệch nhau).

import { z } from 'zod'

// Id vừa là tên file vừa là khoá dedupe. Charset khớp sanitizeChild.
export const SCHEDULE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,120}$/

// Giờ trong ngày theo GIỜ ĐỊA PHƯƠNG của máy, dạng 24h "HH:MM".
export const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// Trần khoảng lặp: 1 tuần. Dài hơn thì dùng `weekly`.
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60

// Số lần chạy giữ lại trong lịch sử (mới nhất đứng đầu).
export const MAX_RUN_HISTORY = 20

// Độ dài lời nhắc agent tự viết cho mình (job `session-wakeup`, gói #14). Đủ cho
// "build #482 đang chạy, xem log ở /tmp/build.log rồi báo kết quả", không đủ để
// nhét một bản tóm tắt hội thoại vào một file lịch.
export const MAX_WAKEUP_NOTE_LEN = 500

// Biểu thức lịch. Union rời rạc thay vì chuỗi cron 5 trường: mỗi biến thể tự mô
// tả, validate được bằng zod, và render ra câu tiếng người mà không cần parser
// ngược (xem ADR 0082 — "vì sao không dùng node-cron").
export const ScheduleTriggerSchema = z.discriminatedUnion('kind', [
  // Mỗi N phút. UI cho chọn đơn vị phút/giờ rồi quy về phút.
  z.object({
    kind: z.literal('interval'),
    everyMinutes: z.number().int().min(1).max(MAX_INTERVAL_MINUTES),
  }),
  // Hằng ngày lúc HH:MM giờ địa phương.
  z.object({ kind: z.literal('daily'), time: z.string().regex(TIME_OF_DAY_RE) }),
  // Các ngày trong tuần lúc HH:MM giờ địa phương. 0 = Chủ nhật … 6 = Thứ bảy
  // (khớp Date.prototype.getDay).
  z.object({
    kind: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: z.string().regex(TIME_OF_DAY_RE),
  }),
  // MỘT lần duy nhất, tại một mốc tuyệt đối (ISO). Không lặp: `computeNextRun`
  // trả null sau khi đã qua mốc, và chủ của nó tự xoá mình khi chạy xong.
  //
  // KHÔNG có trên UI và người dùng không tạo được (schedules.upsert từ chối) —
  // đây là hình của lời hẹn agent tự đặt qua tool `schedule_wakeup` (gói #14).
  // Chuỗi chỉ kiểm độ dài ở đây: một thành viên của discriminatedUnion không
  // gắn `.refine` được (thành ZodEffects), nên tính hợp lệ của mốc do
  // `computeNextRun` quyết (Date.parse hỏng ⇒ null ⇒ không bao giờ tới hạn).
  z.object({ kind: z.literal('once'), at: z.string().max(40) }),
])

// Thiết lập LLM chụp lại tại thời điểm tạo lịch. Sidecar KHÔNG đọc settings.json
// để suy ra (quy ước dự án: cấu hình hành vi đi qua payload, không để sidecar tự
// đọc file settings của UI) — nên lịch phải tự mang đủ.
export const ScheduleSessionSettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1).max(200),
  level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']),
  // Chế độ quyền. Chạy không người trực: 'ask' ⇒ mọi tool ghi/exec bị CHẶN (không
  // có ai trả lời prompt — runtime fail-safe). Muốn agent tự làm thì phải chọn
  // 'accept-edits' hoặc 'execute' một cách tường minh. Xem ADR 0082 §Bảo mật.
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']),
  accountId: z.string().max(200).optional(),
})

// Trần chi tiêu một lượt chạy theo lịch (khớp SessionBudget của sidecar).
export const ScheduleBudgetSchema = z.object({
  limitUsd: z.number().positive().max(1000).optional(),
  hardLimitUsd: z.number().positive().max(1000).optional(),
  maxToolCalls: z.number().int().positive().max(100_000).optional(),
  maxWallclockMs: z.number().int().positive().max(86_400_000).optional(),
})

// Loại việc lịch chạy.
export const ScheduleJobSchema = z.discriminatedUnion('kind', [
  // Mở một phiên chat MỚI và gửi sẵn một prompt vào đó.
  z.object({
    kind: z.literal('session-prompt'),
    prompt: z.string().min(1).max(20_000),
    title: z.string().max(200).optional(),
    projectId: z.string().max(200).optional(),
    settings: ScheduleSessionSettingsSchema,
    // Trần chi tiêu cho MỘT lượt chạy. Bỏ trống ⇒ dùng mặc định thận trọng ở
    // runner.ts. Lượt chạy theo lịch không có ai ngồi xem, nên nó KHÔNG BAO GIỜ
    // được chạy không trần — xem `.claude/rules/security.md`, sink "Loop gọi model".
    budget: ScheduleBudgetSchema.optional(),
  }),
  // Chạy một workflow có sẵn thành một task mới.
  z.object({
    kind: z.literal('workflow-task'),
    workflowId: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    description: z.string().max(20_000).default(''),
  }),
  // Lời hẹn agent tự đặt cho CHÍNH phiên nó đang chạy (gói #14).
  //
  // Khác hai loại trên ở điểm quan trọng nhất: nó KHÔNG chạy lượt LLM nào. Tới
  // giờ, runner chỉ đặt một lời nhắc vào hộp thư của phiên (`session.inbox-message`)
  // rồi tự xoá mình; người dùng bấm giao thì mới có một lượt. Vì thế nó không có
  // `settings`, không có `budget` và không sinh dòng lịch sử chạy nào.
  z.object({
    kind: z.literal('session-wakeup'),
    sessionId: z.string().min(1).max(200),
    note: z.string().min(1).max(MAX_WAKEUP_NOTE_LEN),
    // Mốc ĐẶT hẹn. Là cách nhận ra "cuộc trò chuyện đã đi tiếp": có tin của người
    // dùng SAU mốc này ⇒ lời hẹn hết ý nghĩa và tự huỷ (schedules/wakeup.ts).
    armedAt: z.string().max(40),
  }),
])

export const ScheduleRunStatusSchema = z.enum(['running', 'ok', 'error', 'skipped'])

// Một dòng lịch sử chạy.
export const ScheduleRunSchema = z.object({
  id: z.string().min(1).max(64),
  startedAt: z.string().max(40),
  finishedAt: z.string().max(40).optional(),
  status: ScheduleRunStatusSchema,
  // Ai bấm cò: bộ đếm giờ hay người dùng bấm "Chạy ngay".
  trigger: z.enum(['timer', 'manual']),
  // Lần này là chạy BÙ (máy vừa thức dậy / app vừa mở, đã quá hạn từ lâu).
  catchUp: z.boolean().optional(),
  // Kết quả: task đã tạo hoặc phiên đã mở.
  taskId: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  // Lý do lỗi / lý do bỏ qua, đã cắt ngắn cho UI.
  message: z.string().max(500).optional(),
})

export const ScheduleSchema = z.object({
  id: z.string().regex(SCHEDULE_ID_RE),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  trigger: ScheduleTriggerSchema,
  job: ScheduleJobSchema,
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  // Mốc chạy kế tiếp (ISO). null = chưa tính được / lịch đang tắt.
  nextRunAt: z.string().max(40).nullable(),
  lastRunAt: z.string().max(40).optional(),
  lastStatus: ScheduleRunStatusSchema.optional(),
  runs: z.array(ScheduleRunSchema).max(MAX_RUN_HISTORY).default([]),
})

export type ScheduleTrigger = z.infer<typeof ScheduleTriggerSchema>
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>
export type Schedule = z.infer<typeof ScheduleSchema>
