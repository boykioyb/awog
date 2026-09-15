// Khám phá account/role từ AWS SSO và sinh profile hàng loạt (Mốc 1 A5).
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ ĐÁNH ĐỔI PHẢI ĐỌC TRƯỚC KHI SỬA FILE NÀY — cần infosec chốt.             ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// `aws sso list-accounts` và `sso list-account-roles` của CLI v2 **bắt buộc** có
// `--access-token <giá trị>`; không có biến môi trường nào thay được, và CLI
// không tự lấy token từ cache cho hai lệnh này (khác `aws s3 ls --profile x`,
// nơi CLI tự resolve). Nên AWOG phải đọc token từ `~/.aws/sso/cache/<sha1>.json`
// rồi truyền nó **qua argv**.
//
// GIÁ TRỊ token thì KHÔNG đi qua argv — đó là cái đã sửa. AWS CLI mở rộng
// `file://<đường dẫn>` thành NỘI DUNG file cho tham số chuỗi, nên AWOG ghi token
// ra một file tạm 0600 trong `~/.awog` (thư mục vốn 0700, tên ngẫu nhiên,
// `flag:'wx'`) và truyền `file://<abs>`; `finally` xoá file. Dòng lệnh khi đó
// chỉ còn một đường dẫn, nên `ps` / EDR / log dòng lệnh không thấy token nữa.
//
// Đo trên máy (aws-cli 2.35.9) trước khi đổi, vì "CLI có mở rộng file:// cho
// CHÍNH cờ này không" là thứ phải biết chắc chứ không đoán:
//   · `--access-token file:///không-tồn-tại` ⇒ lỗi CỤC BỘ `ParamValidation:
//     Unable to load paramfile` (chưa hề gọi mạng) ⇒ cờ này CÓ được mở rộng.
//   · `--access-token file://<file chứa token>` và `--access-token <token>` cho
//     ra cùng một `UnauthorizedException` ⇒ nội dung file tới API y hệt.
// File ghi KHÔNG có ký tự xuống dòng cuối — CLI đọc nguyên văn byte trong file.
//
// Hệ quả phải biết: `classify()` nâng lớp mọi lệnh có `file://` từ `read` lên
// `write` (một đối số `file://` biến lệnh thành đường đọc file tuỳ ý). Ở đây vô
// hại — hai lệnh này luôn đi với `decision:'approved'` của bề mặt con người, và
// `runInfra` không chặn theo lớp — nhưng dòng nhật ký của chúng nay ghi `write`.
// Đó là thay đổi có chủ đích, không phải hồi quy.
//
// Phương án thay thế đã cân nhắc và TỪ CHỐI ở v1: gọi thẳng HTTP tới
// `portal.sso.<region>.amazonaws.com/assignment/accounts` với header
// `x-amz-sso_bearer_token` — token đi trong header, không qua argv. Từ chối vì
// nó trái ADR 0088 §3 ("mọi lời gọi hạ tầng đi qua CLI, không SDK, không tự ký
// request") và mở một bề mặt mạng mới ngay cạnh guard SSRF của invariant #7.
// Đổi một rò rỉ cục bộ đã biết lấy một bề mặt mạng mới là vụ đổi tồi hơn.
//
// Ba hàng rào vẫn giữ nguyên:
//   1. Token KHÔNG BAO GIỜ rời sidecar: không vào giá trị trả về của RPC, không
//      vào log, không vào `recordInfraAction`. `scrubToken()` bên dưới còn chà
//      nó khỏi stderr trước khi chuỗi đó đi bất cứ đâu.
//   2. Nhật ký che theo CẶP cờ-giá-trị (`maskCredentialFlagValues` trong
//      `audit/store.ts`) — lớp lọc theo HÌNH DẠNG không bắt được token SSO vì nó
//      là chuỗi opaque không tiền tố, và `redactString()` cố ý không che chuỗi
//      entropy cao trần.
//   3. `sso get-role-credentials` — lệnh thật sự PHÁT credential — vẫn nằm
//      nguyên trong danh sách chặn cứng của `classify.ts`. AWOG chỉ LIỆT KÊ
//      account/role; việc đổi role lấy khoá tạm là của chính AWS CLI.
//
// Đây là bề mặt chỉ của con người. Không AgentTool nào gọi được file này.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { log } from '../../util/logger.js'
import { awogHome } from '../../util/path.js'
import { recordInfraAction } from '../audit/store.js'
import { runInfra } from '../run.js'
import { parseAwsIni } from './ini.js'
import { AWS_PROFILE_NAME_RE, awsConfigPath, awsCredentialsPath, deriveKind } from './profiles.js'
import { applyAwsIniEdits } from './write.js'
import type { IniEdit } from './ini-edit.js'

