// `schedule_wakeup` AgentTool — agent tự hẹn quay lại phiên này sau N giây (gói #14).
//
// Trước tool này agent chỉ được đánh thức một cách PHẢN ỨNG: một lệnh nền chạy
// xong thì phiên được đánh thức (ADR 0066). Với thứ không phát tín hiệu — một
// deploy 10 phút, một job CI, một cronjob bên ngoài — nó chỉ còn hai lựa chọn tệ:
// poll trong cùng một lượt (đốt token, giữ lượt mở hàng phút) hoặc bỏ dở.
//
// CƠ CHẾ, và vì sao nó KHÔNG chạy sau lưng người dùng: tool ghi một mục lịch
// ONE-SHOT (`schedules/wakeup.ts`, dùng lại store + bộ đếm giờ của ADR 0082). Tới
// giờ, sidecar chỉ ĐẶT một lời nhắc vào hộp thư của phiên; renderer hiện chip và
// NGƯỜI DÙNG bấm giao thì mới có một lượt. Trong lúc chờ không có gì chạy và
// không tốn một xu — cùng mô hình với hộp thư liên phiên và theo dõi PR.
//
// CHỈ CẤP CHO CHAT SESSION (`ToolFilter.chatSession`): một task chạy không người
// trông và một subagent (đã trả kết quả về cho phiên cha) không có ai để bấm chip,
// nên ở đó tool này chỉ là schema thừa.
//
// BẢO MẬT: tham số chỉ có SỐ + VĂN BẢN. Không path, không lệnh, không id — không
// có gì để lúc đánh thức "chạy hộ". `sessionId` KHÔNG phải tham số: nó lấy từ
// ToolFilter của lượt, nên model không hẹn giùm phiên khác được.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import {
  MAX_PENDING_WAKEUPS_PER_SESSION,
  MAX_WAKEUPS_PER_TURN,
  MAX_WAKEUP_DELAY_SECONDS,
  MIN_WAKEUP_DELAY_SECONDS,
  WAKEUP_MAX_LATE_MS,
  WakeupError,
  armWakeup,
} from '../../schedules/wakeup.js'
import { MAX_WAKEUP_NOTE_LEN } from '../../schedules/schema.js'

const MAX_DELAY_HOURS = MAX_WAKEUP_DELAY_SECONDS / 3600
const MAX_LATE_MINUTES = WAKEUP_MAX_LATE_MS / 60_000

// Mọi chuỗi model ĐỌC về tool này, ở đúng một chỗ. Nhánh Pi dựng schema TypeBox từ
// đây, nhánh Claude SDK dựng schema zod từ đây (surface-sdk-server.ts) — nên hai
// runtime quảng cáo y hệt nhau theo cấu tạo, không phải nhờ ai nhớ đồng bộ.
export const WAKEUP_TEXT = {
  description:
    'Ask to be brought back to THIS conversation later, with a short note to yourself — for when the thing you need is not ready yet and nothing will signal you (a long deploy, a CI run, a job someone else is running, a rate limit that resets). ' +
    'Prefer it over polling in a loop: waiting costs nothing, polling costs a round-trip each time. If you started the command yourself in the background, use BashOutput or monitor instead — those wake you as soon as it exits. ' +
    'When the time comes NOTHING runs on its own: the reminder is queued and the user decides whether to hand it to you, so you may come back later than asked, or not at all. ' +
    `The timer lives in the AWOG app, so it only counts while the app is open; if the app was closed, the wake-up happens the next time it runs, and it is dropped once it is more than ${MAX_LATE_MINUTES} minutes late. ` +
    'It is also cancelled if the user writes to this session before then, or the session is deleted or archived. ' +
    'So tell the user the app has to stay open and never promise them you will be back at a fixed time. ' +
    `Limits: at most ${MAX_WAKEUPS_PER_TURN} per turn and ${MAX_PENDING_WAKEUPS_PER_SESSION} waiting at once. Finish your answer before calling it — the user sees your reply now, not when you wake up.`,
  inSeconds:
    `How long from now to be woken, in seconds. Minimum ${MIN_WAKEUP_DELAY_SECONDS} (one minute), ` +
    `maximum ${MAX_WAKEUP_DELAY_SECONDS} (${MAX_DELAY_HOURS} hours). Anything outside that range is clamped and the result says so.`,
  note:
    `What to remind yourself of when you come back, in plain prose (max ${MAX_WAKEUP_NOTE_LEN} characters). ` +
    'Write it for a version of you that has the conversation but not the last minute of context: what you were waiting for, and how to check it.',
} as const

