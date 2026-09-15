// Gom những nguồn SSO mà MÁY NÀY đã biết (Mốc 1 A7).
//
// VÌ SAO: bước 1 của wizard "Nhập từ SSO" đang bắt gõ tay start URL + sso region
// + tên session. Nhưng ba chỗ trên máy thường đã có sẵn start URL rồi: block
// `[sso-session x]` trong `~/.aws/config`, profile SSO kiểu cũ mang thẳng
// `sso_start_url`, và file cache của những lần `aws sso login` trước. Bắt người
// dùng gõ lại thứ máy đã biết là thiếu sót.
// Ranh giới của lời hứa: trên máy CHƯA TỪNG dùng SSO thì start URL là giá trị
// chỉ tổ chức mới biết (`aws configure sso` cũng phải hỏi) — module này không
// hứa "không bao giờ phải gõ", nó hứa "máy đã biết thì không bắt gõ lại".
// Không có nguồn nào ⇒ mảng RỖNG, đó là trạng thái hợp lệ, không phải lỗi.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ INVARIANT #1 — file cache SSO chứa CREDENTIAL SỐNG.                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// `~/.aws/sso/cache/*.json` mang `accessToken` và `refreshToken`. Module này chỉ
// được phép giữ lại BA thứ từ mỗi file: `startUrl`, `region`, và `expiresAt` đã
// quy thành boolean `hasLiveToken`. Token không vào giá trị trả về, không vào
// log, không vào event, không vào nhật ký, không vào context của model — và
// không được gán vào biến nào sống lâu hơn một dòng (`readSourceFromCache` đọc
// đúng ba trường rồi buông object đã parse, không `slice` giá trị token bao giờ).
// `sso.ts` có `findAccessToken()` trả về token thật; CỐ Ý không import nó vào
// đây: ở bề mặt này ta chỉ cần metadata, nên đường dẫn tới token không tồn tại.
//
// Thư mục cache là NHÀ CHUNG của nhiều tool, không riêng aws-cli. Đo trên máy
// này: cạnh file cache chuẩn còn có `kiro-auth-token.json` với bộ trường khác
// hẳn (`accessToken`, `refreshToken`, `profileArn`, `authMethod`, `provider`) và
// KHÔNG có `startUrl`. File không có `startUrl` ⇒ bỏ qua IM LẶNG: nó không hỏng,
// nó chỉ không phải của chúng ta.
//
// Chỉ ĐỌC — module này không chạy lệnh nào, không ghi gì, nên không có
// `recordInfraAction`. Bề mặt của CON NGƯỜI; không AgentTool nào gọi tới.

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { log } from '../../util/logger.js'
import { parseAwsIni } from './ini.js'
import { awsConfigPath, listAwsProfiles } from './profiles.js'
import { assertStartUrl } from './sso.js'

const SSO_SESSION_PREFIX = 'sso-session '
const CONFIG_PROFILE_PREFIX = 'profile '

/** Cùng biên an toàn 60s như `sso.ts`: token hết hạn giữa chừng cho ra lỗi khó hiểu hơn là hỏi đăng nhập lại. */
const TOKEN_FRESHNESS_MARGIN_MS = 60_000

const REGION_RE = /^[a-z0-9-]{1,32}$/

export type AwsSsoSourceOrigin = 'sso-session' | 'profile' | 'cache'

export type AwsSsoSource = {
  /** Có khi nguồn là `[sso-session x]`; hai nguồn kia thì UI tự gợi ý tên. */
  sessionName?: string
  startUrl: string
  ssoRegion?: string
  origin: AwsSsoSourceOrigin
  /** Cache còn token chưa hết hạn ⇒ UI bỏ qua được bước đăng nhập. */
  hasLiveToken: boolean
  /** Số profile `kind === 'sso'` đang trỏ tới start URL này. */
  profileCount: number
}

/** Ứng viên thô trước khi gộp. `profileCount` tính ở bước cuối, không phải ở đây. */
type Candidate = {
  startUrl: string
  sessionName?: string
  ssoRegion?: string
  origin: AwsSsoSourceOrigin
  hasLiveToken: boolean
}

function opt<K extends string>(key: K, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {}
}

/**
 * Nhãn an toàn để LOG một start URL bị loại.
 *
 * Một trong hai lý do bị loại là "URL nhúng credential" (`https://u:p@host/…`) —
 * nên chính chuỗi đang báo lỗi có thể LÀ một mật khẩu. Cắt bỏ phần userinfo
 * (mọi thứ trước `@` đầu tiên của phần authority) trước khi chuỗi đó chạm log,
 * rồi mới cắt ngắn. Đo được: không có bước này thì ca test "URL nhúng
 * credential" in thẳng `https://u:p@corp.awsapps.com/start` ra nhật ký.
 */