// ─── Hằng ───────────────────────────────────────────────────────────────────

/** `aws sso login` mở trình duyệt và chờ người dùng bấm — 60s mặc định là quá ngắn. */
const LOGIN_TIMEOUT_MS = 180_000
const LIST_TIMEOUT_MS = 60_000

/** Phạm vi OIDC tối thiểu để `list-accounts`/`list-account-roles` không trả 403. */
const REGISTRATION_SCOPES = 'sso:account:access'

const SSO_SESSION_PREFIX = 'sso-session '

/**
 * Trần số account duyệt role. Mỗi account là một lời gọi CLI riêng (~1s), nên
 * một tổ chức 500 account sẽ treo UI hàng phút. Vượt trần thì NÓI RA trong
 * `warnings` chứ không cắt im lặng.
 */
const MAX_ACCOUNTS_FOR_ROLES = 100

/** Khoá config của kiểu KHÁC SSO — phải biến mất khi một profile thành SSO. */
const STALE_CONFIG_KEYS_FOR_SSO = [
  'role_arn',
  'source_profile',
  'mfa_serial',
  'external_id',
  'duration_seconds',
  'sso_start_url',
  'sso_region',
] as const

const SECRET_INI_KEYS = ['aws_access_key_id', 'aws_secret_access_key', 'aws_session_token'] as const

const REGION_RE = /^[a-z0-9-]{1,32}$/
const ACCOUNT_ID_RE = /^[0-9]{12}$/
/** Bộ ký tự IAM cho phép trong tên role. */
const ROLE_NAME_RE = /^[\w+=,.@-]{1,64}$/

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

export type SsoLoginInput = { sessionName: string; startUrl: string; ssoRegion: string }

export type SsoAccount = {
  accountId: string
  accountName: string
  emailAddress?: string
  roles: string[]
}

export type SsoListResult =
  | { ok: true; accounts: SsoAccount[]; warnings: string[] }
  | { ok: false; error: string; needsLogin?: boolean }

export type SsoPick = { accountId: string; roleName: string; profileName: string }

export type SsoCreateInput = {
  sessionName: string
  ssoRegion: string
  startUrl: string
  region?: string | undefined
  picks: readonly SsoPick[]
  overwrite?: boolean | undefined
}

export type SsoCreateResult = {
  ok: true
  created: string[]
  skipped: string[]
  backups: string[]
  /** Profile bị ghi đè mà AWOG đã gỡ khoá dài hạn cũ khỏi `~/.aws/credentials`. */
  clearedStaticKeys: string[]
  warnings: string[]
}

// ─── Validate biên (L1) ─────────────────────────────────────────────────────
//
// `assertStartUrl`, `scrubToken`, `findAccessToken` và `withTokenFile` được
// export cho bộ test: chúng là ba hàng rào của file này (validate biên, chà
// token khỏi stderr, không để token vào argv) và phải đo được TRỰC TIẾP, chứ
// không gián tiếp qua một lần spawn `aws` thật.

function assertSessionName(name: string): string {
  const trimmed = name.trim()
  // Tên này thành `[sso-session <name>]`, tức một tên section — dùng đúng bộ ký
  // tự của tên profile để không có đường chèn `]` đóng section sớm.
  if (!AWS_PROFILE_NAME_RE.test(trimmed)) {
    throw new Error(`INVALID_NAME: "${trimmed.slice(0, 64)}" is not a valid SSO session name`)
  }
  return trimmed
}

function assertRegion(region: string): string {
  const trimmed = region.trim()
  if (!REGION_RE.test(trimmed)) throw new Error(`INVALID_REGION: ${trimmed.slice(0, 64)}`)
  return trimmed
}

/**
 * Start URL phải là HTTPS và không mang credential nhúng. Đây là một giá trị ghi
 * vào `~/.aws/config` rồi CLI sẽ tự mở — coi nó là L1 và fail fast.
 */
export function assertStartUrl(raw: string): string {
  const trimmed = raw.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('INVALID_START_URL: not a URL')
  }
  if (url.protocol !== 'https:') throw new Error('INVALID_START_URL: must be https')
  if (url.username !== '' || url.password !== '') {
    throw new Error('INVALID_START_URL: must not embed credentials')
  }
  return trimmed
}

// ─── Cache token ────────────────────────────────────────────────────────────

