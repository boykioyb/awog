// Phép lọc DUY NHẤT cho `homepage` của một template — trang chủ do người xuất
// bản tự khai, và UI biến nó thành MỘT CÚ BẤM mở trình duyệt hệ thống.
//
// Sống ở module riêng vì có HAI đường phải dùng chung đúng một luật:
//   danh mục   — `marketplace.ts` lọc lúc parse + lúc đọc cache;
//   bản đã cài — `install-meta.ts` lọc lúc GHI và lúc ĐỌC `.install.json`.
// Để hàm ở `marketplace.ts` thì `install-meta.ts` phải import ngược lên nó (mà
// `marketplace.ts` đang import `install-meta.ts`) ⇒ vòng import. Tách ra là cách
// giữ đúng một nguồn luật mà không tạo vòng — KHÔNG chép luật ra chỗ thứ hai.

import { ssrfCheck } from '../mcp/http-client.js'
import { log } from '../util/logger.js'

// `homepage` không cài gì nên không đi qua `bundleUrlProblem` (luật đó ghim
// github.com + dạng `/tree/`), nhưng vẫn là L1 y hệt: một `javascript:`/`data:`/
// `file:` lọt tới UI là cái bẫy nằm chờ được bấm.
//
// Ở đây cũng chỉ viết đúng MỘT luật của riêng danh mục — "https", cùng điều kiện
// `bundleUrlProblem` áp cho `url`. Phần còn lại (scheme thực thi được, loopback,
// IP nội bộ) hỏi thẳng `ssrfCheck` — đúng hàm mọi lối ra mạng của sidecar đang
// dùng — thay vì chép luật ra chỗ thứ hai.
export function homepageProblem(url: string): string | null {
  const guard = ssrfCheck(url)
  // `reason` là optional trên `SsrfGuardResult` — không có thì vẫn phải loại.
  if (!guard.ok) return guard.reason ?? 'not a safe link'
  // `ssrfCheck` còn nhận http; danh mục AWOG tự tuyển thì không có cớ nào để một
  // trang chủ rơi xuống http. `new URL` không thể ném ở đây: `ssrfCheck` vừa parse.
  return new URL(url).protocol === 'https:' ? null : 'homepage must be https'
}

// Homepage hỏng KHÔNG giết entry (cũng không giết bản cài) — nó là siêu dữ liệu
// phụ, không phải thứ đem cài. Chỉ RỤNG RIÊNG cái field, phần còn lại vẫn dùng
// được bình thường (nhưng có log: người xuất bản khai sai thì phải tra được).
export function safeHomepage(from: string, id: string, raw?: string): string | undefined {
  if (!raw) return undefined
  const url = raw.trim()
  const problem = homepageProblem(url)
  if (!problem) return url
  log.warn('templates: catalog entry homepage dropped — not a safe link', {
    from,
    entry: id,
    homepage: raw,
    reason: problem,
  })
  return undefined
}