export function safeUrlLabel(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.replace(/^([A-Za-z][\w+.-]*:\/\/)?[^/?#]*@/, '$1***@').slice(0, 120)
}

/**
 * Khoá gộp: bỏ `/` cuối, host thường hoá. `new URL().origin` đã lowercase host
 * sẵn, nên chỉ còn phải cắt `/` cuối của path.
 *
 * Trả null khi URL không hợp lệ theo luật L1 của `assertStartUrl` (phải https,
 * không nhúng credential) — đây là giá trị đọc từ file của người dùng.
 */
function normalizeStartUrl(raw: string): string | null {
  let validated: string
  try {
    validated = assertStartUrl(raw)
  } catch {
    log.warn('aws sso: skipping invalid start url', { startUrl: safeUrlLabel(raw) })
    return null
  }
  const url = new URL(validated)
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  return `${url.origin}${path}${url.search}${url.hash}`
}

function cleanRegion(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().toLowerCase()
  return trimmed && REGION_RE.test(trimmed) ? trimmed : undefined
}

// ─── Nguồn 1 + 2: `~/.aws/config` ───────────────────────────────────────────

// File thiếu ⇒ rỗng chứ không throw (khuôn `readIniFile` của `profiles.ts`):
// máy chưa cài AWS CLI là trạng thái hợp lệ.
async function readConfigIni(): Promise<ReturnType<typeof parseAwsIni>> {
  try {
    return parseAwsIni(await readFile(awsConfigPath(), 'utf8'))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      log.warn('aws sso: cannot read config file', { code })
    }
    return {}
  }
}

/** Tên section config → tên profile (`default` hoặc `profile x`), null nếu không phải profile. */
function profileNameFromConfigSection(section: string): string | null {
  if (section === 'default') return 'default'
  if (!section.startsWith(CONFIG_PROFILE_PREFIX)) return null
  return section.slice(CONFIG_PROFILE_PREFIX.length).trim() || null
}

// ─── Nguồn 3: cache của `aws sso login` ─────────────────────────────────────

/** `~/.aws/sso/cache` — neo theo thư mục của `config` để `AWS_CONFIG_FILE` vẫn đúng (giống `sso.ts`). */
function ssoCacheDir(): string {
  return join(dirname(awsConfigPath()), 'sso', 'cache')
}

/**
 * Đọc METADATA của một file cache. KHÔNG trả token, không log token.
 *
 * Narrow bằng tay chứ không qua zod: thông báo lỗi của zod có thể mang theo giá
 * trị đã nhận, mà giá trị ở đây là access token.
 */
function readSourceFromCache(raw: string): Candidate | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>

  // Không có `startUrl` ⇒ file của tool khác (vd `kiro-auth-token.json`). Bỏ qua
  // im lặng: nó không hỏng, chỉ là không phải của chúng ta.
  const rawStartUrl = obj.startUrl
  if (typeof rawStartUrl !== 'string' || rawStartUrl === '') return null
  const startUrl = normalizeStartUrl(rawStartUrl)
  if (!startUrl) return null

  // `expiresAt` quy NGAY thành boolean — đây là toàn bộ thứ ta được giữ lại về
  // trạng thái của token.
  const expiresAt = typeof obj.expiresAt === 'string' ? Date.parse(obj.expiresAt) : Number.NaN
  const hasLiveToken =
    typeof obj.accessToken === 'string' &&
    obj.accessToken !== '' &&
    !Number.isNaN(expiresAt) &&
    expiresAt - TOKEN_FRESHNESS_MARGIN_MS > Date.now()

  return {
    startUrl,
    ...opt('ssoRegion', cleanRegion(typeof obj.region === 'string' ? obj.region : undefined)),
    origin: 'cache',
    hasLiveToken,
  }
}

async function collectFromCache(): Promise<Candidate[]> {
  const dir = ssoCacheDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return [] // Chưa từng `aws sso login` ⇒ chưa có thư mục. Hợp lệ.
  }
  const out: Candidate[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const candidate = readSourceFromCache(await readFile(join(dir, name), 'utf8'))
      if (candidate) out.push(candidate)
    } catch {
      continue // Một file hỏng không được làm chết cả danh sách.
    }
  }
  return out
}

// ─── Gộp ────────────────────────────────────────────────────────────────────

