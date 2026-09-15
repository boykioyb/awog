// Trình soạn INI *phẫu thuật* cho `~/.aws/{config,credentials}` (ADR 0088 §1b —
// Mốc 1, việc A1). Hàm thuần, KHÔNG I/O: đường ghi xuống đĩa nằm ở `write.ts`.
//
// Vì sao không parse-rồi-serialize-lại: file này là nhà của AWS CLI *và* mọi SDK
// trên máy. Nó có comment của người dùng, thứ tự khoá riêng, và một đống khoá
// AWOG không mô hình hoá (`cli_pager`, `endpoint_url`, block thụt `s3 =`, cấu
// hình của tool khác). Dựng lại cả file từ một model chỉ biết 15 khoá nghĩa là
// xoá sạch phần còn lại. Nên mô hình ở đây là **mảng dòng gốc**: mỗi thao tác
// chỉ chèn/sửa/xoá đúng những dòng liên quan, mọi dòng khác đi qua nguyên xi.
//
// LUẬT #7 CỦA MỐC (danh sách cấm là allowlist trá hình): thứ chặn ở đây là
// `WRITABLE_KEYS` — **allowlist khoá được phép GHI**, không phải denylist khoá
// secret. Khoá lạ ⇒ ném, không im lặng bỏ qua. `credential_process` cố ý NẰM
// NGOÀI allowlist (ADR 0088 / spec: chỉ đọc ở v1) vì dòng đó là một *lệnh sẽ
// chạy mỗi lần CLI cần credential* — để AWOG ghi nó là mở đường thực thi lệnh
// tuỳ ý ngoài mọi cổng quyền của app. `x_security_token_expires` cũng ngoài
// allowlist: nó là dấu vết do CLI tự ghi, không phải thứ người dùng khai.
//
// INVARIANT #1 (nửa còn lại của `ini.ts`): ba khoá secret ĐI QUA module này —
// đó là toàn bộ lý do nó tồn tại — nên tuyệt đối không được log. Mọi `throw`
// bên dưới chỉ nêu TÊN khoá, không bao giờ nhắc giá trị.

export type IniEdit =
  | {
      op: 'upsertSection'
      section: string
      keys: Record<string, string>
      removeKeys?: readonly string[]
    }
  | { op: 'renameSection'; from: string; to: string }
  | { op: 'deleteSection'; section: string }
  /**
   * Nhân bản một section NGUYÊN VĂN từng dòng (kể cả dòng secret).
   *
   * Tồn tại vì nhân bản profile không thể làm ở tầng trên: đường đọc của AWOG
   * cố tình không bao giờ thấy giá trị secret (invariant #1), nên "đọc rồi lưu
   * lại" sẽ đẻ ra một profile static mất khoá. Ở đây giá trị không bao giờ bị
   * cắt ra thành biến có tên — nó đi từ mảng dòng nguồn sang mảng dòng đích.
   */
  | { op: 'copySection'; from: string; to: string; overwrite?: boolean }

// Allowlist của `ini.ts` TRỪ `credential_process` + `x_security_token_expires`,
// CỘNG ba khoá secret (chỉ đường GHI mới được chạm) và `sso_start_url`/
// `sso_region` cho block `[sso-session x]`.
const WRITABLE_KEYS: ReadonlySet<string> = new Set([
  'region',
  'output',
  'sso_start_url',
  'sso_region',
  'sso_account_id',
  'sso_role_name',
  'sso_session',
  // A5 cần ghi khoá này vào `[sso-session x]`: thiếu nó thì `aws sso login` đăng
  // ký client OIDC không có phạm vi `sso:account:access`, và `sso list-accounts`
  // ngay sau đó trả 403. Không phải secret — là tên phạm vi, hằng số.
  'sso_registration_scopes',
  'role_arn',
  'source_profile',
  'mfa_serial',
  'external_id',
  'duration_seconds',
  'aws_access_key_id',
  'aws_secret_access_key',
  'aws_session_token',
  // `aws login` (aws-cli 2.35.9+): giá trị là ĐỊNH DANH phiên do CLI sinh, token
  // nằm trong `~/.aws/login/cache` — không phải secret, và không phải lệnh sẽ
  // chạy như `credential_process`. `console-login.ts` ghi đúng khoá này (một
  // mình) sau khi CLI đăng nhập xong trong file tạm.
  'login_session',
])

