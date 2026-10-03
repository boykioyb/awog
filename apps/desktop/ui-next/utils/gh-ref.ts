// Quy ước title cho việc gắn một GitHub issue/PR cụ thể (xem adr đặt tên —
// user convention): `#<n>_IS: <mô tả>` cho issue, `#<n>_PR: <mô tả>` cho pull
// request. Một nguồn parse/prefix dùng chung để board, task modal và session
// không lệch nhau.

export type GhRef = {
  kind: 'issue' | 'pr'
  number: number
  // "org/repo" khi rút được từ URL — vắng khi ref đến từ dạng `#123` trần.
  repo?: string
}

// `github.com/<org>/<repo>/(issues|pull)/<n>` — khớp URL đầy đủ; phần đuôi
// `?…`/`#…`/`/…` sau số vẫn hợp lệ (link dán kèm query/anchor).
const GH_URL_RE = /github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?=[/?#]|\s|$)/i
// Bản global (mọi kết quả + tham chiếu `https?://` đứng trước host) — dùng khi
// muốn GỠ link ra khỏi dòng title thay vì đọc ref.
const GH_URL_STRIP_RE =
  /https?:\/\/github\.com\/[\w./#?-]*\/(?:issues|pull)\/\d+[\w/?#&=.-]*|github\.com\/[\w./#?-]*\/(?:issues|pull)\/\d+[\w/?#&=.-]*/gi

// Gỡ mọi link issue/PR khỏi text (title-derivation: URL không phải mô tả).
export function stripGhLinks(text: string): string {
  return text.replace(GH_URL_STRIP_RE, ' ').replace(/\s+/g, ' ').trim()
}

// Ref đầu tiên trong một khối text (brief, tin nhắn). Trả null khi không có —
// caller giữ luồng title thường.
export function ghRefFromText(text: string): GhRef | null {
  const m = GH_URL_RE.exec(text)
  if (!m || !m[1] || !m[2] || !m[4]) return null
  return {
    kind: m[3]?.toLowerCase() === 'pull' ? 'pr' : 'issue',
    repo: `${m[1]}/${m[2]}`,
    number: Number.parseInt(m[4], 10),
  }
}

// `#123_IS:` / `#123_PR:` — prefix cố định, desc nối sau dấu cách.
export function ghTitlePrefix(ref: Pick<GhRef, 'kind' | 'number'>): string {
  return `#${ref.number}_${ref.kind === 'pr' ? 'PR' : 'IS'}:`
}

// `#123_IS: <desc>` — desc rỗng trả prefix trần (`#123_IS:`) thay vì chừa dấu
// hai chấp lơ lửng.
export function ghRefTitle(ref: Pick<GhRef, 'kind' | 'number'>, desc: string): string {
  const d = desc.trim()
  return d ? `${ghTitlePrefix(ref)} ${d}` : ghTitlePrefix(ref)
}
