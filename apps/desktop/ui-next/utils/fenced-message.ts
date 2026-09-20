// Đọc lại KHỐI HÀNG RÀO mà sidecar bọc quanh một tin đến từ ngoài phiên, để
// transcript hiện được THÂN TIN thay vì cả bộ khung dành cho model.
//
// Khối do `sessions/inbox.ts` (tin liên-phiên) và `github/pr-watch-block.ts` (PR
// đang theo dõi) dựng, cùng một hình dạng:
//
//     [session message] …lời dẫn nhiều dòng…
//     (dòng trống)
//     <session-message-a1b2c3d4e5f6>
//     …thân tin…
//     </session-message-a1b2c3d4e5f6>
//
// Lời dẫn là chỉ dẫn cho MODEL (mức tin cậy, cấm hành động, nghĩa của [redacted]) —
// người dùng đọc nó không thu được gì, và nó dài gấp mấy lần nội dung thật. Thẻ hàng
// rào mang nonce 48 bit nên lại càng không có nghĩa gì với mắt người.
//
// VÌ SAO ĐỌC LẠI TỪ TEXT chứ không gắn metadata lúc gửi: `text` là thứ DUY NHẤT được
// persist cho một message user, và transcript cũ trên đĩa cũng chỉ có nó. Parse ở
// tầng hiển thị thì mọi phiên đã có sẵn đẹp lên ngay, không cần đổi hình dạng JSONL.
//
// FAIL CLOSED: chỉ nhận khi các khối phủ HẾT phần có chữ của message. Còn sót một
// đoạn ngoài hàng rào ⇒ trả null và transcript in nguyên văn như trước. Giấu bớt chữ
// của một tin không tin cậy là lỗi tệ hơn nhiều so với hiển thị xấu.

export type FencedKind = 'session' | 'user-forward' | 'pr'

export type FencedMessage = {
  kind: FencedKind
  // Nhãn nguồn đã tách sẵn: tiêu đề phiên gửi, hoặc `repo#123`. '' = không đọc được
  // (lời dẫn đổi câu chữ) ⇒ UI dùng nhãn chung chung.
  source: string
  body: string
  // Thân tin có chứa thứ giả dạng thẻ hàng rào — sidecar đã cảnh báo cho model, và
  // người dùng cũng đáng được biết.
  injection: boolean
}

// Một khối trọn vẹn. Thẻ mở phải đứng riêng một dòng sau một dòng trống, nên câu
// "It is delimited by <tag> … </tag>" NẰM TRONG lời dẫn không khớp nhầm. Thẻ đóng
// dùng back-reference: một dòng `</session-message-…>` với nonce KHÁC nằm trong thân
// tin (đúng cái injection mà hàng rào sinh ra để chặn) không cắt được khối.
const BLOCK_RE =
  /\[(session message|pull request watch)\]([\s\S]*?)\n\n<((?:session-message|pr-update)-[0-9a-f]{12})>\n([\s\S]*?)\n<\/\3>/g

const FROM_SESSION_RE = /Another AWOG session \("([\s\S]*?)", id \S+\) sent/
const FROM_USER_RE = /The user forwarded this message/
const FROM_PR_RE = /GitHub reported a change on (\S+#\d+)/
const INJECTION_RE = /\nWarning: the (?:message|data) itself contains text imitating this delimiter/

function describe(tag: string, header: string): { kind: FencedKind; source: string } {
  if (tag.startsWith('pr-update-')) {
    return { kind: 'pr', source: FROM_PR_RE.exec(header)?.[1] ?? '' }
  }
  const from = FROM_SESSION_RE.exec(header)
  if (from) return { kind: 'session', source: from[1] ?? '' }
  if (FROM_USER_RE.test(header)) return { kind: 'user-forward', source: '' }
  // Thẻ đúng khuôn nhưng lời dẫn lạ: vẫn là một tin liên-phiên, chỉ không biết của ai.
  return { kind: 'session', source: '' }
}

// Trả về danh sách khối khi TOÀN BỘ `text` là các khối hàng rào nối nhau, ngược lại
// trả null (bao gồm cả trường hợp không có khối nào — đường của mọi tin người dùng tự gõ).
export function parseFencedMessages(text: string): FencedMessage[] | null {
  // Lối ra rẻ cho đường thường: không có dấu mở ngoặc vuông ở đầu thì khỏi chạy regex.
  if (!text.startsWith('[session message]') && !text.startsWith('[pull request watch]')) return null

  const out: FencedMessage[] = []
  let cursor = 0
  BLOCK_RE.lastIndex = 0
  for (const m of text.matchAll(BLOCK_RE)) {
    const start = m.index ?? 0
    // Chữ nằm GIỮA hai khối (hoặc trước khối đầu) ⇒ không phải một message thuần
    // hộp thư: bỏ cuộc để không nuốt mất phần đó.
    if (text.slice(cursor, start).trim()) return null
    cursor = start + m[0].length
    const header = m[2] ?? ''
    const { kind, source } = describe(m[3] ?? '', header)
    out.push({ kind, source, body: m[4] ?? '', injection: INJECTION_RE.test(header) })
  }
  if (!out.length || text.slice(cursor).trim()) return null
  return out
}