// Tên section = tên profile (cùng bộ ký tự AWS cho phép, xem `profiles.ts`) với
// tối đa một tiền tố `profile ` / `sso-session `. Regex này cũng chính là hàng
// rào chống chèn `]` để đóng section sớm.
const SECTION_RE = /^[A-Za-z0-9._@:/+=-]+(?: [A-Za-z0-9._@:/+=-]+)?$/
const SECTION_MAX_LEN = 160

type Scanned =
  | { kind: 'blank' }
  | { kind: 'comment' }
  | { kind: 'section'; name: string }
  /** `[abc` thiếu ngoặc đóng — `ini.ts` huỷ section hiện tại, ở đây nó cắt span. */
  | { kind: 'section-break' }
  | { kind: 'key'; name: string }
  /** Dòng rác, body của block thụt, hoặc `s3 =` mở block. */
  | { kind: 'other' }

function splitCr(line: string): { body: string; cr: string } {
  return line.endsWith('\r') ? { body: line.slice(0, -1), cr: '\r' } : { body: line, cr: '' }
}

// Sau dấu `=` còn ký tự khác khoảng trắng không? Phân biệt `s3 =` (mở block
// thụt) với một dòng khoá thật — cùng ngữ nghĩa với `hasValueAfter` của `ini.ts`.
function hasValueAfter(line: string, from: number): boolean {
  for (let i = from; i < line.length; i++) {
    const code = line.charCodeAt(i)
    if (code !== 32 && code !== 9) return true
  }
  return false
}

// Phân loại từng dòng theo ĐÚNG luật của `parseAwsIni` — nếu hai bên hiểu file
// khác nhau thì bản verify sau khi ghi sẽ nói dối.
function scan(lines: readonly string[]): Scanned[] {
  const out: Scanned[] = []
  let inNested = false

  for (const raw of lines) {
    const { body } = splitCr(raw)
    const indented = body.charCodeAt(0) === 32 || body.charCodeAt(0) === 9
    const t = body.trim()

    if (t === '') {
      inNested = false
      out.push({ kind: 'blank' })
      continue
    }
    if (inNested && indented) {
      out.push({ kind: 'other' })
      continue
    }
    inNested = false

    const first = t.charCodeAt(0)
    if (first === 59 /* ; */ || first === 35 /* # */) {
      out.push({ kind: 'comment' })
      continue
    }

    if (first === 91 /* [ */) {
      // Dấu `]` ĐẦU TIÊN, không phải cuối: botocore (và configparser) dùng
      // `\[(?P<header>[^]]+)\]` nên tên section dừng ở `]` đầu tiên và phần
      // đuôi bị bỏ qua. Lấy `lastIndexOf` thì `[profile dev] ; bucket [prod]`
      // thành một section tên khác hẳn — AWOG không thấy profile đang có, rồi
      // upsert đẻ ra một `[profile dev]` THỨ HAI.
      const close = t.indexOf(']')
      const name = close > 1 ? t.slice(1, close).trim().replace(/\s+/g, ' ') : ''
      out.push(name === '' ? { kind: 'section-break' } : { kind: 'section', name })
      continue
    }

    const eq = body.indexOf('=')
    const key = eq > 0 ? body.slice(0, eq).trim().toLowerCase() : ''
    if (key === '') {
      out.push({ kind: 'other' })
      continue
    }
    if (!hasValueAfter(body, eq + 1)) {
      // `s3 =` mở block thụt. Cố ý KHÔNG coi là một lần xuất hiện của khoá: sửa
      // hay xoá dòng này sẽ mồ côi cả block bên dưới.
      inNested = true
      out.push({ kind: 'other' })
      continue
    }
    out.push({ kind: 'key', name: key })
  }

  return out
}

