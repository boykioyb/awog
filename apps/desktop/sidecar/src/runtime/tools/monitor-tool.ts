// `monitor` AgentTool (nhánh Pi) — CHỜ một background shell đạt tới điều kiện,
// thay vì bắt model tự poll bằng `Bash` + `sleep` + `BashOutput`.
//
// Vì sao có: nhánh Pi không có cách nào chờ một điều kiện xảy ra. Model muốn biết
// "dev server đã lên chưa" / "build xong chưa" phải chạy một vòng lặp tool call —
// mỗi vòng là một lượt round-trip tới provider, tốn token và làm rối transcript.
// Nhánh Claude SDK có tool `Monitor` của CLI; đây là phần bù cho nhánh Pi.
//
// ⚠ TOOL NÀY KHÔNG CHẠY LỆNH. Nó chỉ đọc registry background shell
// (sessions/bg-registry.ts). Lệnh phải được khởi động trước bằng
// `Bash({ run_in_background: true })` — và ĐÓ là chỗ đi qua permission gate:
// `beforeToolCall` chặn/hỏi đúng chuỗi `command` mà người dùng nhìn thấy trong
// prompt quyền (runtime/permission.ts, EXEC_TOOLS = ['Bash']). Vì monitor không
// spawn gì, nó không mở thêm một bề mặt thực thi nào cần cửa quyền mới — cùng lập
// luận đã dùng cho `BashOutput` (đọc) và `KillShell` (dừng): vòng đời của một lệnh
// ĐÃ được duyệt.
//
// Cố ý KHÔNG nhận tham số `command`: một tool "chờ" mà tự chạy lệnh sẽ là cửa sau
// đi vòng qua gate của `Bash` (monitor không nằm trong EXEC_TOOLS nên
// `beforeToolCall` cho qua thẳng). Muốn poll một điều kiện thì viết vòng lặp vào
// chính lệnh Bash được duyệt (`until curl -sf …; do sleep 2; done`) rồi chờ nó ở
// đây — chuỗi lệnh đó hiện nguyên văn trong prompt quyền.
//
// Trần cứng (một tool chờ không trần là cách nhanh nhất treo cả lượt):
//   1. thời gian chờ tối đa MAX_TIMEOUT_MS,
//   2. số lần thử tối đa MAX_POLLS,
//   3. khoảng nghỉ tối thiểu MIN_POLL_INTERVAL_MS.
// Ba trần này không độc lập: khoảng nghỉ thực tế được nâng lên
// `ceil(timeout / MAX_POLLS)` nếu cần, nên chờ hết hạn mức thời gian mà vẫn không
// bao giờ vượt trần số lần thử (thay vì cắt ngang lúc còn thời gian).

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { readBackground, type BackgroundReadResult } from '../../sessions/bg-registry.js'

// Mặc định 2 phút, trần 10 phút — bằng trần của một lệnh `Bash` foreground
// (bash-tool.ts MAX_TIMEOUT_MS), nên một lần chờ không bao giờ giữ lượt lâu hơn
// thứ model vốn đã chờ được.
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MIN_TIMEOUT_MS = 1_000

// Khoảng nghỉ giữa 2 lần đọc. Mỗi lần đọc chạm đĩa (readBackground đọc file log)
// nên nghỉ dưới 1s chỉ đốt I/O chứ không sớm hơn được bao nhiêu.
const DEFAULT_POLL_INTERVAL_MS = 2_000
const MIN_POLL_INTERVAL_MS = 1_000

// Trần số lần đọc trong MỘT lần gọi. Ở timeout tối đa (600s) trần này ép khoảng
// nghỉ lên 5s — vẫn đủ nhạy cho việc chờ build/server, mà không quét đĩa 600 lần.
const MAX_POLLS = 120

// Chuỗi cần chờ: so khớp CON, không phải regex. Cố ý — regex do model cấp, chạy
// lại mỗi vòng trên tối đa 64KB output, là một bề mặt catastrophic-backtracking
// không cần thiết. `includes` không có bề mặt đó.
const MAX_NEEDLE_LEN = 200

