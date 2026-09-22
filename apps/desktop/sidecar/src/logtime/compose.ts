// "Soạn bằng AI" — biến việc AWOG ĐO ĐƯỢC trong ngày thành dòng công nháp bằng một
// lượt gọi model. Module này THUẦN: dựng prompt + parse kết quả. Việc gom dữ liệu (phiên
// / task / đã khai / dự án nối) và gọi model nằm ở `methods/logtime.compose.ts`.
//
// ⚠ Khác `suggestions.ts`: gợi ý bị động cố ý KHÔNG mang `hours`. Compose là hành động
// NGƯỜI DÙNG chủ động gọi và duyệt, nên model ĐƯỢC đề xuất `hours` — nhưng dòng nhận về
// vẫn là NHÁP đi qua cổng `addEntry`, và đẩy PMS vẫn là bước riêng có xác nhận. Model
// KHÔNG bao giờ tự đẩy, và KHÔNG được bịa `projectKey` ngoài tập đã nối.

import type { LogtimeComposeLine } from '../types/shared.js'

// Một việc đo được, đã tra sẵn nhãn cho model đọc.
export interface ComposeContextItem {
  kind: 'session' | 'task'
  // Tag ngắn ("P1"/"P2") mà model echo lại — KHÔNG đưa projectKey thật (id `prj-…`)
  // cho model vì nó chưa từng thấy id đó; tag map ngược sang key ở `parseComposeLines`.
  projectTag: string
  projectLabel: string
  title: string
  // "2h15" — khoảng THỜI GIAN việc tồn tại, KHÔNG phải công sức. Nhãn để model tham
  // khảo, không phải con số bắt buộc dùng.
  elapsedLabel: string
  issue?: number | undefined
  // PR số — model được dặn để "(PR #N)" trong note, KHÔNG dùng làm issue auto-link.
  pr?: number | undefined
  // Trích nội dung thực (digest ngắn) để model viết note CỤ THỂ thay vì diễn giải lại
  // tiêu đề. Vắng ⇒ chỉ có tiêu đề.
  detail?: string | undefined
}

// Một dòng ĐÃ khai của ngày — cho model biết để không soạn trùng.
export interface ComposeLoggedItem {
  projectLabel: string
  note: string
  hours: number
}

// Một dự án đã nối, kèm tag để model tham chiếu. `key` là `Project.id` thật (không lộ
// cho model qua context — chỉ dùng ở server để map ngược).
export interface ComposeProject {
  tag: string
  key: string
  label: string
}

export interface ComposePromptInput {
  date: string
  budgetHours: number
  roundStep: number
  items: ComposeContextItem[]
  logged: ComposeLoggedItem[]
  // Dự án đã nối (tag ↔ nhãn) — dòng "dự án" trong context liệt kê "P1 = YAHAGI 168".
  projects: ComposeProject[]
  sourceName: string
}

// "2h15" từ mili-giây. Dưới một phút thì "0h". Không làm tròn — đây là số thô để model
// nhìn, việc kéo về bậc 0.5h là của model theo hướng dẫn trong prompt.
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0h'
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

// Khối `<logtime_context>` — đúng hình bản phác: từng việc kèm nhãn nguồn + thời lượng,
// các dòng đã khai, và danh sách dự án đã nối. Đây là NGỮ CẢNH cho model, không phải
// dữ liệu đẩy đi đâu.
export function buildComposeContext(input: ComposePromptInput): string {
  const lines: string[] = []
  lines.push(`<logtime_context date="${input.date}" budget="${input.budgetHours.toFixed(1)}">`)
  for (const it of input.items) {
    const kind = it.kind === 'session' ? 'phiên' : 'tác vụ'
    const issue = it.issue !== undefined ? ` #${it.issue}` : ''
    const pr = it.pr !== undefined ? ` (PR #${it.pr})` : ''
    // "[P1 YAHAGI 168]" — model echo lại tag P1, KHÔNG phải id thật.
    lines.push(
      `  ${kind}  ${it.title}${issue}${pr}  ${it.elapsedLabel}  [${it.projectTag} ${it.projectLabel}]`,
    )
    // Nội dung thực (nếu đọc được) thụt dòng dưới việc — để model viết note bám vào đó.
    if (it.detail) {
      for (const line of it.detail.split('\n')) lines.push(`      ${line}`)
    }
  }
  if (input.logged.length === 0) {
    lines.push('  đã ghi  (chưa có dòng nào)')
  } else {
    for (const l of input.logged) {
      lines.push(`  đã ghi  ${l.projectLabel} · ${l.hours}h · ${l.note}`)
    }
  }
  const projectList = input.projects.map((p) => `${p.tag} = ${p.label}`).join(' · ')
  lines.push(`  dự án  ${projectList}  (đã nối ${input.sourceName})`)
  lines.push('</logtime_context>')
  return lines.join('\n')
}