/** `end` là chỉ số loại trừ: dòng đầu tiên KHÔNG còn thuộc section. */
type Span = { name: string; header: number; end: number }

function spansOf(sc: readonly Scanned[]): Span[] {
  const spans: Span[] = []
  const closeLast = (at: number): void => {
    const last = spans[spans.length - 1]
    if (last && last.end < 0) last.end = at
  }
  for (let i = 0; i < sc.length; i++) {
    const line = sc[i]!
    if (line.kind === 'section') {
      closeLast(i)
      spans.push({ name: line.name, header: i, end: -1 })
    } else if (line.kind === 'section-break') {
      closeLast(i)
    }
  }
  closeLast(sc.length)
  return spans
}

// Section trùng tên là MỘT profile: botocore gộp chúng lại và "cái sau thắng"
// ở từng khoá. Nên mọi thao tác phải nhìn CẢ CHÙM span cùng tên (theo thứ tự
// trong file) chứ không chỉ cái đầu — sửa cái đầu trong khi khoá nằm ở cái sau
// thì file vẫn chạy bằng giá trị cũ, và xoá cái đầu thì profile vẫn còn đó.
function findSpans(spans: readonly Span[], name: string): Span[] {
  return spans.filter((s) => s.name === name)
}

/**
 * Chuẩn hoá tên section về đúng dạng `parseAwsIni` trả về (trim + gộp khoảng
 * trắng), và ném khi tên không hợp lệ.
 *
 * Export vì bước verify sau khi ghi (`write.ts`) phải tra cứu bằng CÙNG một
 * tên: tra `parsed['profile  dev']` trong khi trên đĩa là `[profile dev]` thì
 * verify báo "section missing" cho một lần ghi hoàn toàn đúng, rồi cuộn ngược.
 */
export function normalizeSectionName(name: string): string {
  const norm = name.trim().replace(/\s+/g, ' ')
  if (norm.length === 0 || norm.length > SECTION_MAX_LEN || !SECTION_RE.test(norm)) {
    throw new Error(`Invalid INI section name: ${JSON.stringify(name.slice(0, 64))}`)
  }
  return norm
}

function assertSectionName(name: string): string {
  return normalizeSectionName(name)
}

function assertWritableKey(key: string): string {
  const norm = key.trim().toLowerCase()
  if (!WRITABLE_KEYS.has(norm)) {
    throw new Error(`Key is not writable by AWOG: ${JSON.stringify(key.slice(0, 64))}`)
  }
  return norm
}

// Giá trị là L1 (gõ tay / dán từ portal). Xuống dòng hoặc `[` mở đầu cho phép
// một giá trị độc tự đẻ ra section giả — đúng kiểu injection mà file INI dính.
// Thông báo lỗi CHỈ nêu tên khoá: giá trị có thể là secret.
function assertValue(key: string, value: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`Value for "${key}" must not contain a line break`)
  }
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    throw new Error(`Value for "${key}" must not start with "["`)
  }
  // Giá trị rỗng sẽ ghi ra `region =` — mà dòng đó KHÔNG phải "khoá rỗng", nó
  // MỞ một block thụt (xem `hasValueAfter`), nên khoá sẽ biến mất khỏi bản đọc
  // lại. Muốn bỏ một khoá thì dùng `removeKeys`, đó là lệnh nói đúng ý.
  if (trimmed === '') {
    throw new Error(`Value for "${key}" must not be empty (use removeKeys to unset)`)
  }
  return trimmed
}

// Chỉ thay phần sau dấu `=`. Giữ nguyên thụt đầu dòng, cách viết tên khoá, và
// khoảng trắng quanh `=` của bản gốc.
function rewriteKeyLine(raw: string, value: string): string {
  const { body, cr } = splitCr(raw)
  const eq = body.indexOf('=')
  const after = body.slice(eq + 1)
  const gap = after.slice(0, after.length - after.trimStart().length)
  return `${body.slice(0, eq + 1)}${gap}${value}${cr}`
}

