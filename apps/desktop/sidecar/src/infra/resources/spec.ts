// Khuôn khai báo một VIEW của Explorer (Mốc 3, task 3.1 + 3.2).
//
// VÌ SAO LÀ KHUÔN KHAI BÁO. `infra-explorer.md` chốt: "thêm một dịch vụ mới =
// thêm một file mô tả, không đụng khung". Nghĩa là bảng, tìm kiếm, lọc, phân
// trang, virtual scroll, empty/error state phải viết MỘT lần; mỗi service chỉ
// còn khai: lệnh `list-*` nào, JSON trả về cắt thành dòng thế nào, hai bộ cột,
// và vài hành động ngày-2.
//
// BA LUẬT KHÔNG ĐƯỢC PHÁ Ở TẦNG NÀY
//   1. `args` là MẢNG. Khuôn chỉ sinh ra argv, không bao giờ sinh chuỗi shell —
//      nên không có `|`, `&&`, `$(…)`. Việc chèn ngữ cảnh (`--profile`/`--region`)
//      vẫn thuộc `infra/run.ts` như mọi bề mặt khác.
//   2. Placeholder `{key}` chỉ thay được bằng giá trị do RPC xác thực: độ dài có
//      trần và KHÔNG được bắt đầu bằng `-`. Một giá trị bắt đầu bằng `-` sẽ bị
//      CLI đọc thành CỜ, tức renderer tự biến dữ liệu thành quyền — đúng thứ mà
//      luật "ngữ cảnh do sidecar chèn" sinh ra để chặn.
//   3. Nhãn là KHOÁ i18n, không phải câu tiếng Việt. Sidecar không biết ngôn ngữ
//      của người dùng, và `infra.tasks.md` bắt mỗi màn mới phải có key en/vi
//      trong cùng PR — nhãn cứng ở đây sẽ phá đúng luật đó.
//
// `pick` nhận `unknown` và phải TỰ PHÒNG VỆ: CLI trả JSON theo phiên bản, một
// trường đổi tên là cả bảng trắng. Vì vậy mọi lối vào đều đi qua `asObj`/`asArray`/
// `str`, không có `as any` và không có truy cập thuộc tính trực tiếp.

import type { InfraCommandClass } from '../types.js'

/** Một cột của bảng. `label` là khoá i18n (`infra.explorer.col.*`). */
export type InfraColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
  /** Trần hiển thị gợi ý (px) — bảng vẫn tự co theo chỗ trống. */
  width?: string
  /** Giá trị dài: cắt bằng ellipsis + `title` để rê chuột đọc được cả chuỗi. */
  wide?: boolean
}

/** Một dòng dữ liệu. Giá trị luôn là chuỗi ĐÃ định dạng — bảng không tự đoán. */
export type InfraRow = Record<string, string>

/**
 * Hành động ngày-2 trên MỘT dòng (start/stop/delete…).
 *
 * `consequence` là câu TIẾNG NGƯỜI hiện ĐẦU TIÊN trong hộp xác nhận (ADR 0088 §5:
 * "hậu quả trước, lệnh sau"). `confirm: 'type-name'` là của lớp phá huỷ — người
 * dùng phải gõ lại đúng giá trị `typeNameKey` của dòng.
 */
