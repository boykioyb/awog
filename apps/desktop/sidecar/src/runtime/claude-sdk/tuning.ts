// Các option "vặn máy" của Claude Agent SDK mà AWOG bật chung cho cả hai điểm gọi
// `query()` — chat (run-stream.ts) và node của task (invoke.ts) — gom một chỗ để
// hai nơi không mỗi nơi một kiểu. Bảng đối chiếu đầy đủ 66 option + cái nào đang
// dùng ở đâu: docs/reference/claude-sdk-options.md.
//
// Ba nhóm ở đây:
//   1. Chẩn đoán — bật bằng BIẾN MÔI TRƯỜNG, không có UI. Đây là đồ nghề lúc có sự
//      cố, không phải tính năng người dùng; `stderr` thì luôn bật vì không đọc nó
//      là tự bịt mắt trước mọi cảnh báo/crash của tiến trình CLI.
//   2. Bền bỉ — `fallbackModel` để một cú quá tải của Anthropic không giết cả lượt.
//   3. Cách ly cấu hình — nói TƯỜNG MINH nguồn settings nào được nạp và cấm CLI tự
//      nhặt MCP server ngoài danh sách AWOG truyền vào.

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { log } from '../../util/logger.js'
import { ANTHROPIC_MODELS } from '../../providers/anthropic/models-map.js'

// ─── 1. Chẩn đoán ───────────────────────────────────────────────────────────

const ENV = {
  debug: 'AWOG_CLAUDE_DEBUG',
  debugFile: 'AWOG_CLAUDE_DEBUG_FILE',
  executable: 'AWOG_CLAUDE_EXECUTABLE',
  executableArgs: 'AWOG_CLAUDE_EXECUTABLE_ARGS',
  extraArgs: 'AWOG_CLAUDE_EXTRA_ARGS',
  fallbackModel: 'AWOG_FALLBACK_MODEL',
  taskBudgetTokens: 'AWOG_CLAUDE_TASK_BUDGET_TOKENS',
  maxTurns: 'AWOG_CLAUDE_MAX_TURNS',
} as const

// Trần số dòng stderr ghi log mỗi lần chạy. Bật `--debug` là CLI xả rất nhiều; một
// lượt không được phép chiếm cả file log của sidecar.
const STDERR_LINE_CAP = 200
const STDERR_LINE_MAX_CHARS = 2_000

// stderr của tiến trình CLI → log của sidecar. TUYỆT ĐỐI không đẩy lên UI: dòng
// stderr có thể chứa đường dẫn, biến môi trường, đoạn prompt — thuộc diện chỉ nằm
// lại máy người dùng (invariant #1 + "verbose leak" trong rules/security).
function makeStderrSink(label: string): (data: string) => void {
  let lines = 0
  let capped = false
  return (data: string) => {
    for (const raw of data.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      if (lines >= STDERR_LINE_CAP) {
        if (!capped) {
          capped = true
          log.warn('claude-sdk stderr: cap reached, dropping the rest', { label, cap: STDERR_LINE_CAP })
        }
        return
      }
      lines += 1
      log.warn('claude-sdk stderr', { label, line: line.slice(0, STDERR_LINE_MAX_CHARS) })
    }
  }
}