// Trả về chỉ số mọi dòng khai `key`, duyệt các span cùng tên theo thứ tự file
// ⇒ phần tử cuối chính là lần xuất hiện mà botocore dùng.
function keyIndicesIn(sc: readonly Scanned[], spans: readonly Span[], key: string): number[] {
  const out: number[] = []
  for (const span of spans) {
    for (let i = span.header + 1; i < span.end; i++) {
      const line = sc[i]!
      if (line.kind === 'key' && line.name === key) out.push(i)
    }
  }
  return out
}

type Ctx = { cr: string }

function newKeyLine(ctx: Ctx, key: string, value: string): string {
  return `${key} = ${value}${ctx.cr}`
}

function upsertExisting(
  lines: readonly string[],
  ctx: Ctx,
  spans: readonly Span[],
  sc: readonly Scanned[],
  keys: ReadonlyMap<string, string>,
  removeKeys: readonly string[],
): string[] {
  const replaced = new Map<number, string>()
  const dropped = new Set<number>()
  const appended: string[] = []

  for (const [key, value] of keys) {
    const hits = keyIndicesIn(sc, spans, key)
    if (hits.length === 0) {
      appended.push(newKeyLine(ctx, key, value))
      continue
    }
    // Khoá trùng trong một section: botocore lấy lần xuất hiện CUỐI, nên sửa
    // đúng dòng đó rồi dọn các bản trùng phía trên — nếu để lại, file vẫn chạy
    // đúng nhưng người đọc sẽ tin nhầm dòng đầu tiên.
    const last = hits[hits.length - 1]!
    replaced.set(last, rewriteKeyLine(lines[last]!, value))
    for (const i of hits.slice(0, -1)) dropped.add(i)
  }

  for (const key of removeKeys) {
    for (const i of keyIndicesIn(sc, spans, key)) dropped.add(i)
  }

  const next: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (dropped.has(i)) continue
    next.push(replaced.get(i) ?? lines[i]!)
  }
  if (appended.length === 0) return next

  // Chèn khoá mới vào CUỐI phần nội dung của section (sau dòng cuối không
  // trắng), chứ không phải cuối span — nếu không, mỗi lần thêm khoá lại đẩy
  // dòng trắng ngăn cách xuống một nấc. Với section trùng tên thì là span CUỐI
  // CÙNG, để khoá mới thắng đúng như botocore đọc.
  const nextSc = scan(next)
  const nextSpans = findSpans(spansOf(nextSc), spans[spans.length - 1]!.name)
  const nextSpan = nextSpans[nextSpans.length - 1]
  if (!nextSpan) throw new Error('Internal: section vanished while editing')
  let at = nextSpan.end
  while (at > nextSpan.header + 1 && nextSc[at - 1]!.kind === 'blank') at--
  next.splice(at, 0, ...appended)
  return next
}

function appendSection(
  lines: readonly string[],
  ctx: Ctx,
  section: string,
  keys: ReadonlyMap<string, string>,
): string[] {
  const next = [...lines]
  const last = next[next.length - 1]
  if (next.length > 0 && splitCr(last ?? '').body.trim() !== '') next.push(ctx.cr)
  next.push(`[${section}]${ctx.cr}`)
  for (const [key, value] of keys) next.push(newKeyLine(ctx, key, value))
  return next
}

function applyUpsert(
  lines: readonly string[],
  ctx: Ctx,
  edit: Extract<IniEdit, { op: 'upsertSection' }>,
): string[] {
  const section = assertSectionName(edit.section)

  const keys = new Map<string, string>()
  for (const [rawKey, rawValue] of Object.entries(edit.keys)) {
    const key = assertWritableKey(rawKey)
    keys.set(key, assertValue(key, rawValue))
  }
  const removeKeys = (edit.removeKeys ?? []).map(assertWritableKey)
  for (const key of removeKeys) {
    // Vừa ghi vừa xoá cùng một khoá là lệnh mâu thuẫn — fail fast thay vì đoán.
    if (keys.has(key)) throw new Error(`Key "${key}" is both written and removed`)
  }

  const sc = scan(lines)
  const spans = findSpans(spansOf(sc), section)
  if (spans.length === 0) return appendSection(lines, ctx, section, keys)
  return upsertExisting(lines, ctx, spans, sc, keys, removeKeys)
}