export type InfraRowAction = {
  id: string
  label: string
  consequence: string
  danger: boolean
  confirm: 'none' | 'simple' | 'type-name'
  /**
   * Tên hành động IAM thật mà lệnh này cần (vd `ec2:TerminateInstances`). Dùng
   * cho bước DÒ QUYỀN lúc mở màn (task 3.3): `probe.actions` hỏi AWS một lượt
   * nhiều action, rồi UI cần biết action nào ứng với nút nào để ẩn ĐÚNG nút.
   * Suy từ `args` được nhưng mong manh (một cờ mới là suy sai), nên khai tường
   * minh ở đây — chỗ duy nhất biết lệnh này thật sự làm gì.
   */
  iam?: string
  /** Mẫu argv; `{key}` lấy từ chính dòng đó. */
  args: readonly string[]
  typeNameKey?: string
  /**
   * Ô nhập THÊM của hành động trên một dòng (Mốc 4: tạo CloudFront invalidation
   * cần thêm danh sách đường dẫn; duyệt một bước pipeline cần thêm lời nhắn).
   *
   * Vì sao không phải form cấp VIEW: form cấp view không biết dòng nào đang được
   * chọn, nên nó buộc người dùng GÕ LẠI id của đối tượng họ vừa bấm — chép tay
   * một giá trị đã nằm trên màn là chỗ để gõ sai, và gõ sai ở đây nghĩa là lệnh
   * đó nhắm vào tài nguyên khác. Có `fields` thì form mở ra với ngữ cảnh của dòng
   * đã điền sẵn; renderer vẫn không tự đặt giá trị nào (xem `execute.ts`).
   */
  fields?: readonly InfraFormField[]
  /** Ghi đè lớp lệnh khi `classify()` không đọc được ngữ nghĩa thật của lệnh. */
  class?: InfraCommandClass
  /**
   * Có mặt ⇒ `args` KHÔNG chứa đích ghi; `execute.ts` tự ghép đường dẫn trong
   * cache của sidecar rồi nối vào cuối argv. Nhờ vậy renderer không bao giờ đặt
   * tên file, và `classify` nâng `get-object` lên `read` được một cách chắc chắn.
   */
  download?: InfraDownloadSpec
  /**
   * Hành động KHÔNG chạy lệnh nào — nó mở một VIEW CON với tham số lấy từ chính
   * dòng đang chọn (Mốc 4: CloudFront → lịch sử xoá bộ nhớ đệm, Route 53 → bản
   * ghi của một zone).
   *
   * Vì sao khai ở đây thay vì để UI tự biết: "bấm dòng này thì đi đâu" là kiến
   * thức về DỊCH VỤ, đúng chỗ của file mô tả view — cùng lý do với `consoleUrl`.
   * `values` ánh xạ `tên tham số của view con` → `khoá trên dòng`, nên UI không
   * tự đặt giá trị và view con vẫn nhận đúng thứ nó khai là bắt buộc.
   *
   * Hành động này KHÔNG qua cổng quyền vì không có gì để chạy; view con tự đi
   * qua cổng khi nó gọi CLI.
   */
  opensView?: { viewId: string; values: Readonly<Record<string, string>> }
}

/** Một trường của form nhỏ (tạo bucket/folder, upload, presign). */
export type InfraFormField = {
  key: string
  label: string
  placeholder?: string
  required?: boolean
  /**
   * Trường nhận NHIỀU giá trị trong một ô (`--paths /index.html /assets/*`).
   * Giá trị được tách theo khoảng trắng/dấu phẩy thành nhiều token argv, và luật
   * "token không được bắt đầu bằng `-`" được kiểm cho TỪNG token — nếu không thì
   * một ô nhập tự do biến thành chỗ chèn cờ (xem `buildArgs`).
   */
  list?: boolean
}

/** Form nhỏ ở cấp VIEW (không gắn với dòng nào) — "tạo mới chỉ ở nơi là form nhỏ". */
export type InfraViewForm = {
  id: string
  label: string
  consequence: string
  danger: boolean
  confirm: 'none' | 'simple' | 'type-name'
  /** Tên hành động IAM — cùng lý do với `InfraRowAction.iam`. */
  iam?: string
  /** Trường mà người dùng phải gõ lại khi `confirm: 'type-name'`. */
  typeNameField?: string
  fields: readonly InfraFormField[]
  args: readonly string[]
  class?: InfraCommandClass
  /**
   * Suy thêm giá trị từ những gì người dùng gõ TRƯỚC khi thay vào `args`. Có mặt
   * vì một số ràng buộc là của AWS chứ không phải của form: `put-object` tạo
   * "thư mục" bằng một key RỖNG kết thúc bằng `/`, nên ô nhập `logs` phải thành
   * `logs/`. Đặt ở đây (chứ ở UI) để luật đó không bị chép lại ở hai nơi.
   */
  derive?: (values: Record<string, string>) => Record<string, string>
}