/** `~/.aws/sso/cache` — neo theo thư mục của `config` để `AWS_CONFIG_FILE` vẫn đúng. */
function ssoCacheDir(): string {
  return join(dirname(awsConfigPath()), 'sso', 'cache')
}

type CachedToken = { accessToken: string; expiresAt: number; startUrl: string | null }

/**
 * Narrow bằng tay chứ không qua zod: thông báo lỗi của zod có thể mang theo giá
 * trị đã nhận, và giá trị ở đây là access token.
 */
function readCachedToken(raw: string): CachedToken | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  const accessToken = obj.accessToken
  const expiresAt = obj.expiresAt
  if (typeof accessToken !== 'string' || accessToken === '') return null
  if (typeof expiresAt !== 'string') return null
  const ms = Date.parse(expiresAt)
  if (Number.isNaN(ms)) return null
  return {
    accessToken,
    expiresAt: ms,
    startUrl: typeof obj.startUrl === 'string' ? obj.startUrl : null,
  }
}

/** 60s biên an toàn: token hết hạn giữa lúc gọi cho ra lỗi khó hiểu hơn là hỏi đăng nhập lại. */
function isFresh(token: CachedToken): boolean {
  return token.expiresAt - 60_000 > Date.now()
}

/**
 * Tìm access token còn hạn của một sso-session.
 *
 * Đường chính: AWS CLI v2 đặt tên file cache theo `sha1(<tên sso-session>)` cho
 * cấu hình kiểu `[sso-session x]`. Đường lùi: quét cả thư mục cache và khớp theo
 * `startUrl` — cần cho cấu hình đời cũ (cache đặt tên theo sha1 của start URL)
 * và cho token do một phiên CLI khác vừa tạo.
 *
 * Trả về chuỗi token hoặc null. KHÔNG log, KHÔNG ném kèm giá trị.
 */
export async function findAccessToken(sessionName: string, startUrl: string | null): Promise<string | null> {
  const dir = ssoCacheDir()
  const primary = join(dir, `${createHash('sha1').update(sessionName).digest('hex')}.json`)
  try {
    const token = readCachedToken(await readFile(primary, 'utf8'))
    if (token && isFresh(token)) return token.accessToken
  } catch {
    // Không có file là chuyện bình thường — rơi xuống đường lùi.
  }

  if (startUrl === null) return null
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const token = readCachedToken(await readFile(join(dir, name), 'utf8'))
      if (token && token.startUrl === startUrl && isFresh(token)) return token.accessToken
    } catch {
      continue
    }
  }
  return null
}

/**
 * Chà giá trị token ra khỏi một chuỗi sắp đi ra ngoài sidecar.
 *
 * `redactString()` của `run.ts` không cứu được ca này: token SSO là chuỗi opaque
 * không tiền tố, và bộ lọc theo hình dạng CỐ Ý không che chuỗi entropy cao trần
 * (che thì nuốt luôn mọi SHA, mọi id). Ở đây ta biết CHÍNH XÁC chuỗi cần che nên
 * so khớp literal là đủ và không có dương tính giả.
 */
export function scrubToken(text: string, token: string): string {
  return token === '' ? text : text.split(token).join('[redacted]')
}

/**
 * Ghi token ra file tạm 0600 rồi chạy `fn` với đối số `file://<abs>`; xoá file
 * trong `finally` dù `fn` ném hay không.
 *
 * `~/.awog` chứ không `os.tmpdir()`: thư mục đó của AWOG là 0700, còn `/tmp` là
 * thư mục chung — một file 0600 ở đó vẫn lộ SỰ TỒN TẠI và tên cho mọi user.
 */
export async function withTokenFile<T>(token: string, fn: (arg: string) => Promise<T>): Promise<T> {
  const dir = awogHome()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, `sso-token-${randomBytes(16).toString('hex')}`)
  // `wx` ⇒ không bao giờ ghi đè một entry đã tồn tại (kể cả symlink ai đó đặt sẵn).
  // KHÔNG có `\n` cuối: CLI lấy nguyên văn byte trong file làm giá trị tham số.
  await writeFile(file, token, { flag: 'wx', mode: 0o600 })
  try {
    return await fn(`file://${file}`)
  } finally {
    await rm(file, { force: true })
  }
}

// ─── Đọc cấu hình sso-session ───────────────────────────────────────────────

type SsoSessionConfig = { startUrl: string | null; ssoRegion: string | null }