function applyRename(
  lines: readonly string[],
  edit: Extract<IniEdit, { op: 'renameSection' }>,
): string[] {
  const from = assertSectionName(edit.from)
  const to = assertSectionName(edit.to)
  if (from === to) return [...lines]

  const spans = spansOf(scan(lines))
  const targets = findSpans(spans, from)
  if (targets.length === 0) throw new Error(`Section not found: ${JSON.stringify(from)}`)
  if (findSpans(spans, to).length > 0) {
    throw new Error(`Section already exists: ${JSON.stringify(to)}`)
  }

  const next = [...lines]
  // Section khai nhiều lần = một profile bị gộp; đổi tên phải đổi MỌI header,
  // nếu không phần thân của những lần khai còn lại vẫn treo dưới tên cũ.
  for (const span of targets) {
    const { body, cr } = splitCr(next[span.header]!)
    const open = body.indexOf('[')
    const close = body.indexOf(']', open)
    // Giữ nguyên thụt đầu dòng và phần đuôi sau `]` (`[profile dev]  ; ghi chú`).
    next[span.header] = `${body.slice(0, open)}[${to}]${body.slice(close + 1)}${cr}`
  }
  return next
}

function deleteSpan(lines: readonly string[], sc: readonly Scanned[], span: Span): string[] {
  // Comment dính ngay trên header kế tiếp là chú thích của section SAU, không
  // phải của cái đang xoá — giữ lại. Và comment nói chung là chữ của người
  // dùng: thà để lại một dòng thừa còn hơn im lặng xoá mất ghi chú của họ.
  let end = span.end
  while (end > span.header + 1 && sc[end - 1]!.kind === 'comment') end--

  const next = [...lines.slice(0, span.header), ...lines.slice(end)]

  // Dọn vết cắt: không để file mọc thêm dòng trắng sau mỗi lần xoá.
  if (span.header >= next.length) {
    while (next.length > 0 && splitCr(next[next.length - 1]!).body.trim() === '') next.pop()
  } else if (span.header > 0) {
    const before = splitCr(next[span.header - 1]!).body.trim() === ''
    const after = splitCr(next[span.header]!).body.trim() === ''
    if (before && after) next.splice(span.header, 1)
  }
  return next
}

function applyDelete(
  lines: readonly string[],
  edit: Extract<IniEdit, { op: 'deleteSection' }>,
): string[] {
  const section = assertSectionName(edit.section)
  let cur: readonly string[] = lines
  // Section khai nhiều lần là MỘT profile bị gộp — bỏ sót một lần khai nghĩa là
  // "đã xoá" mà credential vẫn dùng được. Xoá lần lượt từng lần khai; mỗi vòng
  // gỡ đúng một span nên vòng lặp luôn dừng.
  // Xoá một section không tồn tại = trạng thái mong muốn đã đạt. Không ném: UI
  // có thể bắn lệnh xoá trên một danh sách vừa cũ đi vài trăm ms.
  for (;;) {
    const sc = scan(cur)
    const span = findSpans(spansOf(sc), section)[0]
    if (!span) break
    cur = deleteSpan(cur, sc, span)
  }
  return [...cur]
}

