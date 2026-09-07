import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSessionRawLines } from '../sessions/store.js'
import { redactDeep, redactString } from '../sessions/redact.js'
import type { SessionRawEvent, SessionRawEventPage } from '../types/shared.js'

// Đọc THÔ file `~/.awog/sessions/{id}/session.jsonl` theo từng dòng — công cụ debug
// cho chính transcript (docs/features/session-lifecycle-ops.md). `sessions.get` trả về
// Session đã fold: dòng hỏng bị bỏ im lặng, header bị tháo ra thành metadata. Khi một
// phiên hiển thị sai thì cái ta cần lại đúng là những thứ đó — nên RPC này trả về
// nguyên trạng từng dòng.
//
// Dòng hỏng (JSON.parse fail) KHÔNG được làm sập RPC: nó thành entry
// `{ kind: 'malformed', raw }` — phơi bày dòng hỏng CHÍNH LÀ giá trị của công cụ này.
//
// Bảo mật (invariant #1): payload đi qua sessions/redact.ts trước khi lên UI, kể cả
// nhánh 'malformed' (một dòng hỏng vẫn có thể chứa token đã gõ vào lệnh Bash).
const SESSION_ID_RE = /^[a-z0-9-]+$/

// 200 dòng đủ cho một màn hình debug; cap cứng 1000 để một lần gọi không kéo cả
// transcript khổng lồ qua IPC.
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

// Dòng hỏng chỉ trả về đoạn đầu: đủ để nhận ra chỗ cắt, không đủ để tuồn cả một dòng
// vài MB (hoặc cả nội dung nhạy cảm) lên UI.
const MALFORMED_RAW_MAX = 500

const Params = z.object({
  id: z.string().min(1).regex(SESSION_ID_RE),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
})

// Dòng 1 luôn là SessionHeader, các dòng sau là message (sessions/jsonl.ts).
function kindForLine(lineNumber: number): 'header' | 'message' {
  return lineNumber === 1 ? 'header' : 'message'
}

function toEvent(rawLine: string, lineNumber: number): SessionRawEvent {
  const bytes = Buffer.byteLength(rawLine, 'utf-8')
  try {
    const parsed: unknown = JSON.parse(rawLine)
    return { line: lineNumber, bytes, kind: kindForLine(lineNumber), data: redactDeep(parsed) }
  } catch {
    return {
      line: lineNumber,
      bytes,
      kind: 'malformed',
      raw: redactString(rawLine.slice(0, MALFORMED_RAW_MAX)),
    }
  }
}

register('sessions.listEvents', async (raw) => {
  const params = Params.parse(raw)
  const lines = await loadSessionRawLines(params.id)
  if (!lines) throw new RpcError(-32004, 'Session not found')

  const offset = params.offset ?? 0
  const limit = params.limit ?? DEFAULT_LIMIT
  // `line` là số thứ tự 1-based TRONG FILE (không phải trong trang), nên một báo cáo
  // lỗi trỏ tới đúng dòng dù người dùng đang ở trang nào.
  const events = lines.slice(offset, offset + limit).map((line, i) => toEvent(line, offset + i + 1))
  const page: SessionRawEventPage = { events, total: lines.length, offset, limit }
  return page
})