async function readSsoSession(sessionName: string): Promise<SsoSessionConfig | null> {
  let raw = ''
  try {
    raw = await readFile(awsConfigPath(), 'utf8')
  } catch {
    return null
  }
  const section = parseAwsIni(raw)[`${SSO_SESSION_PREFIX}${sessionName}`]
  if (!section) return null
  return {
    startUrl: section.keys.sso_start_url ?? null,
    ssoRegion: section.keys.sso_region ?? null,
  }
}

/** Ghi/cập nhật block `[sso-session x]`. Không có secret nào trong block này. */
function ssoSessionEdit(sessionName: string, startUrl: string, ssoRegion: string): IniEdit {
  return {
    op: 'upsertSection',
    section: `${SSO_SESSION_PREFIX}${sessionName}`,
    keys: {
      sso_start_url: startUrl,
      sso_region: ssoRegion,
      sso_registration_scopes: REGISTRATION_SCOPES,
    },
  }
}

// ─── A5 — đăng nhập ─────────────────────────────────────────────────────────

/**
 * Ghi block `[sso-session x]` rồi chạy `aws sso login --sso-session x`.
 *
 * Lệnh này mở trình duyệt của người dùng và chờ họ duyệt — không có token nào đi
 * qua AWOG ở bước này; AWS CLI tự ghi `~/.aws/sso/cache`.
 */
export async function ssoLogin(
  input: SsoLoginInput,
): Promise<{ ok: true; backups: string[] } | { ok: false; error: string }> {
  const sessionName = assertSessionName(input.sessionName)
  const startUrl = assertStartUrl(input.startUrl)
  const ssoRegion = assertRegion(input.ssoRegion)

  const { backup } = await applyAwsIniEdits('config', [
    ssoSessionEdit(sessionName, startUrl, ssoRegion),
  ])
  await recordInfraAction({
    actor: 'human',
    surface: 'settings',
    tool: 'sso_session_save',
    argv: ['sso-session', sessionName, startUrl, ssoRegion],
    context: { region: ssoRegion },
    class: 'write',
    decision: 'approved',
    result: { summary: `wrote [sso-session ${sessionName}] to ~/.aws/config` },
  })

  // Ngữ cảnh RỖNG là cố ý: `aws sso login --sso-session x` không nhận `--profile`,
  // và `runInfra` chèn cờ ngữ cảnh từ `context` — đưa profile vào đây sẽ sinh ra
  // một dòng lệnh sai cú pháp.
  const result = await runInfra({
    tool: 'aws',
    args: ['sso', 'login', '--sso-session', sessionName],
    context: {},
    actor: 'human',
    surface: 'settings',
    toolName: 'sso_login',
    decision: 'approved',
    timeoutMs: LOGIN_TIMEOUT_MS,
  })

  const backups = backup ? [backup] : []
  if (!result.ok) return { ok: false, error: result.stderr.trim() || 'aws sso login failed' }
  return { ok: true, backups }
}

// ─── A5 — liệt kê account + role ────────────────────────────────────────────

type AwsListAccounts = { accountList?: unknown }
type AwsListRoles = { roleList?: unknown }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function looksExpired(text: string): boolean {
  return /expired|unauthorized|invalid.{0,12}token|forbidden|accessdenied/i.test(text)
}

/**
 * Liệt kê account và role mà sso-session này đang có quyền thấy.
 *
 * Token hết hạn / chưa từng đăng nhập ⇒ `{ ok:false, needsLogin:true }` chứ không
 * ném: đó là trạng thái bình thường của luồng (UI hiện nút "Đăng nhập SSO"), và
 * một exception ở đây chỉ làm nó trông như lỗi hệ thống.
 */
export async function ssoListAccounts(input: { sessionName: string }): Promise<SsoListResult> {
  const sessionName = assertSessionName(input.sessionName)
  const session = await readSsoSession(sessionName)
  if (!session || !session.ssoRegion) {
    return { ok: false, error: `No [sso-session ${sessionName}] in ~/.aws/config`, needsLogin: true }
  }
  const ssoRegion = assertRegion(session.ssoRegion)

  const token = await findAccessToken(sessionName, session.startUrl)
  if (token === null) {
    return { ok: false, error: 'No valid SSO token in the cache', needsLogin: true }
  }

  return withTokenFile(token, (tokenArg) => listWithToken(tokenArg, token, ssoRegion))
}

/**
 * Phần thân của `ssoListAccounts` sau khi token đã nằm trong file tạm.
 *
 * `tokenArg` là `file://…` (thứ đi vào argv); `token` là giá trị thật, chỉ dùng
 * để `scrubToken` chà nó khỏi stderr — CLI có thể in lại token trong một số lỗi.
 */