function applyCopy(
  lines: readonly string[],
  ctx: Ctx,
  edit: Extract<IniEdit, { op: 'copySection' }>,
): string[] {
  const from = assertSectionName(edit.from)
  const to = assertSectionName(edit.to)
  if (from === to) throw new Error(`Cannot copy a section onto itself: ${JSON.stringify(from)}`)

  let work: string[] = [...lines]
  if (findSpans(spansOf(scan(work)), to).length > 0) {
    if (edit.overwrite !== true) throw new Error(`Section already exists: ${JSON.stringify(to)}`)
    // Xoá bản cũ TRƯỚC rồi mới chép: nếu chép trước, file có hai section trùng
    // tên và lệnh xoá sẽ gỡ luôn cả bản vừa chép.
    work = applyDelete(work, { op: 'deleteSection', section: to })
  }

  const sc = scan(work)
  // Section nguồn khai nhiều lần = một profile bị gộp: chép THÂN CỦA CẢ CHÙM
  // theo thứ tự file, nếu không bản sao thiếu đúng những khoá nằm ở lần khai
  // sau — mà đó lại là những khoá botocore đang thực sự dùng.
  const spans = findSpans(spansOf(sc), from)
  if (spans.length === 0) throw new Error(`Section not found: ${JSON.stringify(from)}`)

  const body: string[] = []
  for (const span of spans) {
    // Cắt đuôi dòng trắng + comment như `applyDelete`: comment sát header kế
    // tiếp là chú thích của section SAU, chép nó sang bản sao là chép nhầm chủ.
    let end = span.end
    while (end > span.header + 1) {
      const kind = sc[end - 1]!.kind
      if (kind !== 'blank' && kind !== 'comment') break
      end--
    }
    for (let i = span.header + 1; i < end; i++) {
      const line = sc[i]!
      // Hàng rào cuối cho luật "`credential_process` chỉ ĐỌC ở v1": dòng đó là
      // một LỆNH sẽ chạy mỗi lần CLI cần credential, nên AWOG không được đẻ thêm
      // một bản của nó — kể cả bằng đường chép nguyên văn.
      if (line.kind === 'key' && line.name === 'credential_process') {
        throw new Error('Key is not writable by AWOG: "credential_process"')
      }
      body.push(work[i]!)
    }
  }

  const next = [...work]
  if (next.length > 0 && splitCr(next[next.length - 1] ?? '').body.trim() !== '') next.push(ctx.cr)
  next.push(`[${to}]${ctx.cr}`)
  // Dòng gốc đi qua nguyên xi (giữ cả `\r` của riêng nó) — đó là cả mục đích.
  next.push(...body)
  return next
}

/**
 * Áp một chuỗi thao tác lên nội dung file INI và trả về nội dung mới.
 *
 * Bất biến: comment giữ nguyên vị trí · thứ tự khoá cũ không đổi · khoá AWOG
 * không mô hình hoá còn nguyên · CRLF/LF giữ theo file · newline cuối file giữ
 * nguyên trạng thái ban đầu.
 *
 * Ném (fail fast) khi: tên section sai định dạng · khoá ngoài `WRITABLE_KEYS` ·
 * giá trị chứa xuống dòng hoặc mở đầu bằng `[` · rename (hoặc copy không
 * `overwrite`) vào một tên đã tồn tại · copy một section có `credential_process`.
 */
export function editAwsIni(raw: string, edits: readonly IniEdit[]): string {
  // File chưa tồn tại (`raw === ''`): tạo mới thì kết thúc bằng newline như mọi
  // file text POSIX. Bỏ newline cuối để `aws configure set` hay một script dán
  // thêm dòng vào cuối sẽ nối ngay sau `region = x` thành một dòng dính liền.
  const endsWithNewline = raw === '' || raw.endsWith('\n')
  const all = raw === '' ? [] : raw.split('\n')
  if (endsWithNewline) all.pop()

  const ctx: Ctx = { cr: raw.includes('\r\n') ? '\r' : '' }

  let lines: readonly string[] = all
  for (const edit of edits) {
    if (edit.op === 'upsertSection') lines = applyUpsert(lines, ctx, edit)
    else if (edit.op === 'renameSection') lines = applyRename(lines, edit)
    else if (edit.op === 'copySection') lines = applyCopy(lines, ctx, edit)
    else lines = applyDelete(lines, edit)
  }

  const body = lines.join('\n')
  if (lines.length === 0) return endsWithNewline ? '' : body
  return endsWithNewline ? `${body}\n` : body
}
