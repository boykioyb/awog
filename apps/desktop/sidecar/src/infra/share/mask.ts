// Lớp CHE thông tin hạ tầng trước khi nội dung rời máy (mốc 6.5, spec
// `playbooks.md` §"Che thông tin trước khi ra khỏi máy").
//
// VÌ SAO ĐÂY LÀ LỚP RIÊNG, KHÔNG PHẢI `sessions/redact.ts`. Hai bộ lọc trả lời
// hai câu hỏi khác nhau:
//   · `redact.ts` — "chuỗi này có phải BÍ MẬT không?" (token, mật khẩu, PEM…).
//   · file này   — "chuỗi này có phải ĐỊNH DANH HẠ TẦNG không?" (account id, ARN,
//     endpoint nội bộ, tên bucket). Đây không phải bí mật theo nghĩa credential —
//     nó là bản đồ hạ tầng của một tổ chức, thứ vẫn phải che khi gửi ra ngoài.
// Gộp hai định nghĩa làm một là tự tạo ra định nghĩa thứ hai về "bí mật" — đúng
// thứ `.claude/rules/security.md` và ghi chú đầu `audit/export.ts` cảnh báo. Nên
// hai lớp chạy NỐI TIẾP nhau, không thay thế nhau (xem `kit.ts#applyRedact`).
//
// MẶC ĐỊNH BẬT. Spec: "Hộp xuất có chế độ che, mặc định BẬT". `maskText()` vì thế
// che khi không ai nói gì; muốn tắt phải nói tường minh `{ enabled: false }`.
//
// HAI CÔNG TẮC, KHÔNG PHẢI MỘT. `enabled` phủ account id / ARN / endpoint &
// private IP. `bucketsDomains` là công tắc RIÊNG của tên bucket + tên miền nội bộ,
// vì spec nói rõ "nhiều khi đó chính là thứ cần bàn" — có lúc người dùng cần bản
// xuất giữ nguyên tên bucket để đối chiếu mà vẫn che account id.
//
// FAIL-SAFE THEO HƯỚNG CHE THỪA. Không có nhánh nào "đoán là không nhạy cảm rồi
// cho qua": mọi luật ở đây khớp theo HÌNH DẠNG có cấu trúc (12 chữ số, `arn:`,
// dải IP riêng RFC1918, hậu tố DNS nội bộ). Hệ quả là che nhầm vài con số/host vô
// hại — chấp nhận được cho một bản xuất gửi ra ngoài, và người dùng luôn thấy
// trước bản ĐÃ che.

/** Placeholder cho endpoint nội bộ / IP riêng — nguyên văn spec. */
export const MASKED_ENDPOINT = '<endpoint nội bộ>'
/** Placeholder cho tên bucket (công tắc riêng `bucketsDomains`). */
export const MASKED_BUCKET = '<tên bucket>'
/** Placeholder cho tên miền nội bộ (cùng công tắc với bucket). */
export const MASKED_DOMAIN = '<tên miền>'

export type MaskOptions = {
  /** Che account id · ARN · endpoint/private IP. Mặc định BẬT. */
  enabled?: boolean
  /** Che tên bucket + tên miền nội bộ. Mặc định TẮT (spec: công tắc riêng). */
  bucketsDomains?: boolean
}

// ─── Account id ──────────────────────────────────────────────────────────────

// AWS account id = đúng 12 chữ số.
//
// Lookbehind chặn `[\w.-]` (không chặt giữa `i-0123456789ab`, không chặt trong
// `1.229012345678`), nhưng lookahead CHỈ chặn `\w` — cố ý KHÔNG chặn dấu chấm.
// Một account id hay đứng cuối câu ("...in account 229012345678."), và bản đầu
// của luật này để nguyên đúng ca đó: dấu chấm kết câu bị đọc thành dấu thập phân
// của một số dài hơn, nên số không bị che. Che thừa `229012345678.5` là cái giá rẻ
// hơn nhiều so với việc bỏ sót một account id vì nó đứng trước dấu chấm.
const ACCOUNT_ID_RE = /(?<![\w.-])\d{12}(?!\w)/g

/** `229012345678` → `2290********` (giữ 4 số đầu, đúng khuôn spec). */
export function maskAccountIds(text: string): string {
  return text.replace(ACCOUNT_ID_RE, (id) => `${id.slice(0, 4)}${'*'.repeat(id.length - 4)}`)
}

// ─── ARN ─────────────────────────────────────────────────────────────────────

// `arn:partition:service:region:account:resource` — bốn trường đầu không chứa
// khoảng trắng hay `:`, phần resource thì có (vd `service/checkout`,
// `role/Admin`, `log-group:/aws/ecs/x:log-stream:y`). Lớp ký tự của resource cắt
// ở dấu câu đóng để không nuốt dấu `)` hay dấu phẩy của câu văn bao quanh ARN.
const ARN_RE = /\barn:[^\s:]+:[^\s:]*:[^\s:]*:[^\s:]*:([^\s"'`<>,;)\]]+)/gi

/** Rút ARN còn `…:service/checkout` — bỏ partition/region/account, giữ resource. */
export function maskArns(text: string): string {
  return text.replace(ARN_RE, (_match, resource: string) => `…:${resource}`)
}

// ─── Endpoint nội bộ / private IP ────────────────────────────────────────────

// Dải IP riêng RFC1918 + loopback + link-local (169.254.x = metadata endpoint).
// Cổng `:5432` đi kèm cũng bị nuốt — một endpoint nội bộ trần trụi vẫn nói được
// nhiều hơn mức cần thiết.
//
// Lookahead chỉ chặn `\d`, không chặn dấu chấm — cùng lý do như `ACCOUNT_ID_RE`:
// "kết nối tới 10.0.0.5." là câu văn bình thường, và bản đầu của luật này để lại
// nguyên địa chỉ vì dấu chấm cuối câu.
const PRIVATE_IP_RE =
  /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})(?::\d{1,5})?(?!\d)/g