const ORIGIN_RANK: Record<AwsSsoSourceOrigin, number> = { 'sso-session': 0, profile: 1, cache: 2 }

/**
 * Gom mọi nguồn SSO máy đã biết, gộp theo start URL đã chuẩn hoá.
 *
 * Ứng viên được nạp theo thứ tự ưu tiên `sso-session` > `profile` > `cache`, nên
 * khi gộp: `origin` lấy của cái hạng cao nhất, `sessionName`/`ssoRegion` lấy giá
 * trị ĐẦU TIÊN tìm được, `hasLiveToken` là phép OR.
 *
 * Xếp: có token sống trước (bỏ qua được bước đăng nhập), rồi số profile giảm
 * dần, rồi theo tên cho ổn định.
 */
export async function listSsoSources(): Promise<AwsSsoSource[]> {
  const [config, profiles] = await Promise.all([readConfigIni(), listAwsProfiles()])

  const candidates: Candidate[] = []

  // Nguồn 1 — block `[sso-session x]`: tin cậy nhất, đây là cấu hình hiện hành.
  for (const [section, body] of Object.entries(config)) {
    if (!section.startsWith(SSO_SESSION_PREFIX)) continue
    const sessionName = section.slice(SSO_SESSION_PREFIX.length).trim()
    const startUrl = body.keys.sso_start_url ? normalizeStartUrl(body.keys.sso_start_url) : null
    if (!sessionName || !startUrl) continue
    candidates.push({
      startUrl,
      sessionName,
      ...opt('ssoRegion', cleanRegion(body.keys.sso_region)),
      origin: 'sso-session',
      hasLiveToken: false,
    })
  }

  // Nguồn 2 — profile SSO kiểu cũ. `listAwsProfiles()` đã resolve `ssoStartUrl`
  // qua `sso_session`, nhưng `AwsProfile` không mang `sso_region`, nên region
  // phải đọc thêm từ chính section config của profile đó (không đổi shape
  // `AwsProfile` — ngoài phạm vi A7).
  const regionByProfile = new Map<string, string>()
  for (const [section, body] of Object.entries(config)) {
    const name = profileNameFromConfigSection(section)
    const region = cleanRegion(body.keys.sso_region)
    if (name && region) regionByProfile.set(name, region)
  }

  // Đếm profile theo start URL — dùng chung cho `profileCount` ở cuối.
  const profileCountByUrl = new Map<string, number>()
  for (const profile of profiles) {
    if (profile.kind !== 'sso' || !profile.ssoStartUrl) continue
    const startUrl = normalizeStartUrl(profile.ssoStartUrl)
    if (!startUrl) continue
    profileCountByUrl.set(startUrl, (profileCountByUrl.get(startUrl) ?? 0) + 1)
    candidates.push({
      startUrl,
      ...opt('sessionName', profile.ssoSession),
      ...opt('ssoRegion', regionByProfile.get(profile.name)),
      origin: 'profile',
      hasLiveToken: false,
    })
  }

  // Nguồn 3 — cache. Xếp cuối vì nó chỉ chứng minh "đã từng đăng nhập", không
  // chứng minh cấu hình hiện tại còn dùng start URL đó.
  candidates.push(...(await collectFromCache()))

  const merged = new Map<string, AwsSsoSource>()
  for (const candidate of candidates) {
    const prev = merged.get(candidate.startUrl)
    if (!prev) {
      merged.set(candidate.startUrl, {
        startUrl: candidate.startUrl,
        ...opt('sessionName', candidate.sessionName),
        ...opt('ssoRegion', candidate.ssoRegion),
        origin: candidate.origin,
        hasLiveToken: candidate.hasLiveToken,
        profileCount: 0,
      })
      continue
    }
    if (ORIGIN_RANK[candidate.origin] < ORIGIN_RANK[prev.origin]) prev.origin = candidate.origin
    if (!prev.sessionName && candidate.sessionName) prev.sessionName = candidate.sessionName
    if (!prev.ssoRegion && candidate.ssoRegion) prev.ssoRegion = candidate.ssoRegion
    prev.hasLiveToken = prev.hasLiveToken || candidate.hasLiveToken
  }

  for (const source of merged.values()) {
    source.profileCount = profileCountByUrl.get(source.startUrl) ?? 0
  }

  return [...merged.values()].sort((a, b) => {
    if (a.hasLiveToken !== b.hasLiveToken) return a.hasLiveToken ? -1 : 1
    if (a.profileCount !== b.profileCount) return b.profileCount - a.profileCount
    return (a.sessionName ?? a.startUrl).localeCompare(b.sessionName ?? b.startUrl)
  })
}