export function buildComposeSystemPrompt(): string {
  return [
    'Bạn soạn giúp một kỹ sư phần mềm các dòng công (worklog) cho MỘT ngày, dựa trên',
    'việc mà công cụ AWOG tự đo được (phiên chat và tác vụ trong ngày).',
    '',
    'Quy tắc:',
    '- CHỈ dùng các dự án có trong context, tham chiếu bằng TAG của nó (ví dụ "P1").',
    '  Không bịa dự án, không trả tên dự án — chỉ trả tag.',
    '- Gộp các việc cùng dự án + cùng bản chất thành một dòng khi hợp lý; note một câu',
    '  ngắn, đúng như nó sẽ hiện trên hệ PMS của công ty (tiếng Việt).',
    '- Viết theo hướng NGHIỆP VỤ (kiểu backlog refinement): nói yêu cầu/chức năng nghiệp',
    '  vụ nào được xử lý và CÁCH TIẾP CẬN ở mức nghiệp vụ (làm rõ/phân tích/thống nhất).',
    '  KHÔNG nêu chi tiết kỹ thuật (tên file, hàm/biến, câu lệnh, code, tên bảng/cột).',
    '  Khi việc có phần nội dung (thụt dòng bên dưới), đọc để hiểu rồi diễn đạt theo nghiệp',
    '  vụ — KHÔNG viết chung chung kiểu "xử lý yêu cầu #192"/"lập kế hoạch triển khai".',
    '- Đề xuất số giờ đã LÀM TRÒN LÊN theo bậc được cho, và cố gắng cho TỔNG khớp mức',
    '  giờ mỗi ngày (budget). Thời lượng đo được chỉ là tham khảo — nó đo thời gian việc',
    '  tồn tại, không đo công sức.',
    '- Nếu context có số issue, đưa vào trường issue; KHÔNG nhét link PR vào (API worklog',
    '  chỉ auto-link được issue). Link PR nếu cần thì để trong note.',
    '',
    'Trả về DUY NHẤT một mảng JSON, không kèm giải thích, không bọc markdown. Mỗi phần tử:',
    '{"project": "<tag, ví dụ P1>", "hours": <số>, "note": "<một câu tiếng Việt>",',
    '"issue": <số hoặc bỏ trống>}',
  ].join('\n')
}

export function buildComposeUserPrompt(input: ComposePromptInput): string {
  return [
    buildComposeContext(input),
    '',
    `Soạn các dòng công cho ngày ${input.date} sao cho tổng xấp xỉ ${input.budgetHours.toFixed(1)}h,`,
    `mỗi dòng làm tròn lên bậc ${input.roundStep}h. Tham chiếu dự án bằng tag. Chỉ trả mảng JSON.`,
  ].join('\n')
}

