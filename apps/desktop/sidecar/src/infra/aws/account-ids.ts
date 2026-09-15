// Account id theo profile — phân giải + cache (Mốc 1 việc A8).
//
// VÌ SAO TỒN TẠI. `accountKindOf()` (`infra/policy.ts`) coi **vắng `accountId`
// ⇒ `production`** (fail-safe của audit #1 F6). Profile static/assume-role
// không mang account id ở đâu trong `~/.aws` cả, nên chúng LUÔN bị chấm ở cột
// nghiêm nhất của ma trận quyền và hỏi nhiều nhất. Điền id vào là cách DUY NHẤT
// để một tài khoản dev được đối xử như dev. Module này là chỗ id đó được lấy về
// và được nhớ.
//
// Vì hệ quả của nó là HẠ hàng rào, cache phải đáng tin hơn cache thường: một id
// sai hoặc cũ sẽ nới quyền nhầm chỗ — tệ hơn hẳn so với việc không có id. Ba
// hàng rào cho chuyện đó: vân tay `fp` (profile đổi cấu hình ⇒ entry coi như
// không có), hạn dùng ngắn, và lọc bỏ entry của profile đã biến mất.
//
// ⚠ VÂN TAY KHÔNG PHẢI CHỮ KÝ (infosec audit #2). `profileFingerprint()` băm
// metadata mà bất cứ ai đọc được `~/.aws/config` cũng có, bằng thuật toán nằm
// ngay trong repo này — tự tính lại được, nên nó chống LỆCH CẤU HÌNH chứ không
// chống KẺ GHI ĐƯỢC FILE. Thứ chống giả mạo là quyền ghi: file 600 trong thư
// mục 700, và `~/.awog/infra/account-ids.json` nằm trong `PROTECTED_PATH_RE`
// của `runtime/permission.ts` nên agent không có đường ghi vào. Ai nối cache này
// vào `accountKindOf()` thì phải đọc ghi chú "TRƯỚC KHI NỐI" ở cuối file.
//
// LUẬT MẠNG. `listAccountIds()` KHÔNG BAO GIỜ gọi mạng — nó chỉ đọc `~/.aws` và
// cache trên đĩa, nên gọi được lúc mở trang. `resolveAccountIds()` mới gọi
// `sts get-caller-identity`, và chỉ được gọi từ một nút người dùng vừa bấm.
// Đây là credential và là tiền của người dùng, không phải thứ để "chạy nền cho
// tiện".
//
// LUẬT ĐĨA. Đường ĐỌC không ghi đĩa — `listAccountIds()` lọc trong bộ nhớ. Chỉ
// `resolveAccountIds()` (người dùng bấm) và `forgetAccountIds()` (người dùng
// bấm) mới chạm file. Trước đây đường đọc tự dọn cache, nên một method tự khai
// là "chỉ đọc" lại ghi đĩa mỗi lần mở trang, không nhật ký và không khoá.
//
// BỀ MẶT CỦA CON NGƯỜI. Không AgentTool nào gọi module này (ADR 0088 §1b luật
// 4) — cũng như `profile-ops.ts`, đó là lý do `actor` dưới đây là hằng
// `'human'` thay vì tham số.
//
// Mọi lời gọi CLI đi qua `runInfra()` — cổng duy nhất ra CLI — nên argv KHÔNG
// tự mang `--profile`/`--region` (sidecar tự chèn; tự mang là bị từ chối), và
// mỗi lượt gọi tự để lại một dòng nhật ký.

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { log } from '../../util/logger.js'
import { awogHome, sanitizeChild } from '../../util/path.js'
import { redactString } from '../../sessions/redact.js'
import { runInfra } from '../run.js'
import { recordInfraAction, type InfraSurface } from '../audit/store.js'
import {
  AWS_PROFILE_NAME_RE,
  awsConfigPath,
  awsCredentialsPath,
  listAwsProfiles,
  type AwsProfile,
} from './profiles.js'

/** `config` = `sso_account_id` có sẵn trong `~/.aws`; `sts` = phải gọi mạng. */
export type AwsAccountIdOrigin = 'config' | 'sts'

