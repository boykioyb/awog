// Toán học "token tại con trỏ" cho autocomplete `/` và `@` của Session composer
// (spec docs/features/composer-trigger-fixes.md, R-B / R-D).
//
// File THUẦN và cố ý không import gì (kể cả `import type`): test chạy nó trực tiếp
// bằng type-stripping của Node (`pnpm test:unit`), mà Node không hiểu alias `~/` và
// không tự thêm đuôi `.ts`. Chỉ dùng cú pháp xoá được — không `enum`/`namespace`.
//
// `caret` ở mọi hàm là con trỏ THU GỌN. Vùng chọn khác rỗng ⇒ "không có token" là
// việc của composer (util không biết `selectionEnd`).

export type TextEdit = { text: string; caret: number }
// start = vị trí ký tự `@`, end = exclusive (hết dãy ký tự token sau con trỏ).
export type MentionToken = { start: number; end: number; query: string }

// Nguồn DUY NHẤT của lớp ký tự token mention. `:` nằm trong lớp để `@wiki:…` /
// `@skill:…` vẫn là một token khi người dùng gõ tiếp (ADR 0073). `\w` chỉ ASCII là
// cố ý (E16) — đừng đổi sang Unicode.
const MENTION_TRIGGER = /(^|\s)@([\w./:-]*)$/
const MENTION_TAIL = /^[\w./:-]*/
const SLASH_HEAD = /^\/(\S*)\s?([\s\S]*)$/

// R-D3 / R-D5: chỉ space và tab được tái dùng làm khoảng trắng đuôi. Xuống dòng thì
// không — con trỏ không được nhảy xuống dòng sau.
const isInlineSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t'

// R-B1/R-B2: từ khoá lọc của menu `/` (chưa lowercase), hoặc `null` khi con trỏ không
// nằm trong token lệnh đầu tin. Con trỏ đứng trước `/` (caret 0) không tính là trong
// token; `''` nghĩa là vừa gõ `/` trơn.
export function slashTokenAt(draft: string, caret: number): string | null {
  if (!draft.startsWith('/') || caret < 1) return null
  const head = draft.slice(0, caret)
  if (/\s/.test(head)) return null
  return head.slice(1)
}

// R-B6: cuối token đầu tin = vị trí khoảng trắng đầu tiên, không có ⇒ hết draft.
export function slashTokenEnd(draft: string): number {
  const i = draft.search(/\s/)
  return i < 0 ? draft.length : i
}

// Tách token đầu tin (không `/`) khỏi phần còn lại, ăn tối đa MỘT khoảng trắng ngay
// sau token (kể cả xuống dòng — E13, cùng ngữ nghĩa `^\/\S*\s?` cũ của applySlash).
// Chạy trên draft THÔ, không trim. `null` khi draft không bắt đầu `/`.
export function slashHead(draft: string): { name: string; rest: string } | null {
  const m = SLASH_HEAD.exec(draft)
  if (!m) return null
  return { name: m[1] ?? '', rest: m[2] ?? '' }
}

// R-B4: thay token đầu tin bằng `/<label> `, giữ nguyên phần còn lại, con trỏ ngay sau
// khoảng trắng chèn kèm. Không `trimEnd()` như công thức cũ: nó cắt khoảng trắng đuôi
// người dùng muốn giữ; tin gửi đi không đổi vì parseSlashInvocation tự trim (AC-R1).
export function replaceSlashToken(draft: string, label: string): TextEdit {
  const rest = slashHead(draft)?.rest ?? draft
  return { text: `/${label} ${rest}`, caret: label.length + 2 }
}

// R-D1/R-D4: token mention tại con trỏ. Từ khoá = phần TRƯỚC con trỏ; vùng token kéo
// tiếp qua mọi ký tự cùng lớp SAU con trỏ, để chọn mục thì thay trọn token thay vì để
// lại mảnh vụn (`@wiki:arch|itecture` → không còn `itecture`).
export function mentionTokenAt(draft: string, caret: number): MentionToken | null {
  const m = MENTION_TRIGGER.exec(draft.slice(0, caret))
  if (!m) return null
  const query = m[2] ?? ''
  const tail = MENTION_TAIL.exec(draft.slice(caret))?.[0] ?? ''
  return { start: caret - query.length - 1, end: caret + tail.length, query }
}

// R-D2/R-D3: thay vùng token bằng `@<insert>`. Ký tự ngay sau vùng là space/tab ⇒ tái
// dùng nó (không bao giờ ra hai space liền); còn lại ⇒ chèn một space. Con trỏ luôn
// đứng SAU một khoảng trắng nên regex trigger không khớp lại và menu không bật lại.
export function replaceMention(draft: string, token: MentionToken, insert: string): TextEdit {
  const head = `${draft.slice(0, token.start)}@${insert}`
  const after = draft.slice(token.end)
  const text = isInlineSpace(draft[token.end]) ? head + after : `${head} ${after}`
  return { text, caret: head.length + 1 }
}

// R-D5: gỡ vùng token (cho `@page`), kèm đúng một space/tab ngay sau nếu có để không
// còn hai khoảng trắng liền. Con trỏ về vị trí `@` cũ.
export function removeMention(draft: string, token: MentionToken): TextEdit {
  const cut = token.end + (isInlineSpace(draft[token.end]) ? 1 : 0)
  return { text: draft.slice(0, token.start) + draft.slice(cut), caret: token.start }
}
