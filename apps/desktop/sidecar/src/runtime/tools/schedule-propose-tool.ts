// `propose_schedule` AgentTool — agent soạn một lịch chạy theo lời người dùng (ADR 0108).
//
// Agent KHÔNG tạo được lịch đang chạy. Tool chỉ ghi một ĐỀ XUẤT: lịch tắt, mang
// `proposedBy`, runner bỏ qua, công tắc không bật được. Người dùng mở nó trong trang
// Lịch chạy → Sửa → Lưu (job `command` thì duyệt thêm từng tham số) — lúc đó lịch mới
// thành thật. Cùng lý do mọi đường khác của lịch đều có người đứng sau: lượt chạy theo
// lịch không ai trực, ở mode `execute` không có cổng quyền nào bấm phanh.
//
// Ghi file lịch trực tiếp bằng Write/Bash bị chặn ở permission gate
// (`touchesAwogAutomation`) — tool này là đường DUY NHẤT của agent.
//
// CHỈ CẤP CHO CHAT SESSION: task / subagent không có người để đọc đề xuất ngay.
// `sessionId` lấy từ ToolFilter của lượt, không phải tham số.
//
// Hai loại việc: gửi prompt vào một phiên mới (`prompt`), hoặc chạy một lệnh không qua
// AI (`program` + `args`). Phiên mới dùng model/tài khoản của CHÍNH phiên này, mode
// `plan` — người dùng đổi được khi duyệt.

import { randomBytes } from 'node:crypto'
import { access, constants } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { emit } from '../../transport/stdio.js'
import { loadSession } from '../../sessions/store.js'
import { listSchedules, loadSchedule, saveSchedule } from '../../schedules/store.js'
import {
  MAX_COMMAND_ARGS,
  MAX_COMMAND_TIMEOUT_MINUTES,
  ScheduleSchema,
  type ScheduleJob,
  type ScheduleTrigger,
} from '../../schedules/schema.js'

export const MAX_PROPOSALS_PER_TURN = 3
// Đề xuất chưa ai xem cũng là rác trong trang Lịch chạy — trần toàn app.
export const MAX_PENDING_PROPOSALS = 10

// Mọi chuỗi model ĐỌC về tool này, ở một chỗ: nhánh Pi dựng TypeBox, nhánh Claude SDK
// dựng zod từ đây (surface-sdk-server.ts).
export const SCHEDULE_PROPOSE_TEXT = {
  description:
    'Propose a recurring schedule in the AWOG app when the user asks for something to happen regularly (every N minutes, daily, on certain weekdays). ' +
    'The schedule is created OFF: nothing runs until the user opens it in AWOG → Schedules, reviews it and saves it (for a command they also approve the exact program and arguments). ' +
    'Two kinds of job — give exactly one: `prompt` (opens a new session with this prompt each time, same model and account as this session, read-only plan mode unless the user changes it) or `program` + `args` (runs a program directly, no AI, no shell). ' +
    'Timing — give exactly one: `every_minutes`, or `at` (daily HH:MM, local time), or `at` + `weekdays`. ' +
    'Schedules only run while the AWOG app is open. Do not write files under .awog/schedules yourself — that is blocked. ' +
    `Limits: ${MAX_PROPOSALS_PER_TURN} proposals per turn, ${MAX_PENDING_PROPOSALS} waiting for review at once. After calling it, tell the user to review and save it in Schedules.`,
  name: 'Short name the user will recognise in the Schedules list.',
  everyMinutes: 'Run every N minutes (1–10080). Omit when using `at`.',
  at: 'Local time of day "HH:MM" (24h). Alone = daily; with `weekdays` = those days only.',
  weekdays: 'Days for `at`: 0 = Sunday … 6 = Saturday.',
  prompt: 'For a session job: the prompt sent to a new session each run.',
  program: 'For a command job: absolute path of the program to run (no PATH lookup, no shell).',
  args: `For a command job: arguments, one per element (max ${MAX_COMMAND_ARGS}). No quoting, variables or pipes.`,
  timeoutMinutes: `For a command job: time limit per run, 1–${MAX_COMMAND_TIMEOUT_MINUTES} minutes (default 10).`,
} as const

export type ScheduleProposeArgs = {
  name: string
  every_minutes?: number | undefined
  at?: string | undefined
  weekdays?: number[] | undefined
  prompt?: string | undefined
  program?: string | undefined
  args?: string[] | undefined
  timeout_minutes?: number | undefined
}

export interface ScheduleProposeResult {
  text: string
  scheduleId: string | null
  isError?: true
}

class ProposeError extends Error {}

function buildTrigger(a: ScheduleProposeArgs): ScheduleTrigger {
  if (a.every_minutes !== undefined) {
    if (a.at !== undefined || a.weekdays !== undefined) {
      throw new ProposeError('Give either `every_minutes` or `at` (with optional `weekdays`), not both.')
    }
    return { kind: 'interval', everyMinutes: Math.round(a.every_minutes) }
  }
  if (a.at === undefined) throw new ProposeError('Missing timing: give `every_minutes` or `at`.')
  return a.weekdays?.length
    ? { kind: 'weekly', weekdays: [...new Set(a.weekdays)].sort(), time: a.at }
    : { kind: 'daily', time: a.at }
}