/** Hành động TẢI VỀ: đích ghi do SIDECAR quyết, không phải renderer. */
export type InfraDownloadSpec = {
  /** Khoá trên dòng chứa tên bucket. */
  bucket: string
  /** Khoá trên dòng chứa object key. */
  key: string
}

export type InfraViewSpec = {
  id: string
  /** Nhóm trong danh mục Dịch vụ (`ec2`, `s3`, `lambda`…). */
  service: string
  label: string
  /** Một câu nói dịch vụ này để làm gì — hiện ở chế độ Đơn giản, tooltip ở Chuyên sâu. */
  about: string
  /**
   * Cảnh báo LUÔN hiện khi view đang mở (khoá i18n), khác `about` ở chỗ `about`
   * nằm trong tooltip còn cái này phải đập vào mắt trước khi người dùng gọi lệnh.
   * Ca dùng đầu tiên: ACM — chứng chỉ cho CloudFront BẮT BUỘC ở `us-east-1`, và
   * người đang ghim `ap-southeast-1` sẽ nhìn thấy bảng trống mà không hiểu vì sao.
   */
  notice?: string
  support: 'full' | 'list'
  list: {
    args: readonly string[]
    pick: (json: unknown) => InfraRow[]
    /** Đường dẫn `a.b` của token phân trang trong JSON trả về. */
    tokenPath: string
    /** Cờ CLI nhận token. AWS dùng `--starting-token` cho mọi paginator. */
    tokenFlag: string
    pageSize: number
    pageSizeFlag: string
    /**
     * Cờ mà VIEW bắt buộc phải có (vd `--bucket` của S3): thiếu thì không chạy,
     * và UI biết phải hỏi giá trị trước. Rỗng = view dùng được ngay.
     */
    required?: readonly InfraFormField[]
  }
  columns: { simple: readonly InfraColumn[]; full: readonly InfraColumn[] }
  /** Dòng phụ ở chế độ Đơn giản: khoá i18n + các trường điền vào chỗ trống. */
  plain?: { key: string; fields: readonly string[] }
  /** Lệnh lấy chi tiết một dòng (mặc định: không có). */
  detail?: { args: readonly string[] }
  actions?: readonly InfraRowAction[]
  forms?: readonly InfraViewForm[]
  /** Deep link Console. `region` rỗng = dịch vụ toàn cầu (IAM, Route53). */
  consoleUrl?: (row: InfraRow, ctx: { region: string }) => string
  /** Hành động IAM dùng cho bước DÒ QUYỀN lúc mở màn (task 3.3). */
  probe?: { actions: readonly string[] }
}

// ─── Đọc JSON phòng vệ ───────────────────────────────────────────────────────

export function asObj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

/** Giá trị tại đường dẫn `a.b.c`, hoặc undefined. */
export function at(v: unknown, path: string): unknown {
  let cur: unknown = v
  for (const part of path.split('.')) {
    const obj = asObj(cur)
    if (!(part in obj)) return undefined
    cur = obj[part]
  }
  return cur
}

/** Tag `Name` của EC2/RDS (mảng `Tags: [{Key,Value}]`). */
export function tagName(tags: unknown, name = 'Name'): string {
  for (const t of asArray(tags)) {
    const o = asObj(t)
    if (str(o['Key']) === name) return str(o['Value'])
  }
  return ''
}

/** Đuôi cuối của một ARN (`arn:aws:ecs:…:cluster/prod` → `prod`). */
export function arnTail(arn: string, sep = '/'): string {
  const i = arn.lastIndexOf(sep)
  return i >= 0 ? arn.slice(i + 1) : arn
}