export type AwsAccountIdEntry = {
  profile: string
  accountId: string
  arn?: string
  /** ISO 8601 — lúc phân giải. */
  at: string
  origin: AwsAccountIdOrigin
}

export type AwsResolveAccountIdsResult = {
  entries: AwsAccountIdEntry[]
  /** Một profile hỏng không giết cả lô; nó rơi vào đây. */
  failures: { profile: string; error: string }[]
}

export type ResolveAccountIdsInput = {
  names: readonly string[]
  surface?: InfraSurface | undefined
}

export type ForgetAccountIdsInput = {
  /** Vắng ⇒ quên SẠCH. */
  names?: readonly string[] | undefined
  surface?: InfraSurface | undefined
}

// ─── Trần ────────────────────────────────────────────────────────────────────

/** Trần một lượt phân giải. 50 profile đã là nhiều hơn mọi máy dev thật. */
const MAX_NAMES = 50
/** Bao nhiêu tiến trình `aws` cùng lúc. Tuần tự thì 30 profile chờ rất lâu. */
const CONCURRENCY = 4
/**
 * Hạn dùng của một entry cache.
 *
 * 7 ngày chứ không phải 30 (audit #2). Hạn dùng là hàng rào CUỐI cho những thay
 * đổi vân tay không thấy được — `credential_process` đổi đầu ra, khoá static bị
 * xoay bởi một công cụ khác, role bị trỏ lại ở phía AWS. Một id sai sống 30
 * ngày là một tài khoản production bị chấm là `normal` suốt một tháng; sống 7
 * ngày thì vẫn sai, nhưng sai trong một cửa sổ mà người dùng còn nhớ mình vừa
 * đổi gì. Phân giải lại là một cú bấm.
 */
const TTL_MS = 7 * 24 * 3600_000
const STS_TIMEOUT_MS = 45_000
const MAX_ERROR_CHARS = 400

const CACHE_DIR = sanitizeChild('infra')
const CACHE_FILE = sanitizeChild('account-ids.json')

function cacheDir(): string {
  return join(awogHome(), CACHE_DIR)
}

function cacheFile(): string {
  return join(cacheDir(), CACHE_FILE)
}

// ─── Vân tay ─────────────────────────────────────────────────────────────────

const CacheEntrySchema = z.object({
  profile: z.string().min(1).max(128),
  // 12 chữ số — đúng hình dạng account id của AWS. Chặt ở đây vì giá trị này
  // đi thẳng vào `prodAccountIds` của ma trận quyền.
  accountId: z.string().regex(/^\d{12}$/),
  arn: z.string().max(2048).optional(),
  at: z.string().min(1).max(64),
  origin: z.enum(['config', 'sts']),
  fp: z.string().length(64),
})

type CacheEntry = z.infer<typeof CacheEntrySchema>

/**
 * Vân tay của những trường quyết định profile này TRỎ VÀO ĐÂU. Lệch ⇒ entry coi
 * như KHÔNG CÓ (người dùng vừa đổi role/khoá thì id cũ có thể đã sai).
 *
 * Một chuỗi ghép thứ tự CỐ ĐỊNH gồm đủ trường của cả ba kiểu, thay vì ba hàm
 * riêng theo kiểu: `kind` nằm trong vân tay nên đổi kiểu cũng làm lệch, và một
 * hàm thì không có đường để hai chỗ trôi ra khác nhau.
 *
 * ⚠ GIỚI HẠN CÓ CHỦ ĐÍCH — vân tay KHÔNG bắt được mọi thay đổi, và KHÔNG chống
 * được giả mạo (xem đầu file). Đường đọc của AWOG cố ý mù với giá trị secret
 * (invariant #1: `parseAwsIni()` vứt `aws_access_key_id`/`aws_secret_access_key`
 * tại chỗ), nên chỉ nhìn các trường metadata thì thay khoá static sang một tài
 * khoản KHÁC vẫn cho `fp` y nguyên.
 *
 * Bịt bằng `filesStamp` — `mtimeMs:size` của `~/.aws/credentials` và
 * `~/.aws/config`. Đó là METADATA CỦA FILE, không phải nội dung, nên không chạm
 * secret (invariant #1 nguyên vẹn) mà vẫn đổi sau MỌI lần sửa khoá, kể cả khoá
 * static viết thẳng trong `config`. Chỉ nhét vào vân tay của profile
 * `kind === 'static'`: profile khác không lấy credential từ giá trị trong hai
 * file đó, nhét vào chỉ khiến chúng mất cache vì một thay đổi không liên quan.
 * Chiều sai của stamp là BẮT NHẦM (sửa region của profile khác cũng làm lệch
 * stamp) — mất cache là phía an toàn, vì vắng accountId ⇒ `production`.
 *
 * Không có tín hiệu nào tương đương cho `kind === 'process'`: đầu ra của
 * `credential_process` không để lại dấu vết nào trên đĩa. Vì thế profile process
 * KHÔNG được cache `origin:'sts'` chút nào (xem `resolveOne`).
 */
