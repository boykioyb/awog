// Danh sách profile AWS — gộp `~/.aws/config` + `~/.aws/credentials` (ADR 0088
// §1/§2, việc 0.5).
//
// INVARIANT #1 — đường ĐỌC này không bao giờ nạp giá trị secret. Nó chỉ nhận
// những gì `parseAwsIni()` cho qua (metadata + hai boolean), nên không có chỗ
// nào trong file này chạm tới `aws_secret_access_key`/`aws_session_token`. Ghi
// vào `~/.aws` là chuyện của trình soạn INI ở Mốc 1 (ADR 0088 §1b) — module
// này CHỈ đọc.
//
// `~/.aws` nằm NGOÀI workspace nên không đi qua `fs.*` RPC / `assertInsideWorkspace`
// (ADR 0022 chặn đúng như thiết kế). Bù lại, đường dẫn ở đây là allowlist cứng:
// đúng hai file, không có tham số nào nhận path từ UI hay từ model. Hai biến
// môi trường `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE` là env của chính
// tiến trình (L4 — tin được) và là cách AWS CLI chính thức đổi vị trí file, nên
// honor chúng là đúng ngữ nghĩa chứ không phải mở cửa.
//
// Không có store, không cache: danh sách derive mỗi lần gọi (ADR 0088 §2).

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { log } from '../../util/logger.js'
import { parseAwsIni, type AwsIniFile, type AwsIniSection } from './ini.js'

export type AwsProfileKind = 'sso' | 'assume-role' | 'process' | 'static' | 'unknown'

/** Profile khai ở file nào. `both` = có cả config lẫn credentials. */
export type AwsProfileSource = 'config' | 'credentials' | 'both'

export type AwsProfile = {
  name: string
  region?: string
  output?: string
  kind: AwsProfileKind
  ssoStartUrl?: string
  ssoSession?: string
  ssoAccountId?: string
  ssoRoleName?: string
  roleArn?: string
  sourceProfile?: string
  mfaSerial?: string
  hasStaticKeys: boolean
  hasSessionToken: boolean
  /** ISO 8601, từ `x_security_token_expires` (credential tạm). */
  expiresAt?: string
  source: AwsProfileSource
}

// Cùng bộ ký tự AWS cho phép, và CỐ Ý rộng hơn `SSH_ID_RE`: profile thật trên
// máy dev có dạng `229015218011_Offshore-Developer` — chữ hoa, gạch dưới, gạch
// nối — nên một regex kiểu slug sẽ lặng lẽ nuốt mất profile của người dùng.
const PROFILE_NAME_RE = /^[A-Za-z0-9._@:/+=-]{1,128}$/

const SSO_SESSION_PREFIX = 'sso-session '
const CONFIG_PROFILE_PREFIX = 'profile '

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

export function awsConfigPath(): string {
  const fromEnv = process.env.AWS_CONFIG_FILE?.trim()
  return fromEnv ? resolve(expandHome(fromEnv)) : join(homedir(), '.aws', 'config')
}

export function awsCredentialsPath(): string {
  const fromEnv = process.env.AWS_SHARED_CREDENTIALS_FILE?.trim()
  return fromEnv ? resolve(expandHome(fromEnv)) : join(homedir(), '.aws', 'credentials')
}

// File thiếu ⇒ rỗng, không throw: không có `~/.aws` là trạng thái hợp lệ của
// một máy chưa cài AWS CLI. Lỗi khác (quyền, là thư mục) thì warn rồi cũng coi
// như rỗng — hỏng một file không được phép làm chết cả danh sách ngữ cảnh.
async function readIniFile(path: string): Promise<AwsIniFile> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      log.warn('aws: cannot read ini file', { path, code })
    }
    return {}
  }
  return parseAwsIni(raw)
}

// Trong file `config`, profile là `[default]` hoặc `[profile x]`. Một section
// `[x]` trần ở file này KHÔNG phải profile (AWS CLI cũng bỏ qua) — trả null.
function profileNameFromConfigSection(section: string): string | null {
  if (section === 'default') return 'default'
  if (!section.startsWith(CONFIG_PROFILE_PREFIX)) return null
  return section.slice(CONFIG_PROFILE_PREFIX.length).trim() || null
}