const Params = Type.Object({
  in_seconds: Type.Number({ description: WAKEUP_TEXT.inSeconds }),
  note: Type.String({
    // Trần nằm trong SCHEMA chứ không chỉ trong mô tả: nó là hàng rào đầu tiên trước
    // một `note` vài MB. Hàng rào thật vẫn là `armWakeup`, nơi độ dài được kiểm
    // TRƯỚC khi chuỗi đi qua bộ lọc bí mật.
    maxLength: MAX_WAKEUP_NOTE_LEN,
    description: WAKEUP_TEXT.note,
  }),
})

interface WakeupDetails {
  // Mốc hẹn (ISO) khi đặt được, null khi bị từ chối.
  dueAt: string | null
  // tool-error.ts: một lần đặt bị từ chối KHÔNG phải một bước thành công.
  isError?: true
}

function errorResult(text: string): AgentToolResult<WakeupDetails> {
  return { content: [{ type: 'text', text }], details: { dueAt: null, isError: true } }
}

// Kết quả một lần đặt hẹn, ở dạng KHÔNG phụ thuộc runtime.
export interface WakeupRunResult {
  text: string
  dueAt: string | null
  isError?: true
}

// Phần thân dùng chung cho cả hai runtime: trần theo lượt, gọi `armWakeup`, và
// dựng câu trả lời cho model. Nhánh Pi bọc nó trong một AgentTool, nhánh Claude
// SDK bọc trong một in-process MCP tool — nhưng CHÍNH SÁCH chỉ có một bản.
//
// Bộ đếm nằm trong closure, và closure được dựng MỘT LẦN MỖI LƯỢT ở cả hai nhánh
// (Pi: `createAgentTools`; SDK: `buildSurfaceToolsSdkServer` trong `runStream`),
// nên nó đúng nghĩa "trần theo lượt" — hết lượt là quên.
export function createWakeupRunner(
  sessionId: string,
): (inSeconds: number, note: string) => Promise<WakeupRunResult> {
  let armedThisTurn = 0

  return async (inSeconds, note) => {
    if (armedThisTurn >= MAX_WAKEUPS_PER_TURN) {
      return {
        text: `You have already scheduled ${armedThisTurn} wake-ups this turn, which is the limit. Finish your answer to the user instead.`,
        dueAt: null,
        isError: true,
      }
    }
    try {
      const armed = await armWakeup({ sessionId, delaySeconds: inSeconds, note })
      armedThisTurn += 1
      const clampNote =
        armed.clamped === 'min'
          ? ` Your interval was below the ${MIN_WAKEUP_DELAY_SECONDS}s minimum, so it was raised to ${armed.delaySeconds}s.`
          : armed.clamped === 'max'
            ? ` Your interval was above the ${MAX_DELAY_HOURS}h maximum, so it was lowered to ${armed.delaySeconds}s.`
            : ''
      return {
        text:
          `Wake-up set for ${armed.dueAt} (in ${armed.delaySeconds}s).${clampNote} ` +
          `${armed.pendingCount} of ${MAX_PENDING_WAKEUPS_PER_SESSION} wake-up slots for this session are now in use. ` +
          'Nothing will run until then, and when it fires the user gets a reminder to hand you — it is not guaranteed, and it is cancelled if they write here first or the app is closed for too long. ' +
          'Now finish this turn: say what you are waiting for and that you will pick it up when they bring you back.',
        dueAt: armed.dueAt,
      }
    } catch (err) {
      // Từ chối có lý do (note rỗng/quá dài, hết chỗ): nói thẳng cho model thay
      // vì để nó đoán rồi thử lại.
      if (err instanceof WakeupError) return { text: err.message, dueAt: null, isError: true }
      throw err
    }
  }
}

// Toolset được dựng lại mỗi lượt, nên biến đếm trong closure này chính là trần
// THEO LƯỢT — hết lượt là quên (cùng khuôn với session-tools.ts).
export function createWakeupTool(input: {
  sessionId: string
}): AgentTool<typeof Params, WakeupDetails> {
  const run = createWakeupRunner(input.sessionId)

  return {
    name: 'schedule_wakeup',
    label: 'Wake-up',
    description: WAKEUP_TEXT.description,
    parameters: Params,
    async execute(_id, params): Promise<AgentToolResult<WakeupDetails>> {
      const r = await run(params.in_seconds, params.note)
      if (r.isError) return errorResult(r.text)
      return { content: [{ type: 'text', text: r.text }], details: { dueAt: r.dueAt } }
    },
  }
}