function envList(key: string): string[] | undefined {
  const raw = process.env[key]?.trim()
  if (!raw) return undefined
  const parts = raw.split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

// `extraArgs` nhận JSON object: {"flag":"value","boolean-flag":null}. Sai cú pháp
// thì BỎ QUA kèm cảnh báo — một biến môi trường gõ nhầm không đáng làm chết phiên.
function envExtraArgs(): Record<string, string | null> | undefined {
  const raw = process.env[ENV.extraArgs]?.trim()
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not a JSON object')
    }
    const out: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === null) out[k] = null
      else if (typeof v === 'string') out[k] = v
      else out[k] = String(v)
    }
    return Object.keys(out).length > 0 ? out : undefined
  } catch (err) {
    log.warn('ignoring malformed AWOG_CLAUDE_EXTRA_ARGS', {
      err: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}

const isExecutable = (v: string | undefined): v is 'bun' | 'deno' | 'node' =>
  v === 'bun' || v === 'deno' || v === 'node'

// Gói option chẩn đoán cho một lần chạy. `label` chỉ đi vào log để phân biệt chat
// với task khi đọc lại.
export function diagnosticsOptions(label: 'chat' | 'task'): Partial<Options> {
  const debugFile = process.env[ENV.debugFile]?.trim()
  const executable = process.env[ENV.executable]?.trim()
  const extraArgs = envExtraArgs()
  const executableArgs = envList(ENV.executableArgs)
  return {
    stderr: makeStderrSink(label),
    ...(process.env[ENV.debug] === '1' ? { debug: true } : {}),
    ...(debugFile ? { debugFile } : {}),
    // `executable`/`executableArgs` chỉ có nghĩa khi CLI chạy qua node/bun/deno —
    // bản đóng gói dùng native binary (pathToClaudeCodeExecutable) nên hai cái này
    // là đường thoát cho dev, không phải cấu hình thường ngày.
    ...(isExecutable(executable) ? { executable } : {}),
    ...(executableArgs ? { executableArgs } : {}),
    ...(extraArgs ? { extraArgs } : {}),
  }
}

// ─── 2. Bền bỉ: model dự phòng ──────────────────────────────────────────────

// Bậc hạ khi model chính quá tải/không có. Đi XUỐNG một bậc năng lực chứ không
// nhảy thẳng xuống đáy: một lượt trả lời bằng model yếu hơn một bậc vẫn dùng được,
// còn nhảy từ opus xuống haiku thì kết quả khác hẳn thứ người dùng đã chọn.
const FALLBACK_CHAIN: Record<string, string> = {
  'claude-opus-5': 'claude-sonnet-5',
  'claude-opus-5-1m': 'claude-sonnet-5',
  'claude-opus-4-8': 'claude-sonnet-5',
  'claude-opus-4-8-1m': 'claude-sonnet-5',
  'claude-opus-4-7': 'claude-sonnet-5',
  'claude-opus-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-5': 'claude-sonnet-4-6',
  'claude-sonnet-4-6': 'claude-haiku-4-5',
}

// Model dự phòng cho một model chính. `AWOG_FALLBACK_MODEL` ghi đè bảng trên;
// đặt nó thành chuỗi rỗng để TẮT hẳn (có người muốn lượt chết còn hơn đổi model).
export function fallbackModelFor(modelId: string | undefined): string | undefined {
  const override = process.env[ENV.fallbackModel]
  if (override !== undefined) {
    const trimmed = override.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (!modelId) return undefined
  const next = FALLBACK_CHAIN[modelId]
  // Chỉ trả model AWOG biết mặt: một id lạ đi vào đây là gửi thẳng cho provider.
  return next && (ANTHROPIC_MODELS as readonly string[]).includes(next) ? next : undefined
}

// ─── 3. Cách ly cấu hình ────────────────────────────────────────────────────

// SDK mặc định nạp CẢ BA nguồn settings trên đĩa (`user` + `project` + `local`).
// AWOG dùng chung `~/.claude` với Claude Code CLI (ADR 0070), nên mặc định đó
// nghĩa là settings cá nhân của người dùng — hook, luật quyền, biến môi trường —
// đang chảy vào phiên AWOG. Khai TƯỜNG MINH đúng bộ ba đó: hành vi giữ nguyên,
// nhưng một lần SDK đổi mặc định sẽ không âm thầm đổi hành vi của AWOG.
//
// `strictMcpConfig` thì SIẾT thật: MCP của AWOG là các Source người dùng khai
// trong app, đã lọc theo whitelist per-agent và giải secret qua keychain. Server
// khai trong file cấu hình cá nhân KHÔNG đi qua hàng rào đó, nên không được phép
// tự nhặt vào.
export const CONFIG_ISOLATION_OPTIONS = {
  settingSources: ['user', 'project', 'local'],
  strictMcpConfig: true,
} as const satisfies Partial<Options>

// ─── 4. Ngân sách phía SDK ──────────────────────────────────────────────────

// Trần TIỀN cho một lần chạy, tính bằng USD còn lại của phiên/task. Vượt trần thì
// SDK dừng query và trả result `error_max_budget_usd` — khác hẳn hàng rào hiện có
// của AWOG (chặn trước khi bắt đầu lượt / phát hiện sau khi node xong), vốn không
// cứu được một lượt đang cháy tiền giữa chừng.
//
// `undefined`/≤0 ⇒ bỏ hẳn option: SDK coi 0 là "hết sạch ngân sách" và dừng ngay.
export function budgetOptions(remainingUsd: number | undefined): Partial<Options> {
  if (remainingUsd === undefined || !Number.isFinite(remainingUsd) || remainingUsd <= 0) return {}
  return { maxBudgetUsd: remainingUsd }
}

// `taskBudget` (alpha, kèm beta header phía API) cho MODEL biết nó còn bao nhiêu
// token để tự liệu — khác `maxBudgetUsd` vốn chỉ chặt cứng. Mặc định TẮT: một beta
// header không mong đợi có thể làm request 400 trên tài khoản OAuth, và đó là cái
// giá quá đắt cho một tính năng "biết điều".
export function taskBudgetOption(): Partial<Options> {
  const raw = process.env[ENV.taskBudgetTokens]?.trim()
  if (!raw) return {}
  const total = Number(raw)
  if (!Number.isFinite(total) || total <= 0) {
    log.warn('ignoring malformed AWOG_CLAUDE_TASK_BUDGET_TOKENS', { raw })
    return {}
  }
  return { taskBudget: { total } }
}

// Trần số LƯỢT hội thoại trong một lần chạy. Mặc định TẮT và chỉ bật bằng env: một
// lượt ở đây gồm cả vòng gọi tool, nên đặt số thấp là cắt ngang công việc thật —
// ngân sách theo tool-call/thời gian/tiền của AWOG mới là hàng rào thường ngày.
export function turnCapOption(): Partial<Options> {
  const raw = process.env[ENV.maxTurns]?.trim()
  if (!raw) return {}
  const maxTurns = Number(raw)
  if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
    log.warn('ignoring malformed AWOG_CLAUDE_MAX_TURNS', { raw })
    return {}
  }
  return { maxTurns }
}