// Host endpoint dịch vụ AWS (`db.xxx.ap-southeast-1.rds.amazonaws.com`). CỐ Ý
// BỎ QUA host của S3 (`bucket.s3.us-east-1.amazonaws.com`, `s3.amazonaws.com`):
// tên bucket thuộc công tắc RIÊNG, nếu lớp này nuốt luôn host thì công tắc
// `bucketsDomains` không còn gì để bật/tắt.
const AWS_HOST_RE = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?\b/gi

function isS3Host(host: string): boolean {
  const labels = host.toLowerCase().split('.')
  return labels.some((label) => label === 's3' || label.startsWith('s3-'))
}

// Hậu tố DNS chỉ tồn tại bên trong một cluster/VPC: `*.internal` (gồm
// `ip-10-0-0-5.compute.internal`), `*.cluster.local`, `*.svc.cluster.local`.
const INTERNAL_HOST_RE =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:internal|cluster\.local)\b/gi

/** Endpoint nội bộ + private IP → `<endpoint nội bộ>`. */
export function maskEndpoints(text: string): string {
  return text
    .replace(PRIVATE_IP_RE, MASKED_ENDPOINT)
    .replace(AWS_HOST_RE, (host) => (isS3Host(host) ? host : MASKED_ENDPOINT))
    .replace(INTERNAL_HOST_RE, MASKED_ENDPOINT)
}

// ─── Bucket + tên miền (công tắc RIÊNG) ──────────────────────────────────────

// Bốn hình của một tham chiếu S3 gặp trong thực tế: URI, ARN, virtual-host, và
// path-style. ARN S3 phải chạy TRƯỚC `maskArns` (xem `maskText`) — sau khi ARN
// bị rút còn `…:bucket` thì không còn dấu hiệu nào nói đó là bucket nữa.
const S3_URI_RE = /\bs3:\/\/[a-z0-9][a-z0-9.-]*/gi
const S3_ARN_RE = /\barn:[^\s:]+:s3:::([a-z0-9][a-z0-9.-]*)/gi
const S3_VHOST_RE = /\b[a-z0-9][a-z0-9.-]*?\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?\b/gi
const S3_PATH_RE = /\b(s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?)\/[a-z0-9][a-z0-9.-]*/gi

// Tên miền nội bộ: TLD chỉ dùng trong mạng của tổ chức. Cố ý KHÔNG có
// `.com`/`.io`… — che cả một tên miền công khai (github.com) là phá bản xuất mà
// không che thêm gì.
const INTERNAL_DOMAIN_RE =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:local|localdomain|lan|corp|intranet|home\.arpa)\b/gi

/** Tên bucket + tên miền nội bộ → placeholder. Bật/tắt bằng `bucketsDomains`. */
export function maskBucketsAndDomains(text: string): string {
  return text
    .replace(S3_ARN_RE, (_match, _bucket: string) => `arn:s3:::${MASKED_BUCKET}`)
    .replace(S3_URI_RE, `s3://${MASKED_BUCKET}`)
    .replace(S3_VHOST_RE, `s3://${MASKED_BUCKET}`)
    .replace(S3_PATH_RE, `$1/${MASKED_BUCKET}`)
    .replace(INTERNAL_DOMAIN_RE, MASKED_DOMAIN)
}

// ─── Điểm vào ────────────────────────────────────────────────────────────────

/**
 * Chạy cả lớp che trên một chuỗi bất kỳ. Đây là ĐIỂM VÀO DUY NHẤT — mọi bề mặt
 * (Markdown, HTML, Wiki) đều đi qua nó, nên không có đường nào lọt vì một call
 * site quên một luật.
 *
 * Thứ tự có lý do, không phải tuỳ ý:
 *   1. bucket/domain TRƯỚC ARN — ARN S3 bị rút ở bước 3 thì mất dấu "đây là
 *      bucket" và công tắc riêng không còn tác dụng.
 *   2. endpoint trước ARN/account — placeholder chứa dấu cách và `<` nên không
 *      luật nào ở sau khớp nhầm vào nó (chạy ngược lại thì `<endpoint nội bộ>`
 *      có thể bị luật sau chạm vào).
 *   3. ARN trước account id — account nằm TRONG ARN bị bỏ hẳn cùng ARN, nên
 *      bước 4 chỉ còn phải lo account id đứng trần.
 */
export function maskText(text: string, opts: MaskOptions = {}): string {
  const enabled = opts.enabled ?? true
  const bucketsDomains = opts.bucketsDomains ?? false
  let out = text
  if (bucketsDomains) out = maskBucketsAndDomains(out)
  if (enabled) {
    out = maskEndpoints(out)
    out = maskArns(out)
    out = maskAccountIds(out)
  }
  return out
}