export function formatBytes(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(str(n))
  if (!Number.isFinite(v) || v < 0) return ''
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x < 10 ? x.toFixed(1) : Math.round(x)} ${units[i]}`
}

/** ISO → chuỗi chỉ ngày+giờ phút, ổn định giữa các locale (không dùng Intl). */
export function formatWhen(iso: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : iso
}

// ─── Sinh argv từ mẫu ────────────────────────────────────────────────────────

const PLACEHOLDER = /^\{([A-Za-z0-9_]+)\}$/
const MAX_VALUE_CHARS = 1024
/** Trần số token của một trường dạng danh sách (một ô nhập không phải chỗ nhét 10k path). */
const MAX_LIST_TOKENS = 200

export type BuildArgsResult =
  | { ok: true; args: string[] }
  | { ok: false; missing: string[]; error: string }

/**
 * Trường nào nhận nhiều giá trị. Suy từ khai báo của form/hành động để `buildArgs`
 * biết phải tách — thay vì đoán theo dấu cách, thứ sẽ tách cả một đường dẫn S3 có
 * khoảng trắng (hợp lệ) thành hai token.
 */
export function listKeysOf(
  fields: readonly InfraFormField[] | undefined,
): ReadonlySet<string> | undefined {
  const out = new Set<string>()
  for (const f of fields ?? []) if (f.list === true) out.add(f.key)
  return out.size ? out : undefined
}

export type BuildArgsOptions = { listKeys?: ReadonlySet<string> | undefined }

/**
 * Thay `{key}` trong mẫu bằng `values[key]`. Trả về DANH SÁCH KHOÁ THIẾU để UI
 * biết phải hỏi trường nào, thay vì chạy một lệnh sai rồi dịch lỗi của AWS.
 *
 * Từ chối giá trị bắt đầu bằng `-`: một giá trị như vậy bị chính CLI đọc thành
 * cờ, tức biến dữ liệu người dùng thành quyền (xem đầu file, luật 2).
 */
export function buildArgs(
  template: readonly string[],
  values: Record<string, string>,
  opts: BuildArgsOptions = {},
): BuildArgsResult {
  const args: string[] = []
  const missing: string[] = []
  for (const token of template) {
    const m = PLACEHOLDER.exec(token)
    if (!m) {
      args.push(token)
      continue
    }
    const key = m[1] as string
    const raw = values[key]
    if (raw === undefined || raw === '') {
      missing.push(key)
      continue
    }
    if (raw.length > MAX_VALUE_CHARS) {
      return { ok: false, missing: [], error: `Giá trị của "${key}" quá dài.` }
    }
    // Trường danh sách: MỘT ô nhập → NHIỀU token. Luật "-" được kiểm cho TỪNG
    // token; kiểm trên cả chuỗi là bỏ lọt `"/a -b"` (token thứ hai là một cờ).
    if (opts.listKeys?.has(key) === true) {
      const tokens = raw
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter((t) => t !== '')
      if (tokens.length === 0) {
        missing.push(key)
        continue
      }
      if (tokens.length > MAX_LIST_TOKENS) {
        return { ok: false, missing: [], error: `Giá trị của "${key}" có quá nhiều mục.` }
      }
      const bad = tokens.find((t) => t.startsWith('-'))
      if (bad !== undefined) {
        return {
          ok: false,
          missing: [],
          error: `Giá trị của "${key}" không được bắt đầu bằng "-".`,
        }
      }
      const tooLong = tokens.find((t) => t.length > MAX_VALUE_CHARS)
      if (tooLong !== undefined) {
        return { ok: false, missing: [], error: `Giá trị của "${key}" quá dài.` }
      }
      args.push(...tokens)
      continue
    }
    if (raw.startsWith('-')) {
      return {
        ok: false,
        missing: [],
        error: `Giá trị của "${key}" không được bắt đầu bằng "-".`,
      }
    }
    args.push(raw)
  }
  if (missing.length) {
    return { ok: false, missing, error: `Thiếu giá trị: ${missing.join(', ')}` }
  }
  return { ok: true, args }
}

/** Khoá i18n của một cột, để UI không phải tự ghép chuỗi. */
export function columnLabelKey(key: string): string {
  return `infra.explorer.col.${key}`
}
