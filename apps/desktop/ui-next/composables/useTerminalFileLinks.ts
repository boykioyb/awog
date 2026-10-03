import type { IBufferLine, IDisposable, Terminal } from '@xterm/xterm'
import { filePathOf, PATH_TOKEN_RE } from './useFilePreview'

// Bấm một file path in trong output của terminal/CLI → mở shared PreviewModal.
// Khuôn của `useMdFileLink` (click link trong markdown) nhưng cho buffer xterm:
// không có anchor tag nên tự cung cấp ILinkProvider quét từng dòng hiển thị.
//
// Chiến lược match hai tầng — regex rộng + gate chặt:
//   1. PATH_TOKEN_RE bắt mọi "run" ký tự-path kết thúc bằng `.<ext>` (kể cả
//      `foo.ts:12:3`) — cố ý LỎNG vì terminal output dạng gì cũng có.
//   2. `filePathOf()` (cùng gate với transcript link) lọc lại: extension đóng,
//      không scheme, không khoảng trắng, không version `1.2.3`, không `..` —
//      nên `array.map`, `http://a.com/f.png`, `v1.2` không thành link giả.
//   3. Click → `open()` của caller (filePreview.open → matchPath qua file index
//      + PreviewModal). Path tuyệt đối trong root hay tương đối đều resolve.
//
// Provider trả link CÓ THỂ không tồn tại trên đĩa (gate là shape-only, như
// transcript) — click lúc đó PreviewModal hiện "could not load" thay vì im lặng.

// PATH_TOKEN_RE (useFilePreview): run ký tự-path (cho phép unicode chữ/số/mark —
// tên file tiếng Việt/Nhật) kết thúc bằng `.<ext>` + tuỳ chọn `:line(:col)`. Cố ý
// không chứa `:`/`\\`/khoảng trắng trong token chính — `http://` tự tách ở `:`,
// validation loại phần còn lại.

// Cell x của một offset STRING trong line (getCell đếm theo cell — CJK/emoji rộng
// 2 cell lệch với index chuỗi JS; nếu không map, gạch chân link lệch vài ô).
function cellXForOffset(line: IBufferLine, strOffset: number): number {
  let chars = 0
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x)
    if (!cell) break
    const w = cell.getChars().length
    if (chars + w > strOffset) return x + 1 // range.x của ILink là 1-based
    chars += w
  }
  return line.length
}

// Link đã tính cho một dòng: cell range (theo y thật lúc trả) + text. ILink
// objects KHÔNG được cache (xterm mutate decorations trên chúng) — cache chỉ giữ
// phần scan, object dựng lại mỗi lần trả là rẻ.
interface ScannedLink {
  sx: number
  ex: number
  text: string
}
const LINK_SCAN_CACHE_MAX = 512

export function registerTerminalFileLinks(
  term: Terminal,
  open: (path: string) => void,
): IDisposable {
  // xterm gọi provideLinks cho MỌI dòng đang hiển thị ở MỖI repaint — một TUI
  // redraw full-screen liên tục (claude/codex) sẽ chạy regex hàng chục dòng mỗi
  // frame nếu không cache. Key = text của dòng (trùng text ⇒ trùng cell layout,
  // trừ trường hợp ambiguous-width hiếm gặp — chấp nhận). LRU trần nhỏ đủ phủ
  // viewport; cũng tự xoá theo scrollback churn.
  const cache = new Map<string, ScannedLink[]>()

  const scan = (line: IBufferLine, text: string): ScannedLink[] => {
    const hit = cache.get(text)
    if (hit) {
      // LRU touch: xoá + set lại đẩy về cuối.
      cache.delete(text)
      cache.set(text, hit)
      return hit
    }
    const out: ScannedLink[] = []
    for (const m of text.matchAll(PATH_TOKEN_RE)) {
      const raw = m[0]
      const start = m.index ?? 0
      // `://` scheme (http://x/f.png) — token ta chỉ ôm phần sau `:`, loại bằng
      // ký tự đứng trước.
      if (text[start - 1] === ':') continue
      if (!filePathOf(raw)) continue
      out.push({
        sx: cellXForOffset(line, start),
        ex: cellXForOffset(line, start + raw.length - 1),
        text: raw,
      })
    }
    cache.set(text, out)
    if (cache.size > LINK_SCAN_CACHE_MAX) cache.delete(cache.keys().next().value!)
    return out
  }

  return term.registerLinkProvider({
    provideLinks(y, cb) {
      const line = term.buffer.active.getLine(y - 1)
      if (!line) return cb(undefined)
      const text = line.translateToString(true)
      if (!text.includes('.')) return cb(undefined) // fast path: không có dấu chấm
      const scanned = scan(line, text)
      if (!scanned.length) return cb(undefined)
      cb(
        scanned.map((s) => ({
          range: { start: { x: s.sx, y }, end: { x: s.ex, y } },
          text: s.text,
          activate: () => open(s.text),
        })),
      )
    },
  })
}