async function listWithToken(
  tokenArg: string,
  token: string,
  ssoRegion: string,
): Promise<SsoListResult> {
  const listed = await runInfra({
    tool: 'aws',
    args: ['sso', 'list-accounts', '--access-token', tokenArg, '--output', 'json'],
    context: { region: ssoRegion },
    actor: 'human',
    surface: 'settings',
    toolName: 'sso_list_accounts',
    decision: 'approved',
    timeoutMs: LIST_TIMEOUT_MS,
  })
  if (!listed.ok) {
    const error = scrubToken(listed.stderr.trim() || 'aws sso list-accounts failed', token)
    return { ok: false, error, ...(looksExpired(error) ? { needsLogin: true } : {}) }
  }

  let payload: AwsListAccounts
  try {
    payload = JSON.parse(listed.stdout) as AwsListAccounts
  } catch {
    return { ok: false, error: 'aws sso list-accounts returned invalid JSON' }
  }
  const rawList = Array.isArray(payload.accountList) ? payload.accountList : []

  const accounts: SsoAccount[] = []
  const warnings: string[] = []
  for (const item of rawList) {
    const rec = asRecord(item)
    const accountId = str(rec?.accountId)
    if (!accountId || !ACCOUNT_ID_RE.test(accountId)) continue
    const email = str(rec?.emailAddress)
    accounts.push({
      accountId,
      accountName: str(rec?.accountName) ?? accountId,
      ...(email !== null ? { emailAddress: email } : {}),
      roles: [],
    })
  }

  const forRoles = accounts.slice(0, MAX_ACCOUNTS_FOR_ROLES)
  if (accounts.length > forRoles.length) {
    warnings.push(
      `Listed ${accounts.length} accounts but only fetched roles for the first ${forRoles.length}`,
    )
  }

  // Tuần tự chứ không song song: mỗi lời gọi là một tiến trình `aws`, và bắn 100
  // tiến trình cùng lúc sẽ ăn hết RAM trước khi tiết kiệm được giây nào.
  for (const account of forRoles) {
    const roles = await runInfra({
      tool: 'aws',
      args: [
        'sso',
        'list-account-roles',
        '--access-token',
        tokenArg,
        '--account-id',
        account.accountId,
        '--output',
        'json',
      ],
      context: { region: ssoRegion, accountId: account.accountId },
      actor: 'human',
      surface: 'settings',
      toolName: 'sso_list_account_roles',
      decision: 'approved',
      timeoutMs: LIST_TIMEOUT_MS,
    })
    if (!roles.ok) {
      // Một account lỗi không được làm hỏng cả danh sách — người dùng thường chỉ
      // cần một trong số chúng.
      warnings.push(`Could not list roles for ${account.accountId}`)
      log.warn('sso: list-account-roles failed', { accountId: account.accountId })
      continue
    }
    try {
      const body = JSON.parse(roles.stdout) as AwsListRoles
      const list = Array.isArray(body.roleList) ? body.roleList : []
      account.roles = list
        .map((item) => str(asRecord(item)?.roleName))
        .filter((name): name is string => name !== null && ROLE_NAME_RE.test(name))
    } catch {
      warnings.push(`Could not parse roles for ${account.accountId}`)
    }
  }

  return { ok: true, accounts, warnings }
}

// ─── A5 — sinh profile hàng loạt ────────────────────────────────────────────

/**
 * Ghi các profile SSO đã tick vào `~/.aws/config`.
 *
 * Profile SSO KHÔNG sinh ra secret dài hạn nào — credential của nó là token tạm
 * trong `~/.aws/sso/cache`, do chính AWS CLI quản. Đây cũng là lý do spec gọi
 * luồng này là "giá trị cao nhất" của màn Nhập.
 *
 * NHƯNG "ghi đè" phải là THAY THẾ, giống `applyImport`: đè một profile SSO lên
 * một profile static cũ mà chỉ ghi `config` sẽ để `aws_access_key_id` mồ côi
 * trong `credentials`, và botocore vẫn dùng khoá đó — danh sách hiện "SSO"
 * trong khi lệnh chạy bằng khoá dài hạn người dùng tin là đã bỏ. Nên lần ghi đè
 * còn gỡ ba khoá secret và các khoá config của kiểu cũ, rồi NÓI RA đã gỡ ở đâu
 * (`clearedStaticKeys`) thay vì im lặng ở cả hai chiều.
 */