type MergedProfile = AwsIniSection & { source: AwsProfileSource }

function mergeInto(
  acc: Map<string, MergedProfile>,
  name: string,
  section: AwsIniSection,
  source: 'config' | 'credentials',
): void {
  if (!PROFILE_NAME_RE.test(name)) {
    // Dữ liệu L1: bỏ qua chứ không throw. Cắt ngắn trước khi log vì tên là
    // chuỗi tuỳ ý từ file.
    log.warn('aws: skipping profile with invalid name', { name: name.slice(0, 64), source })
    return
  }
  const prev = acc.get(name)
  if (!prev) {
    acc.set(name, { ...section, keys: { ...section.keys }, source })
    return
  }
  // Khoá trùng giữa hai file: `credentials` thắng, giống botocore.
  Object.assign(prev.keys, section.keys)
  prev.hasStaticKeys = prev.hasStaticKeys || section.hasStaticKeys
  prev.hasSessionToken = prev.hasSessionToken || section.hasSessionToken
  prev.source = 'both'
}

function deriveKind(keys: Record<string, string>, hasStaticKeys: boolean): AwsProfileKind {
  if (
    keys.sso_start_url ||
    keys.sso_session ||
    keys.sso_account_id ||
    keys.sso_role_name ||
    keys.sso_region
  ) {
    return 'sso'
  }
  if (keys.role_arn) return 'assume-role'
  if (keys.credential_process) return 'process'
  if (hasStaticKeys) return 'static'
  return 'unknown'
}

function toIsoOrUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

function opt(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {}
}

function toProfile(
  name: string,
  merged: MergedProfile,
  ssoSessions: Record<string, AwsIniSection>,
): AwsProfile {
  const keys = merged.keys
  // Profile kiểu SSO đời mới để start URL trong block `[sso-session x]` riêng,
  // chỉ trỏ tới bằng `sso_session = x` — không resolve thì UI mất hẳn start URL.
  const ssoStartUrl =
    keys.sso_start_url || (keys.sso_session ? ssoSessions[keys.sso_session]?.keys.sso_start_url : '')

  return {
    name,
    ...opt('region', keys.region),
    ...opt('output', keys.output),
    kind: deriveKind(keys, merged.hasStaticKeys),
    ...opt('ssoStartUrl', ssoStartUrl),
    ...opt('ssoSession', keys.sso_session),
    ...opt('ssoAccountId', keys.sso_account_id),
    ...opt('ssoRoleName', keys.sso_role_name),
    ...opt('roleArn', keys.role_arn),
    ...opt('sourceProfile', keys.source_profile),
    ...opt('mfaSerial', keys.mfa_serial),
    hasStaticKeys: merged.hasStaticKeys,
    hasSessionToken: merged.hasSessionToken,
    ...opt('expiresAt', toIsoOrUndefined(keys.x_security_token_expires)),
    source: merged.source,
  }
}

/** Đọc hai file AWS và trả danh sách profile (không có giá trị secret nào). */
export async function listAwsProfiles(): Promise<AwsProfile[]> {
  const [config, credentials] = await Promise.all([
    readIniFile(awsConfigPath()),
    readIniFile(awsCredentialsPath()),
  ])

  const ssoSessions: Record<string, AwsIniSection> = {}
  const merged = new Map<string, MergedProfile>()

  for (const [section, body] of Object.entries(config)) {
    if (section.startsWith(SSO_SESSION_PREFIX)) {
      const sessionName = section.slice(SSO_SESSION_PREFIX.length).trim()
      if (sessionName) ssoSessions[sessionName] = body
      continue
    }
    const name = profileNameFromConfigSection(section)
    if (name) mergeInto(merged, name, body, 'config')
  }

  // Ở file `credentials`, mọi section là một profile — không có tiền tố.
  for (const [section, body] of Object.entries(credentials)) {
    mergeInto(merged, section, body, 'credentials')
  }

  return [...merged.entries()]
    .map(([name, body]) => toProfile(name, body, ssoSessions))
    .sort((a, b) => a.name.localeCompare(b.name))
}
