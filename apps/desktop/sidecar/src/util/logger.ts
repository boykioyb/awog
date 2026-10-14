// Stderr-only logger. Stdout is reserved for JSON-RPC framing per ADR 0008.
// Deep-masks fields whose name matches SECRET_RE to prevent accidental leak
// of API keys or tokens via log surface (invariant 1: secrets stay in sidecar).
// A secret is always a string (or a container of strings) — numeric/boolean
// values under a secret-named key are counts/flags (e.g. inputTokens), never
// secrets, so they are left visible to keep logs useful.

const SECRET_RE = /token|key|credential|authorization|secret|password/i
const MAX_DEPTH = 6

function maskValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_RE.test(k) && typeof v !== 'number' && typeof v !== 'boolean') {
        // String/object/array under a secret-named key → mask the whole subtree.
        out[k] = '***'
      } else {
        out[k] = maskValue(v, depth + 1)
      }
    }
    return out
  }
  return value
}

export function mask(value: unknown): unknown {
  return maskValue(value, 0)
}

type LogLevel = 'info' | 'warn' | 'error'

// stderr hỏng (host chết ⇒ đầu kia của pipe/socket stdio đóng) thì THÔI ghi, không
// được để lỗi đó thành `uncaughtException`. Không có listener này thì vòng sau đã xảy
// ra thật (2026-10-13, sidecar mồ côi đứng 100% CPU suốt 2,5 giờ): ghi stderr → EPIPE
// → `uncaughtException` → handler EPIPE `log.warn` → ghi stderr → EPIPE… Stream stdio
// của Node không tự `destroy` khi lỗi nên mỗi lần ghi lại ra một EPIPE mới, và vòng
// chạy hoàn toàn trong hàng đợi `nextTick` ⇒ timer/I-O không bao giờ tới lượt, kể cả
// lượt `gracefulShutdown` đang chờ ⇒ tiến trình không bao giờ thoát.
let stderrBroken = false
process.stderr.on('error', () => {
  stderrBroken = true
})

function emit(lvl: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (stderrBroken) return
  const masked = meta ? (mask(meta) as Record<string, unknown>) : {}
  const record = { lvl, msg, ts: Date.now(), ...masked }
  process.stderr.write(`${JSON.stringify(record)}\n`)
}

export const log = {
  info(msg: string, meta?: Record<string, unknown>): void {
    emit('info', msg, meta)
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    emit('warn', msg, meta)
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    emit('error', msg, meta)
  },
}
