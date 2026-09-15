// Xuất nhật ký hạ tầng (task 3.9 — phần "Xuất").
//
// HAI ĐỊNH DẠNG, HAI NGƯỜI ĐỌC KHÁC NHAU. CSV để mở bằng Excel (người không rành
// kỹ thuật vẫn lọc được "tuần này ai ghi gì"), JSONL để giữ ĐỦ trường (script,
// phân tích, đối chiếu). Vì vậy CSV **làm phẳng** những gì Excel cần và bỏ những
// gì nó không đọc được; JSONL giữ nguyên entry.
//
// NHẬT KÝ KHÔNG CHỨA SECRET, NÊN BẢN XUẤT CŨNG KHÔNG. Đây không phải một lời hứa
// suông: `recordInfraAction` đã redact TRƯỚC khi chạm đĩa (invariant #1), nên thứ
// đọc lên từ đĩa vốn đã sạch. Bản xuất không thêm bước lọc nào — thêm một lớp lọc
// thứ hai ở đây là tạo ra định nghĩa thứ hai về "bí mật", đúng thứ invariant #1
// cấm.
//
// Không hàm nào ở đây tự ghi file: nó trả về CHUỖI, và việc ghi đi qua RPC
// `fs.writeFile` đã có (`assertInsideWorkspace`, ghi nguyên tử). Một đường ghi
// thứ hai chỉ để "cho tiện" là một đường ghi thứ hai phải bảo vệ.

import type { InfraAuditEntry } from './store.js'

const CSV_COLUMNS = [
  'at',
  'actor',
  'class',
  'decision',
  'surface',
  'tool',
  'command',
  'profile',
  'accountId',
  'region',
  'exitCode',
  'durationMs',
  'estimatedUsd',
  'sessionId',
  'summary',
] as const

/**
 * Bọc một ô CSV: nhân đôi `"` rồi bọc trong `"` khi giá trị chứa ký tự nguy hiểm.
 *
 * ⚠ Chống CSV INJECTION: một ô bắt đầu bằng `=`, `+`, `-` hoặc `@` được Excel/LibreOffice
 * hiểu là CÔNG THỨC. argv trong nhật ký là dữ liệu do người dùng/agent sinh ra —
 * `aws ec2 describe-instances --filter =cmd|'/c calc'!A0` là một chuỗi hoàn toàn
 * hợp lệ và sẽ thành công thức khi mở bằng Excel. Nên tiền tố một `'` (cách Excel
 * quy ước để "giữ nguyên văn bản"), rồi mới bọc.
 */
function cell(value: string): string {
  const v = value === '' ? '' : value
  const dangerous = /^[=+\-@\t\r]/.test(v)
  const guarded = dangerous ? `'${v}` : v
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function toCsv(entries: readonly InfraAuditEntry[]): string {
  const lines: string[] = [CSV_COLUMNS.join(',')]
  for (const e of entries) {
    const ctx = e.context
    const row: Record<(typeof CSV_COLUMNS)[number], string> = {
      at: e.at,
      actor: e.actor,
      class: e.class,
      decision: e.decision,
      surface: e.surface,
      tool: e.tool,
      // Không kèm tên binary: nó là hằng số với `aws`, và cột này đã chật.
      command: e.argv.join(' '),
      profile: ctx.profile ?? '',
      accountId: ctx.accountId ?? '',
      region: ctx.region ?? '',
      exitCode: e.result.exitCode === undefined ? '' : String(e.result.exitCode),
      durationMs: e.result.durationMs === undefined ? '' : String(e.result.durationMs),
      estimatedUsd: e.cost?.estimatedUsd === undefined ? '' : String(e.cost.estimatedUsd),
      sessionId: e.sessionId ?? '',
      summary: e.result.summary ?? '',
    }
    lines.push(CSV_COLUMNS.map((c) => cell(row[c])).join(','))
  }
  return `${lines.join('\n')}\n`
}

export function toJsonl(entries: readonly InfraAuditEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
}

export type ExportFormat = 'csv' | 'jsonl'

export function renderExport(
  entries: readonly InfraAuditEntry[],
  format: ExportFormat,
): string {
  return format === 'csv' ? toCsv(entries) : toJsonl(entries)
}

/** Tên file gợi ý: ổn định, không dấu, không phụ thuộc locale. */
export function exportFilename(format: ExportFormat, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `infra-audit-${stamp}.${format}`
}