// Trả `unknown` có chủ đích: kiểu thật do ScheduleSchema quyết khi parse bên dưới (vd provider
// của phiên ngoài tập lịch hỗ trợ ⇒ từ chối có lý do), không ép kiểu cho qua.
async function buildJob(a: ScheduleProposeArgs, sessionId: string): Promise<unknown> {
  const hasPrompt = Boolean(a.prompt?.trim())
  const hasProgram = Boolean(a.program?.trim())
  if (hasPrompt === hasProgram) {
    throw new ProposeError('Give exactly one job: `prompt`, or `program` (+ `args`).')
  }
  if (hasProgram) {
    const program = a.program!.trim()
    if (!isAbsolute(program)) throw new ProposeError(`\`program\` must be an absolute path, got "${program}".`)
    try {
      await access(program, constants.X_OK)
    } catch {
      throw new ProposeError(`\`program\` is not an executable file: ${program}`)
    }
    const job: ScheduleJob = {
      kind: 'command',
      program,
      args: a.args ?? [],
      ...(a.timeout_minutes !== undefined ? { timeoutMinutes: Math.round(a.timeout_minutes) } : {}),
    }
    return job
  }
  const session = await loadSession(sessionId)
  if (!session?.settings) throw new ProposeError('This session has no model settings to copy.')
  const { provider, modelId, level, accountId } = session.settings
  return {
    kind: 'session-prompt',
    prompt: a.prompt!.trim(),
    ...(session.projectId ? { projectId: session.projectId } : {}),
    // `plan` = đọc và suy nghĩ, không ghi/không chạy lệnh. Người dùng nâng lên `execute`
    // khi duyệt nếu muốn — agent không tự đề xuất quyền chạy không người trực.
    settings: { provider, modelId, level, mode: 'plan', ...(accountId ? { accountId } : {}) },
  }
}

function slug(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `${base || 'proposal'}-${randomBytes(3).toString('hex')}`
}

// Bộ đếm theo lượt nằm trong closure, dựng lại mỗi lượt ở cả hai nhánh (như wakeup-tool.ts).
export function createScheduleProposeRunner(
  sessionId: string,
): (args: ScheduleProposeArgs) => Promise<ScheduleProposeResult> {
  let proposedThisTurn = 0

  return async (args) => {
    if (proposedThisTurn >= MAX_PROPOSALS_PER_TURN) {
      return {
        text: `You already proposed ${proposedThisTurn} schedules this turn, which is the limit.`,
        scheduleId: null,
        isError: true,
      }
    }
    try {
      const pending = (await listSchedules()).filter((s) => s.proposedBy).length
      if (pending >= MAX_PENDING_PROPOSALS) {
        throw new ProposeError(
          `${pending} proposed schedules are already waiting for the user's review; ask them to review or delete those first.`,
        )
      }
      const now = new Date().toISOString()
      let id = slug(args.name)
      while (await loadSchedule(id)) id = slug(args.name)
      // File lịch là L1 với mọi người đọc về sau — validate bằng chính schema của store,
      // nên một đề xuất không bao giờ ghi ra thứ mà trang Lịch chạy không đọc được.
      const parsed = ScheduleSchema.safeParse({
        id,
        name: args.name.trim().slice(0, 200),
        enabled: false,
        trigger: buildTrigger(args),
        job: await buildJob(args, sessionId),
        createdAt: now,
        updatedAt: now,
        nextRunAt: null,
        runs: [],
        proposedBy: { sessionId, at: now },
      })
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw new ProposeError(`Invalid schedule: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim())
      }
      await saveSchedule(parsed.data)
      emit('schedules.changed', { id })
      proposedThisTurn += 1
      return {
        text:
          `Proposed schedule "${parsed.data.name}" (id ${id}). It is OFF and will not run until the user opens it in AWOG → Schedules, reviews it and saves it` +
          (parsed.data.job.kind === 'command' ? ', approving the exact program and arguments' : '') +
          '. Tell the user that, and that schedules only run while the app is open.',
        scheduleId: id,
      }
    } catch (err) {
      if (err instanceof ProposeError) return { text: err.message, scheduleId: null, isError: true }
      throw err
    }
  }
}

const Params = Type.Object({
  name: Type.String({ maxLength: 200, description: SCHEDULE_PROPOSE_TEXT.name }),
  every_minutes: Type.Optional(Type.Number({ description: SCHEDULE_PROPOSE_TEXT.everyMinutes })),
  at: Type.Optional(Type.String({ description: SCHEDULE_PROPOSE_TEXT.at })),
  weekdays: Type.Optional(Type.Array(Type.Number(), { description: SCHEDULE_PROPOSE_TEXT.weekdays })),
  prompt: Type.Optional(Type.String({ maxLength: 20_000, description: SCHEDULE_PROPOSE_TEXT.prompt })),
  program: Type.Optional(Type.String({ maxLength: 1000, description: SCHEDULE_PROPOSE_TEXT.program })),
  args: Type.Optional(
    Type.Array(Type.String({ maxLength: 2000 }), { maxItems: MAX_COMMAND_ARGS, description: SCHEDULE_PROPOSE_TEXT.args }),
  ),
  timeout_minutes: Type.Optional(Type.Number({ description: SCHEDULE_PROPOSE_TEXT.timeoutMinutes })),
})

interface ProposeDetails {
  scheduleId: string | null
  isError?: true
}

export function createScheduleProposeTool(input: {
  sessionId: string
}): AgentTool<typeof Params, ProposeDetails> {
  const run = createScheduleProposeRunner(input.sessionId)
  return {
    name: 'propose_schedule',
    label: 'Propose schedule',
    description: SCHEDULE_PROPOSE_TEXT.description,
    parameters: Params,
    async execute(_id, params): Promise<AgentToolResult<ProposeDetails>> {
      const r = await run(params)
      return {
        content: [{ type: 'text', text: r.text }],
        details: { scheduleId: r.scheduleId, ...(r.isError ? { isError: true as const } : {}) },
      }
    },
  }
}