export function profileFingerprint(p: AwsProfile, filesStamp: string): string {
  const parts = [
    `kind=${p.kind}`,
    `region=${p.region ?? ''}`,
    `static=${p.hasStaticKeys ? '1' : '0'}`,
    `sessionToken=${p.hasSessionToken ? '1' : '0'}`,
    `roleArn=${p.roleArn ?? ''}`,
    `sourceProfile=${p.sourceProfile ?? ''}`,
    `mfaSerial=${p.mfaSerial ?? ''}`,
    `ssoAccountId=${p.ssoAccountId ?? ''}`,
    `ssoRoleName=${p.ssoRoleName ?? ''}`,
    `ssoStartUrl=${p.ssoStartUrl ?? ''}`,
    `filesStamp=${p.kind === 'static' ? filesStamp : ''}`,
  ]
  return createHash('sha256').update(parts.join('\n')).digest('hex')
}

/**
 * `mtimeMs:size` của hai file credential — METADATA, không đọc nội dung.
 *
 * File vắng ⇒ `absent` chứ không phải chuỗi rỗng: "không có file" là một trạng
 * thái khác "chưa đo được", và tạo file mới phải làm lệch vân tay.
 */
export async function awsFilesStamp(): Promise<string> {
  const parts = await Promise.all(
    [awsCredentialsPath(), awsConfigPath()].map(async (p) => {
      try {
        const s = await stat(p)
        return `${String(s.mtimeMs)}:${String(s.size)}`
      } catch {
        return 'absent'
      }
    }),
  )
  return parts.join('|')
}

function isExpired(entry: CacheEntry, now: number): boolean {
  const at = Date.parse(entry.at)
  // `at` không parse được ⇒ coi như hết hạn: entry không nói được nó bao nhiêu
  // tuổi thì không đủ tin để hạ hàng rào.
  if (Number.isNaN(at)) return true
  return now - at > TTL_MS
}

// ─── Đĩa ─────────────────────────────────────────────────────────────────────

/**
 * Đọc cache. Dữ liệu L2 ⇒ validate từng entry bằng zod và BỎ entry hỏng thay vì
 * vứt cả file: một dòng méo không được làm mất account id của các profile khác.
 * File thiếu / JSON lỗi ⇒ rỗng + warn, KHÔNG ném (khuôn `readIniFile`) — cache
 * hỏng là phiền, không phải sự cố.
 */
async function readCache(): Promise<CacheEntry[]> {
  let raw: string
  try {
    raw = await readFile(cacheFile(), 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      log.warn('aws: cannot read account-id cache', { code })
    }
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('aws: account-id cache is not valid JSON, ignoring')
    return []
  }

  const entries = (parsed as { entries?: unknown } | null)?.entries
  if (!Array.isArray(entries)) {
    log.warn('aws: account-id cache has unexpected shape, ignoring')
    return []
  }

  const out: CacheEntry[] = []
  let dropped = 0
  for (const item of entries) {
    const ok = CacheEntrySchema.safeParse(item)
    if (ok.success) out.push(ok.data)
    else dropped += 1
  }
  if (dropped > 0) log.warn('aws: dropped malformed account-id cache entries', { dropped })
  return out
}