// ── Tóm tắt MỘT dòng ──────────────────────────────────────────────────────────
// Khi bấm "Đưa vào form" ở một gợi ý: viết lại tiêu đề thô (có thể tiếng Nhật/Anh,
// hoặc chỉ là số issue) thành một câu note tiếng Việt gọn, đúng như nó sẽ hiện trên
// PMS. Chỉ chữ NOTE — số issue đã biết từ gợi ý nên không cần model rút lại.
export interface LineSummaryInput {
  title: string
  projectLabel?: string | undefined
  issue?: number | undefined
  pr?: number | undefined
  kind: 'session' | 'task'
  // Trích NỘI DUNG thực của phiên/tác vụ (câu hỏi đầu + kết quả cuối) để model viết
  // note CỤ THỂ thay vì diễn giải lại tiêu đề. Vắng ⇒ chỉ có tiêu đề như cũ.
  detail?: string | undefined
  // Nháp NGƯỜI DÙNG tự gõ ("review PR 590") — model khai thác/mở rộng theo đúng hướng
  // đó thành note nghiệp vụ đầy đủ (dựa thêm vào detail nếu có). Đây là "Sửa bằng AI".
  seed?: string | undefined
}

export function buildLineSummarySystemPrompt(): string {
  return [
    'Bạn viết note worklog cho một kỹ sư phần mềm, theo hướng NGHIỆP VỤ (kiểu backlog',
    'refinement). Cho tiêu đề + (nếu có) trích nội dung thực của phiên, hãy viết MỘT câu',
    'tiếng Việt mô tả: yêu cầu/chức năng NGHIỆP VỤ nào được xử lý và CÁCH TIẾP CẬN ở mức',
    'nghiệp vụ (làm rõ/định nghĩa/phân tích/thống nhất cái gì).',
    '',
    'KHÔNG đi vào chi tiết KỸ THUẬT triển khai: không nêu tên file, tên hàm/biến, câu lệnh,',
    'đoạn code, tên bảng/cột kỹ thuật. Nói "làm gì cho nghiệp vụ", KHÔNG nói "sửa code thế nào".',
    'Cũng KHÔNG viết chung chung kiểu "xử lý yêu cầu #192"/"lập kế hoạch triển khai".',
    '',
    'Ví dụ TỐT: "Làm rõ và thống nhất quy tắc xuất mã tỉnh theo chuẩn JIS cho màn danh sách".',
    'Ví dụ XẤU (quá kỹ thuật): "Sửa hàm exportCsv thêm cột ken_cd, cập nhật migration".',
    'Ví dụ XẤU (quá chung): "Xử lý yêu cầu #594".',
    '',
    'Chỉ trả về ĐÚNG một câu note, không giải thích, không dấu ngoặc, không xuống dòng.',
    'Giữ mã issue/PR (ví dụ #192) trong câu nếu có. Bám nội dung thật, không bịa.',
  ].join('\n')
}

export function buildLineSummaryUserPrompt(input: LineSummaryInput): string {
  const kind = input.kind === 'session' ? 'phiên làm việc' : 'tác vụ'
  const parts = [`Loại: ${kind}`]
  if (input.projectLabel) parts.push(`Dự án: ${input.projectLabel}`)
  if (input.issue !== undefined) parts.push(`Issue: #${input.issue}`)
  if (input.pr !== undefined) parts.push(`Pull request: #${input.pr} (nhắc "(PR #${input.pr})" trong câu)`)
  parts.push(`Tiêu đề: ${input.title}`)
  if (input.detail) {
    parts.push('', 'Nội dung (đọc để hiểu việc, rồi viết note theo hướng nghiệp vụ):', input.detail)
  }
  if (input.seed) {
    parts.push(
      '',
      `Bản nháp người dùng gõ: "${input.seed}"`,
      'Khai thác/mở rộng đúng theo hướng bản nháp này (dựa thêm vào Nội dung nếu có),',
      'giữ đúng ý người dùng, viết thành note nghiệp vụ đầy đủ hơn.',
    )
  }
  parts.push('', 'Viết một câu note tiếng Việt theo hướng nghiệp vụ (không chi tiết kỹ thuật).')
  return parts.join('\n')
}