// Chỉ trả phần đuôi output cho model: đủ để nó thấy dòng vừa khớp / dòng lỗi cuối
// mà không nhồi cả log build vào context. Cần đầy đủ thì gọi `BashOutput`.
const OUTPUT_TAIL_CHARS = 8_000

const Params = Type.Object({
  shell_id: Type.String({
    description: 'The shellId returned by a prior Bash({ run_in_background: true }) call.',
  }),
  until_output_contains: Type.Optional(
    Type.String({
      description:
        'Stop as soon as this text appears anywhere in the shell output (case-insensitive substring, not a regex). ' +
        `Max ${MAX_NEEDLE_LEN} characters. Omit to simply wait for the command to exit.`,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: `How long to wait before giving up, in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
    }),
  ),
  poll_interval_ms: Type.Optional(
    Type.Number({
      description: `How often to check, in ms (default ${DEFAULT_POLL_INTERVAL_MS}, minimum ${MIN_POLL_INTERVAL_MS}). Raised automatically when the timeout would need more than ${MAX_POLLS} checks.`,
    }),
  ),
  description: Type.Optional(
    Type.String({ description: 'Short human-readable note about what you are waiting for.' }),
  ),
})

// Vì sao dừng chờ. Discriminant của kết quả — model đọc `outcome` là biết ngay
// đạt điều kiện, hết giờ, hay lệnh đã kết thúc.
type MonitorOutcome = 'matched' | 'exited' | 'timeout' | 'unknown_shell'

interface MonitorDetails {
  shellId: string
  outcome: MonitorOutcome
  attempts: number
  waitedMs: number
  exitCode: number | null
  // tool-error.ts: hết giờ hoặc sai shellId nghĩa là lần chờ này KHÔNG đạt được
  // thứ nó được gọi để đạt — không được render như một bước xanh thành công. Còn
  // "lệnh đã thoát" (kể cả exit code khác 0) là thông tin, không phải lỗi của tool.
  isError: boolean
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

// Nghỉ `ms`, tỉnh dậy ngay nếu lượt bị huỷ. Không bao giờ reject — người gọi tự
// kiểm tra `signal.aborted` sau khi tỉnh.
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve()
      return
    }
    let timer: NodeJS.Timeout | undefined
    const onAbort = (): void => {
      if (timer) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function tailOf(output: string): string {
  const text = output.trimEnd()
  if (text.length <= OUTPUT_TAIL_CHARS) return text || '(no output yet)'
  return `…(earlier output omitted — read it with BashOutput)\n${text.slice(-OUTPUT_TAIL_CHARS)}`
}

function statusLine(snap: BackgroundReadResult): string {
  if (snap.status === 'running') return `[${snap.shellId}] still running`
  if (snap.status === 'exited') return `[${snap.shellId}] exited (code ${snap.exitCode ?? 'unknown'})`
  return `[${snap.shellId}] no longer tracked (exit status unknown — it may have been interrupted)`
}

export function createMonitorTool(sessionId: string): AgentTool<typeof Params, MonitorDetails> {
  return {
    name: 'monitor',
    label: 'Wait',
    description: [
      'Wait until a background shell reaches a condition, instead of polling it yourself.',
      '',
      '- It does NOT start anything. Start the command first with `Bash({ run_in_background: true })`, then pass the `shell_id` it returned.',
      '- Give `until_output_contains` to stop as soon as that text shows up (a server printing "Listening on", a watcher printing "compiled successfully"); omit it to wait for the command to exit.',
      '- It also returns early when the command exits on its own, so a crash while you wait comes back immediately with the exit code instead of burning the whole timeout.',
      `- Hard caps: at most ${MAX_TIMEOUT_MS}ms of waiting and ${MAX_POLLS} checks per call, never faster than one check every ${MIN_POLL_INTERVAL_MS}ms. Timing out is a normal answer — check the returned output and decide, do not immediately wait again on the same shell without a reason.`,
      '- To wait on a condition that is not a line of output (an HTTP endpoint answering, a file appearing), put the polling loop inside the command you launch — `Bash({ run_in_background: true, command: "until curl -sf localhost:3000/health; do sleep 2; done" })` — then wait for that shell to exit here.',
      '- Only the tail of the output comes back. Use `BashOutput` for the full log and `KillShell` to stop the shell.',
    ].join('\n'),
    parameters: Params,
    async execute(_id, params, signal): Promise<AgentToolResult<MonitorDetails>> {
      const timeoutMs = clampNumber(params.timeout_ms, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
      // Trần số lần thử được ép bằng cách NÂNG khoảng nghỉ, không phải cắt ngắn
      // thời gian chờ: cả 3 trần cùng đúng và người gọi vẫn nhận đủ hạn mức chờ.
      const pollIntervalMs = Math.max(
        clampNumber(params.poll_interval_ms, DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS, MAX_TIMEOUT_MS),
        Math.ceil(timeoutMs / MAX_POLLS),
      )
      // Cắt trần TRƯỚC khi lấy bản thường hoá, để câu trả lời trích đúng chuỗi
      // thật sự được so khớp chứ không phải chuỗi model gửi.
      const rawNeedle = (params.until_output_contains?.trim() ?? '').slice(0, MAX_NEEDLE_LEN)
      const needle = rawNeedle.toLowerCase()

      const startedAt = Date.now()
      const deadline = startedAt + timeoutMs
      let attempts = 0
      let snap: BackgroundReadResult | null = null

      for (;;) {
        if (signal?.aborted) throw new Error('monitor aborted')
        attempts += 1
        // Không truyền option: đọc một shell ĐÃ kết thúc cũng chính là lúc model
        // nhận kết quả, nên chip nền được retire đúng như khi gọi `BashOutput`.
        snap = readBackground(sessionId, params.shell_id)
        if (!snap) {
          return {
            content: [
              {
                type: 'text',
                text:
                  `No background shell with id "${params.shell_id}" in this session. ` +
                  'Start one with Bash({ run_in_background: true }) and pass the shellId it returns.',
              },
            ],
            details: {
              shellId: params.shell_id,
              outcome: 'unknown_shell',
              attempts,
              waitedMs: Date.now() - startedAt,
              exitCode: null,
              isError: true,
            },
          }
        }
        if (needle.length > 0 && snap.output.toLowerCase().includes(needle)) {
          return done(snap, 'matched', attempts, startedAt, rawNeedle)
        }
        if (snap.status !== 'running') return done(snap, 'exited', attempts, startedAt, rawNeedle)
        const remaining = deadline - Date.now()
        if (remaining <= 0 || attempts >= MAX_POLLS) {
          return done(snap, 'timeout', attempts, startedAt, rawNeedle)
        }
        await sleep(Math.min(pollIntervalMs, remaining), signal)
      }
    },
  }
}

// Gói một lần chờ đã xong thành kết quả cho model: một dòng nói RÕ vì sao dừng,
// rồi trạng thái shell, rồi phần đuôi output.
function done(
  snap: BackgroundReadResult,
  outcome: Exclude<MonitorOutcome, 'unknown_shell'>,
  attempts: number,
  startedAt: number,
  needle: string,
): AgentToolResult<MonitorDetails> {
  const waitedMs = Date.now() - startedAt
  const seconds = Math.round(waitedMs / 1000)
  const headline =
    outcome === 'matched'
      ? `Condition met after ${seconds}s: the output contains "${needle}".`
      : outcome === 'exited'
        ? `The command finished after ${seconds}s${
            needle ? ` WITHOUT the output ever containing "${needle}"` : ''
          }.`
        : `Timed out after ${seconds}s — the command is still running${
            needle ? ` and its output never contained "${needle}"` : ''
          }. Nothing was stopped: wait again, read more with BashOutput, or stop it with KillShell.`
  return {
    content: [
      { type: 'text', text: `${headline}\n${statusLine(snap)}\n\n${tailOf(snap.output)}` },
    ],
    details: {
      shellId: snap.shellId,
      outcome,
      attempts,
      waitedMs,
      exitCode: snap.exitCode,
      isError: outcome === 'timeout',
    },
  }
}