/** Ghi nguyên tử: tmp → chmod 600 → rename (khuôn `mcp/store.ts`). */
async function writeCache(entries: readonly CacheEntry[]): Promise<void> {
  const dir = cacheDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  // chmod lại mỗi lần ghi: quyền thư mục tự lành nếu ai đó nới nó ra bằng tay
  // (cùng lý do với `infra/audit/store.ts`).
  await chmod(dir, 0o700)

  const file = cacheFile()
  const tmp = `${file}.tmp.${process.pid}`
  const body = { version: 1, entries: [...entries] }
  await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

function toEntry(cached: CacheEntry): AwsAccountIdEntry {
  return {
    profile: cached.profile,
    accountId: cached.accountId,
    ...(cached.arn !== undefined ? { arn: cached.arn } : {}),
    at: cached.at,
    origin: cached.origin,
  }
}

// ─── Đọc (không mạng) ────────────────────────────────────────────────────────

/**
 * Account id "miễn phí" — đọc thẳng từ `~/.aws`, không cache, không mạng.
 *
 * Hai đường: `sso_account_id` của profile SSO, và 12 chữ số trong `role_arn` của
 * profile assume-role. Cả hai LUÔN TƯƠI vì chúng là chính file cấu hình hiện
 * hành.
 *
 * ⚠ `role_arn` nói role đó SỐNG ở account nào, không nói lượt assume có thành
 * công không. Trùng khớp với `accountIdOfProfile()` phía UI
 * (`utils/aws-profile-view.ts`) — CỐ Ý: trước bản vá này sidecar không suy từ
 * `role_arn` còn UI thì có, nên UI không bao giờ hiện nút điền cho nhóm
 * assume-role trong khi cache phía sidecar mãi rỗng cho đúng nhóm đó. Hai phía
 * phải trả lời giống nhau câu "đã biết account id chưa".
 */
const ROLE_ARN_ACCOUNT_RE = /^arn:aws[a-z0-9-]*:iam::(\d{12}):/

function accountIdFromConfig(p: AwsProfile): string | undefined {
  if (p.ssoAccountId) return p.ssoAccountId
  return p.roleArn?.match(ROLE_ARN_ACCOUNT_RE)?.[1]
}

/**
 * Account id đã biết của mọi profile — **KHÔNG gọi mạng, KHÔNG ghi đĩa**.
 *
 * Hai nguồn gộp lại:
 *   (a) `accountIdFromConfig()` — id nằm sẵn trong `~/.aws`, MIỄN PHÍ và LUÔN
 *       TƯƠI. Sinh tại chỗ, không đụng cache — cache một giá trị lúc nào cũng
 *       đọc lại được chỉ tạo thêm một bản có thể cũ.
 *   (b) cache trên đĩa cho phần còn lại, đã lọc theo vân tay + hạn dùng +
 *       profile còn tồn tại.
 *
 * Lọc TRONG BỘ NHỚ, không dọn file: đây là đường ĐỌC, và một method tự khai là
 * chỉ đọc thì không được ghi đĩa sau lưng người gọi (UI gọi nó trong
 * `onMounted`). Entry chết vẫn nằm lại trên đĩa nhưng không bao giờ được trả
 * về, nên vô hại; nó bị dọn thật ở `resolveAccountIds()` và
 * `forgetAccountIds()` — hai đường người dùng bấm.
 */
export async function listAccountIds(): Promise<AwsAccountIdEntry[]> {
  const profiles = await listAwsProfiles()
  const byName = new Map(profiles.map((p) => [p.name, p]))
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  const out: AwsAccountIdEntry[] = []
  const fromConfig = new Set<string>()
  for (const p of profiles) {
    const free = accountIdFromConfig(p)
    if (!free) continue
    fromConfig.add(p.name)
    out.push({ profile: p.name, accountId: free, at: nowIso, origin: 'config' })
  }

  const cached = await readCache()
  const stamp = await awsFilesStamp()
  for (const entry of cached) {
    const profile = byName.get(entry.profile)
    if (!profile) continue
    if (isExpired(entry, now)) continue
    if (fromConfig.has(entry.profile)) continue
    if (entry.fp !== profileFingerprint(profile, stamp)) continue
    out.push(toEntry(entry))
  }

  return out.sort((a, b) => a.profile.localeCompare(b.profile))
}

/**
 * Quên account id đã nhớ — **người dùng bấm**, không ai gọi tự động.
 *
 * Đây là đường lùi cho một id SAI mà `resolveAccountIds()` không sửa được: token
 * hết hạn, profile mất quyền `sts:GetCallerIdentity`, hoặc đơn giản là người
 * dùng không muốn AWOG nhớ nữa. Không có nó thì một entry sai chỉ chết khi hết
 * hạn.
 *
 * `names` vắng ⇒ xoá SẠCH. Tiện thể dọn luôn entry của profile đã biến mất và
 * entry quá hạn — đây là đường GHI nên dọn ở đây là đúng chỗ.
 */
export async function forgetAccountIds(input: ForgetAccountIdsInput = {}): Promise<{ removed: number }> {
  const names = input.names
  if (names) {
    for (const name of names) {
      if (!AWS_PROFILE_NAME_RE.test(name)) {
        throw opError('INVALID_NAME', `invalid profile name: ${name.slice(0, 64)}`)
      }
    }
  }

  const cached = await readCache()
  if (cached.length === 0) return { removed: 0 }

  const now = Date.now()
  const alive = new Set((await listAwsProfiles()).map((p) => p.name))
  const drop = names ? new Set(names) : null
  const kept = cached.filter((e) => {
    if (drop === null || drop.has(e.profile)) return false // người dùng vừa yêu cầu quên
    return alive.has(e.profile) && !isExpired(e, now) // tiện tay dọn rác
  })
  const removed = cached.length - kept.length
  if (removed === 0) return { removed }
  await writeCache(kept)

  // Luật #6 của mốc: mọi thao tác GHI để lại một dòng. `argv` chỉ có tên profile
  // — không có id, không có arn: nhật ký không cần cầm thứ ta vừa quyết định
  // quên. Ghi SAU khi ghi đĩa thành công, để dòng nhật ký nói về việc đã xảy ra.
  await recordInfraAction({
    actor: 'human',
    surface: input.surface ?? 'settings',
    tool: 'account_id_cache',
    argv: ['forget', ...(names ?? ['--all'])],
    context: {},
    class: 'write',
    decision: 'approved',
    result: { summary: `forgot ${String(removed)} cached account id(s)` },
  })
  return { removed }
}

// ─── Phân giải (có mạng — chỉ khi người dùng bấm) ────────────────────────────

const IdentitySchema = z.object({
  Account: z.string().max(64),
  Arn: z.string().max(2048),
})

function opError(code: string, message: string): Error {
  const err = new Error(`${code}: ${message}`)
  err.name = code
  return err
}

/** Chạy `tasks` với trần `CONCURRENCY` tiến trình cùng lúc, giữ nguyên thứ tự kết quả. */
async function pooled<T>(count: number, worker: (index: number) => Promise<T>): Promise<T[]> {
  const out = new Array<T>(count)
  let next = 0
  const lanes = Array.from({ length: Math.min(CONCURRENCY, count) }, async () => {
    for (;;) {
      const index = next++
      if (index >= count) return
      out[index] = await worker(index)
    }
  })
  await Promise.all(lanes)
  return out
}

type Resolved =
  | { ok: true; entry: AwsAccountIdEntry; cache?: CacheEntry }
  | { ok: false; failure: { profile: string; error: string } }

async function resolveOne(
  profile: AwsProfile,
  surface: InfraSurface,
  nowIso: string,
  filesStamp: string,
): Promise<Resolved> {
  const run = await runInfra({
    tool: 'aws',
    args: ['sts', 'get-caller-identity', '--output', 'json'],
    context: {
      profile: profile.name,
      ...(profile.region !== undefined ? { region: profile.region } : {}),
    },
    actor: 'human',
    surface,
    toolName: 'resolve_account_id',
    // Nút người dùng vừa bấm. Lệnh thuộc lớp `read`, và `classify.ts` đã chặn
    // cứng nhóm lệnh phát credential nên `get-caller-identity` không in ra khoá.
    decision: 'approved',
    timeoutMs: STS_TIMEOUT_MS,
  })

  if (!run.ok) {
    const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
    return { ok: false, failure: { profile: profile.name, error: fail(detail) } }
  }

  let payload: unknown
  try {
    payload = JSON.parse(run.stdout)
  } catch {
    return {
      ok: false,
      failure: { profile: profile.name, error: 'Unexpected output from aws sts get-caller-identity' },
    }
  }
  const parsed = IdentitySchema.safeParse(payload)
  if (!parsed.success) {
    return {
      ok: false,
      failure: { profile: profile.name, error: 'Unexpected output from aws sts get-caller-identity' },
    }
  }

  // `Arn` mang tên IAM user/role — không phải secret, trả được. `UserId` thì
  // không lấy: AWOG không dùng tới, mà thứ không cần thì đừng mang đi.
  const entry: AwsAccountIdEntry = {
    profile: profile.name,
    accountId: parsed.data.Account,
    arn: parsed.data.Arn,
    at: nowIso,
    origin: 'sts',
  }
  // `credential_process` KHÔNG được cache (audit #2). Vân tay của nó chỉ thấy
  // dòng `credential_process = ...` trong config, nên cùng một lệnh trả về
  // credential của tài khoản KHÁC là thay đổi hoàn toàn vô hình — không mtime,
  // không trường nào lệch. Không có tín hiệu thì không có quyền nhớ; người dùng
  // vẫn thấy kết quả của lần bấm này, chỉ là AWOG không mang nó sang lần sau.
  if (profile.kind === 'process') return { ok: true, entry }

  return {
    ok: true,
    entry,
    cache: {
      profile: profile.name,
      accountId: parsed.data.Account,
      arn: parsed.data.Arn,
      at: nowIso,
      origin: 'sts',
      fp: profileFingerprint(profile, filesStamp),
    },
  }
}

// `runInfra` đã redact `stderr` trước khi nó rời tiến trình con; redact lần nữa
// ở đây là phòng thủ theo chiều sâu cho chuỗi ta TỰ ghép thêm.
function fail(detail: string): string {
  return redactString(detail).slice(0, MAX_ERROR_CHARS)
}

/**
 * Phân giải account id cho những profile được nêu tên — **CHỈ chạy khi người
 * dùng bấm một nút**.
 *
 * Profile SSO có `sso_account_id` ⇒ trả thẳng `origin:'config'`, KHÔNG gọi STS:
 * id đã nằm sẵn trong file, gọi mạng chỉ tốn thời gian để biết lại thứ đã biết.
 *
 * Một profile hỏng KHÔNG giết cả lô — nó rơi vào `failures[]`, các profile khác
 * vẫn chạy tiếp. Đây là thao tác hàng loạt trên một danh sách mà người dùng
 * chọn; hỏng một cái rồi vứt hết là bắt họ làm lại từ đầu.
 */
export async function resolveAccountIds(
  input: ResolveAccountIdsInput,
): Promise<AwsResolveAccountIdsResult> {
  const raw = input.names
  if (raw.length > MAX_NAMES) {
    throw opError('TOO_MANY', `at most ${MAX_NAMES} profiles per request (got ${raw.length})`)
  }

  const names: string[] = []
  const seen = new Set<string>()
  for (const name of raw) {
    if (!AWS_PROFILE_NAME_RE.test(name)) {
      throw opError('INVALID_NAME', `invalid profile name: ${name.slice(0, 64)}`)
    }
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  if (names.length === 0) return { entries: [], failures: [] }

  const profiles = await listAwsProfiles()
  const byName = new Map(profiles.map((p) => [p.name, p]))
  const nowIso = new Date().toISOString()

  const entries: AwsAccountIdEntry[] = []
  const failures: { profile: string; error: string }[] = []
  const needsSts: AwsProfile[] = []

  for (const name of names) {
    const profile = byName.get(name)
    if (!profile) {
      failures.push({ profile: name, error: 'Profile not found in ~/.aws' })
      continue
    }
    if (profile.ssoAccountId) {
      entries.push({
        profile: name,
        accountId: profile.ssoAccountId,
        at: nowIso,
        origin: 'config',
      })
      continue
    }
    needsSts.push(profile)
  }

  const surface: InfraSurface = input.surface ?? 'settings'
  // Đo stamp MỘT LẦN, TRƯỚC khi gọi STS: nếu đo sau, một lần sửa `~/.aws` xảy ra
  // trong lúc `aws` đang chạy sẽ được đóng dấu là "đã tính", và entry vừa ghi
  // mang vân tay của một cấu hình mà nó chưa từng đọc.
  const filesStamp = await awsFilesStamp()
  const results = await pooled(needsSts.length, (i) =>
    // `needsSts[i]` luôn tồn tại — `pooled` chỉ sinh index < count.
    resolveOne(needsSts[i] as AwsProfile, surface, nowIso, filesStamp),
  )

  const fresh: CacheEntry[] = []
  for (const result of results) {
    if (!result.ok) {
      failures.push(result.failure)
      continue
    }
    entries.push(result.entry)
    if (result.cache) fresh.push(result.cache)
  }

  if (fresh.length > 0) {
    const cached = await readCache()
    const replaced = new Set(fresh.map((e) => e.profile))
    const now = Date.parse(nowIso)
    // Dọn rác Ở ĐÂY chứ không ở đường đọc: entry của profile đã biến mất và entry
    // quá hạn không bao giờ được trả về, nhưng nếu không có chỗ nào gỡ chúng thì
    // file chỉ có lớn lên. Đây là đường GHI nên dọn là miễn phí.
    const keep = cached.filter(
      (e) => !replaced.has(e.profile) && byName.has(e.profile) && !isExpired(e, now),
    )
    try {
      await writeCache([...keep, ...fresh])
    } catch (err) {
      // Ghi cache hỏng ⇒ lần sau phải phân giải lại, nhưng kết quả lần này vẫn
      // đúng và người dùng vẫn dùng được. Không đổi nó thành lỗi của cả lượt.
      log.warn('aws: cannot persist resolved account ids', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  entries.sort((a, b) => a.profile.localeCompare(b.profile))
  failures.sort((a, b) => a.profile.localeCompare(b.profile))
  return { entries, failures }
}

// ─── TRƯỚC KHI NỐI cache này vào `accountKindOf()` ───────────────────────────
//
// Hôm nay cache mới chỉ để HIỂN THỊ: `decide()` lấy `accountId` từ
// `infraGate.context.accountId` (ngữ cảnh người dùng ghim), không ai tra
// `listAccountIds()` trong đường quyết định. Ngày ai đó nối — đó là mục đích tự
// khai ở đầu file — giá trị ở đây bắt đầu HẠ hàng rào, và ba điều dưới đây phải
// được chốt trước, không phải sau:
//
//  1. `origin` không ngang hàng nhau. `'config'` đọc live từ `~/.aws` mỗi lần
//     gọi, không qua cache, nên nó đáng tin bằng đúng file cấu hình của người
//     dùng. `'sts'` là một giá trị NHỚ SẴN trong một file — nó chỉ đáng tin bằng
//     quyền ghi của file đó. Nếu phải chọn, cho `'config'` hạ hàng rào và giữ
//     `'sts'` ở mức chỉ hiển thị.
//  2. `fp` KHÔNG phải chữ ký (xem đầu file). Muốn chống giả mạo thật thì phải là
//     HMAC bằng khoá trong OS keychain, không phải SHA-256 trên dữ liệu công
//     khai bằng thuật toán nằm trong repo.
//  3. Hàng rào hiện tại chỉ là `PROTECTED_PATH_RE` của `runtime/permission.ts`
//     — một phép so chuỗi, tức hàng rào ĐỘ SÂU. Nối vào ma trận quyền thì nó
//     thành hàng rào CHÍNH, và một phép so chuỗi không đủ làm hàng rào chính.