// Trích nội dung một phiên thành đoạn ngắn cho model: câu HỎI đầu (user muốn gì) +
// KẾT QUẢ cuối (agent làm xong gì). Đủ để viết note cụ thể mà không nhồi cả transcript
// (tốn token + phần lớn là tool/log). Cắt mỗi phần theo `cap`, bỏ tin rỗng.
export function buildSessionDigest(
  messages: { role: string; text: string }[],
  cap = 1400,
): string {
  const clip = (s: string): string => {
    const t = s.trim().replace(/\s+/g, ' ')
    return t.length > cap ? `${t.slice(0, cap)}…` : t
  }
  const firstUser = messages.find((m) => m.role === 'user' && m.text.trim().length > 0)
  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent' && m.text.trim().length > 0)
  const out: string[] = []
  if (firstUser) out.push(`Yêu cầu: ${clip(firstUser.text)}`)
  if (lastAgent && lastAgent !== firstUser) out.push(`Kết quả: ${clip(lastAgent.text)}`)
  return out.join('\n')
}

// Model có thể trả kèm ngoặc kép / xuống dòng dù đã dặn. Lấy dòng đầu không rỗng, bỏ
// ngoặc bao, cắt độ dài. Rỗng ⇒ null để caller lùi về tiêu đề gốc (không để trống form).
export function parseLineSummary(text: string): string | null {
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first) return null
  const unquoted = first.replace(/^["'“”]+|["'“”]+$/g, '').trim()
  return unquoted ? unquoted.slice(0, 500) : null
}

// Cắt lấy MẢNG JSON trong chuỗi model trả. Model có thể bọc ```json, thêm lời dẫn, hoặc
// bọc mảng trong một object `{ "lines": [...] }` — thử cả hai. Không ra mảng thì null.
function extractJsonArray(text: string): unknown[] | null {
  // Ưu tiên mảng ngoài cùng.
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(arr)) return arr
    } catch {
      /* thử tiếp dạng object */
    }
  }
  // Object bọc: { "lines": [...] } / { "worklog": [...] } …
  const objStart = text.indexOf('{')
  const objEnd = text.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    try {
      const obj = JSON.parse(text.slice(objStart, objEnd + 1)) as Record<string, unknown>
      for (const v of Object.values(obj)) if (Array.isArray(v)) return v
    } catch {
      /* rơi xuống null */
    }
  }
  return null
}

// Trần cứng của `worklog_create` (hours 0.25–24). Cùng biên với store.
const MIN_HOURS = 0.25
const MAX_HOURS = 24
const MAX_NOTE = 2000

export interface ParseResult {
  lines: LogtimeComposeLine[]
  // Model trả gì đó nhưng không parse ra mảng nào. Caller phân biệt "không parse được"
  // với "parse được nhưng 0 dòng hợp lệ".
  parsed: boolean
}

// Lọc + kẹp về dòng an toàn. `tagToKey` map tag model echo ("P1") → projectKey thật;
// cũng chấp nhận nếu model lỡ trả thẳng projectKey đúng. Dòng có dự án ngoài tập đã
// nối, hoặc giờ không hợp lệ, bị BỎ — thà thiếu một dòng còn hơn dựng dòng không đẩy được.
export function parseComposeLines(text: string, tagToKey: Map<string, string>): ParseResult {
  const raw = extractJsonArray(text)
  if (!raw) return { lines: [], parsed: false }

  const validKeys = new Set(tagToKey.values())
  const lines: LogtimeComposeLine[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    // Model được dặn trả `project` = tag; nhưng nhận cả `projectKey` phòng khi nó trả
    // thẳng key. Tag tra map trước, không thì thử coi giá trị là key thật.
    const ref = typeof rec.project === 'string' ? rec.project : ''
    const rawKey = typeof rec.projectKey === 'string' ? rec.projectKey : ''
    const projectKey = tagToKey.get(ref) ?? tagToKey.get(rawKey) ?? (validKeys.has(rawKey) ? rawKey : '')
    if (!projectKey) continue
    const hours = Number(rec.hours)
    if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS) continue
    const note = typeof rec.note === 'string' ? rec.note.trim().slice(0, MAX_NOTE) : ''
    if (!note) continue
    const issueNum = Number(rec.issue)
    const issue = Number.isInteger(issueNum) && issueNum > 0 ? issueNum : undefined
    lines.push({ projectKey, note, hours, ...(issue !== undefined ? { issue } : {}) })
  }
  return { lines, parsed: true }
}