export async function ssoCreateProfiles(input: SsoCreateInput): Promise<SsoCreateResult> {
  const sessionName = assertSessionName(input.sessionName)
  const startUrl = assertStartUrl(input.startUrl)
  const ssoRegion = assertRegion(input.ssoRegion)
  const region = input.region !== undefined ? assertRegion(input.region) : null

  let configRaw = ''
  try {
    configRaw = await readFile(awsConfigPath(), 'utf8')
  } catch {
    // Chưa có `~/.aws/config` — mọi profile đều là mới.
  }
  const config = parseAwsIni(configRaw)

  let credentialsRaw = ''
  try {
    credentialsRaw = await readFile(awsCredentialsPath(), 'utf8')
  } catch {
    // Chưa có `~/.aws/credentials` — không có khoá cũ nào để gỡ.
  }
  const credentialSections = parseAwsIni(credentialsRaw)

  const edits: IniEdit[] = [ssoSessionEdit(sessionName, startUrl, ssoRegion)]
  const credentialEdits: IniEdit[] = []
  const created: string[] = []
  const skipped: string[] = []
  const clearedStaticKeys: string[] = []
  const warnings: string[] = []

  for (const pick of input.picks) {
    if (!AWS_PROFILE_NAME_RE.test(pick.profileName)) {
      throw new Error(`INVALID_NAME: "${pick.profileName.slice(0, 64)}" is not a valid profile name`)
    }
    if (!ACCOUNT_ID_RE.test(pick.accountId)) {
      throw new Error(`INVALID_ACCOUNT_ID: ${pick.accountId.slice(0, 32)}`)
    }
    if (!ROLE_NAME_RE.test(pick.roleName)) {
      throw new Error(`INVALID_ROLE_NAME: ${pick.roleName.slice(0, 64)}`)
    }

    const section = pick.profileName === 'default' ? 'default' : `profile ${pick.profileName}`
    const existingConfig = config[section]
    if (existingConfig && input.overwrite !== true) {
      skipped.push(pick.profileName)
      continue
    }
    // Luật cứng #3: `credential_process` chỉ ĐỌC ở v1. `profile-ops.ts` ép luật
    // này trên đường CRUD; đây là đường ghi thứ hai vào cùng file nên phải tự ép.
    if (existingConfig && deriveKind(existingConfig.keys, existingConfig.hasStaticKeys) === 'process') {
      skipped.push(pick.profileName)
      warnings.push(`Profile "${pick.profileName}" uses credential_process and is read-only in v1`)
      continue
    }

    edits.push({
      op: 'upsertSection',
      section,
      keys: {
        sso_session: sessionName,
        sso_account_id: pick.accountId,
        sso_role_name: pick.roleName,
        ...(region !== null ? { region } : {}),
      },
      // Khoá của kiểu cũ (assume-role, hoặc một cấu hình SSO thủ công) phải biến
      // mất — để lại `role_arn` cạnh `sso_*` là một profile hai đầu.
      ...(existingConfig ? { removeKeys: STALE_CONFIG_KEYS_FOR_SSO } : {}),
    })

    const existingCreds = credentialSections[pick.profileName]
    if (existingCreds && (existingCreds.hasStaticKeys || existingCreds.hasSessionToken)) {
      credentialEdits.push({
        op: 'upsertSection',
        section: pick.profileName,
        keys: {},
        removeKeys: SECRET_INI_KEYS,
      })
      clearedStaticKeys.push(pick.profileName)
    }
    created.push(pick.profileName)
  }

  const { backup } = await applyAwsIniEdits('config', edits)
  const credentialBackups: string[] = []
  if (credentialEdits.length > 0) {
    const applied = await applyAwsIniEdits('credentials', credentialEdits)
    if (applied.backup) credentialBackups.push(applied.backup)
  }

  await recordInfraAction({
    actor: 'human',
    surface: 'settings',
    tool: 'sso_create_profiles',
    argv: ['sso-create-profiles', sessionName, ...created],
    context: { region: ssoRegion },
    class: 'write',
    decision: 'approved',
    result: {
      summary:
        `created ${created.length} SSO profile(s), skipped ${skipped.length}` +
        (clearedStaticKeys.length > 0
          ? `, cleared static keys of ${clearedStaticKeys.length}`
          : ''),
    },
  })

  return {
    ok: true,
    created,
    skipped,
    backups: [...(backup ? [backup] : []), ...credentialBackups],
    clearedStaticKeys,
    warnings,
  }
}
