// Nhập (A4) và xuất (A6) profile AWS — ADR 0088 §1b, spec `aws-profile-manager.md`.
//
// Đây là bề mặt CHỈ CỦA CON NGƯỜI. Không có AgentTool nào gọi được file này:
// mọi hàm dưới đây hoặc ĐỌC credential của người dùng, hoặc GHI credential mới
// vào `~/.aws` — và §1b luật 4 nói thẳng agent không có đường đó.
//
// ĐƯỜNG ĐỌC VÀ ĐƯỜNG GHI DÙNG HAI PARSER KHÁC NHAU, cố ý:
//
//   · Màn XEM TRƯỚC (`previewImport`) đi qua `parseAwsIni` — parser allowlist-key
//     vứt giá trị secret ngay trong vòng lặp. Payload nó trả về đi lên UI, nên
//     nó KHÔNG ĐƯỢC PHÉP có khả năng cầm secret. Đó là invariant #1.
//   · Đường GHI (`applyImport`) cần chính những giá trị đó để ghi xuống
//     `~/.aws/credentials`, nên nó dùng `parseSectionsForWrite()` bên dưới —
//     một parser thứ hai, phạm vi hẹp, kết quả KHÔNG BAO GIỜ rời khỏi hàm gọi.
//
// Gộp hai parser làm một rồi "lọc sau" là đúng thứ `ini.ts` đã cảnh báo: lọc sau
// nghĩa là secret đã nằm trong một object có tên, và chỉ cần một `log.info` là rò.
//
// Mọi lần ghi xuống đĩa đi qua `applyAwsIniEdits()` (A1) — sửa phẫu thuật, sao
// lưu, ghi nguyên tử, verify. Không có `writeFile` thẳng vào `~/.aws` ở đây.

import { chmod, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { awogHome } from '../../util/path.js'
import { recordInfraAction } from '../audit/store.js'
import { applyAwsIniEdits } from './write.js'
import { parseAwsIni } from './ini.js'
import type { IniEdit } from './ini-edit.js'
import {
  AWS_PROFILE_NAME_RE,
  awsConfigPath,
  awsCredentialsPath,
  deriveKind,
  type AwsProfileKind,
} from './profiles.js'

// ─── Hằng dùng chung ────────────────────────────────────────────────────────

/** File nhập là L1 (người dùng chọn qua dialog). 1 MiB thừa cho mọi `~/.aws` thật. */
const MAX_IMPORT_BYTES = 1024 * 1024

const SECRET_KEYS = ['aws_access_key_id', 'aws_secret_access_key', 'aws_session_token'] as const

/**
 * Khoá được phép GHI vào `~/.aws/config`. Đây là `WRITABLE_KEYS` của `ini-edit.ts`
 * trừ ba khoá secret — cố tình là một ALLOWLIST, không phải "mọi khoá trừ secret"
 * (luật #7 của mốc). Khoá nguồn không nằm trong đây bị BỎ và được nêu tên trong
 * `warnings`, chứ không lặng lẽ đi vào file của người dùng.
 */
const CONFIG_KEYS = [
  'region',
  'output',
  'sso_start_url',
  'sso_region',
  'sso_registration_scopes',
  'sso_account_id',
  'sso_role_name',
  'sso_session',
  'role_arn',
  'source_profile',
  'mfa_serial',
  'external_id',
  'duration_seconds',
  // `aws login` (aws-cli 2.35.9+). Thiếu khoá này thì một profile đăng nhập bằng
  // Console bị coi là `unknown` và bị BỎ khoá khi xuất — bản xuất ra trông như
  // hợp lệ nhưng không dùng được. Giá trị là ĐỊNH DANH phiên, không phải secret:
  // credential nằm trong `~/.aws/login/cache` của chính CLI.
  'login_session',
] as const

const CONFIG_KEY_SET: ReadonlySet<string> = new Set(CONFIG_KEYS)
const SECRET_KEY_SET: ReadonlySet<string> = new Set(SECRET_KEYS)

const CONFIG_PROFILE_PREFIX = 'profile '
const SSO_SESSION_PREFIX = 'sso-session '

/** Tên section trong `~/.aws/config` cho một profile. `default` không có tiền tố. */
function configSectionOf(profile: string): string {
  return profile === 'default' ? 'default' : `${CONFIG_PROFILE_PREFIX}${profile}`
}

// ─── Kiểu công khai ─────────────────────────────────────────────────────────

export type ImportSourceKind = 'paste' | 'file' | 'csv'

export type ImportInput = {
  source: ImportSourceKind
  text?: string | undefined
  path?: string | undefined
}

/** Profile cùng tên đã tồn tại ở file nào. */
export type ImportConflict = 'none' | 'config' | 'credentials' | 'both'

export type ImportEntry = {
  name: string
  kind: AwsProfileKind
  /** CHỈ khoá không-secret. Hai boolean bên dưới là tất cả những gì nói về secret. */
  keys: Record<string, string>
  hasStaticKeys: boolean
  hasSessionToken: boolean
  conflict: ImportConflict
}

export type ImportPreview = { entries: ImportEntry[]; warnings: string[] }

export type ImportSelection = { from: string; to: string; overwrite: boolean }

export type ImportApplyResult = {
  ok: true
  created: string[]
  overwritten: string[]
  skipped: string[]
  backups: string[]
  warnings: string[]
}

export type ExportInput = {
  names: readonly string[]
  includeSecrets: boolean
  confirmName?: string | undefined
  targetPath?: string | undefined
}

/**
 * Hai nhánh LOẠI TRỪ nhau, và kiểu phải nói ra điều đó.
 *
 * Nhánh `text` là nội dung đi NGƯỢC lên renderer qua JSON-RPC. Trước đây nó là
 * `text?` nằm chung một object với `path?`, nên không có gì trong KIỂU ngăn một
 * lần xuất kèm khoá trả nội dung có khoá về UI — hàng rào duy nhất là kỷ luật
 * của `AwsProfileExport.vue` (luôn gọi `saveFilePath()` trước). Luật cứng #5 của
 * Mốc 1 ("KHÔNG xem trước nội dung có khoá trên màn hình") phải được giữ ở BIÊN,
 * không ở renderer: xuất kèm khoá nay bắt buộc có `targetPath` (`TARGET_REQUIRED`)
 * và chỉ trả về đường dẫn.
 */
export type ExportResult =
  | { ok: true; format: 'ini'; path: string }
  | { ok: true; format: 'ini'; text: string }

// ─── Đọc nguồn nhập (L1) ────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/**
 * `path` đến từ renderer ⇒ L1. Ba hàng rào: resolve tuyệt đối (không tin đường
 * dẫn tương đối vào cwd của sidecar), phải là FILE THƯỜNG (thư mục / FIFO /
 * device sẽ treo hoặc đọc vô hạn), và có trần kích thước.
 *
 * Cố ý KHÔNG giới hạn thư mục: người dùng tự chọn file qua dialog của hệ điều
 * hành, và cả điểm của tính năng là nhập từ máy cũ / file đồng nghiệp gửi.
 */
async function readSourceFile(rawPath: string): Promise<string> {
  const abs = resolve(expandHome(rawPath))
  const st = await stat(abs)
  if (!st.isFile()) throw new Error(`NOT_A_FILE: ${abs} is not a regular file`)
  if (st.size > MAX_IMPORT_BYTES) {
    throw new Error(`FILE_TOO_LARGE: ${abs} is ${st.size} bytes, cap is ${MAX_IMPORT_BYTES}`)
  }
  return readFile(abs, 'utf8')
}

async function readSourceText(input: ImportInput): Promise<string> {
  if (input.path !== undefined && input.path.trim() !== '') return readSourceFile(input.path)
  if (input.text !== undefined && input.text !== '') {
    if (input.text.length > MAX_IMPORT_BYTES) {
      throw new Error(`TEXT_TOO_LARGE: pasted text is over ${MAX_IMPORT_BYTES} chars`)
    }
    return input.text
  }
  throw new Error('EMPTY_SOURCE: neither text nor path was given')
}

// ─── CSV của IAM console ────────────────────────────────────────────────────

/**
 * Parser CSV tự viết (không thêm dependency, luật của mốc). Phủ đúng những gì
 * `*_accessKeys.csv` của IAM console có thể mang: ô trong nháy kép, `""` là một
 * dấu nháy literal, CRLF, và cột thừa (bản mới có thêm `User name`, bản cũ chỉ
 * có hai cột khoá).
 */
export function parseCsv(raw: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endCell = (): void => {
    row.push(cell)
    cell = ''
  }
  const endRow = (): void => {
    endCell()
    // Dòng trắng cuối file không phải một hàng dữ liệu.
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (quoted) {
      if (ch !== '"') {
        cell += ch
        continue
      }
      // `""` bên trong nháy = một dấu nháy literal.
      if (raw[i + 1] === '"') {
        cell += '"'
        i++
        continue
      }
      quoted = false
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      continue
    }
    if (ch === ',') {
      endCell()
      continue
    }
    if (ch === '\r') continue // CRLF: `\n` ngay sau sẽ đóng hàng
    if (ch === '\n') {
      endRow()
      continue
    }
    cell += ch
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

function headerIndex(header: readonly string[], want: string): number {
  return header.findIndex((h) => h.trim().toLowerCase() === want)
}

const CSV_BAD_HEADER =
  'CSV has no "Access key ID" / "Secret access key" columns — is this an IAM console export?'

type CsvLayout = { idId: number; idSecret: number; idUser: number }

/** Vị trí ba cột cần dùng, hoặc null khi file không phải CSV khoá của IAM. */
function csvLayout(table: readonly (readonly string[])[]): CsvLayout | null {
  const header = table[0]
  if (!header) return null
  const idId = headerIndex(header, 'access key id')
  const idSecret = headerIndex(header, 'secret access key')
  if (idId < 0 || idSecret < 0) return null
  return { idId, idSecret, idUser: headerIndex(header, 'user name') }
}

/**
 * Tên profile của một hàng CSV. Lấy từ cột `User name`, KHÔNG bao giờ từ access
 * key id — id là nửa còn lại của cặp khoá, không phải thứ để đặt tên. Thiếu cột
 * thì đặt theo số thứ tự hàng và để người dùng đổi ở màn xem trước.
 */
/**
 * Tên profile cho một dòng CSV, ĐÃ khử trùng.
 *
 * Không khử thì hai dòng cùng `User name` (một user có hai cặp khoá là chuyện
 * thường) gộp im lặng thành một profile: màn xem trước hiện 2 dòng, lần ghi chỉ
 * còn 1, và cặp khoá thứ hai biến mất mà không ai báo. `taken` phải đi qua cả
 * hai đường (xem trước và ghi) để chúng cho ra CÙNG một danh sách tên.
 */
function csvRowName(
  cells: readonly string[],
  layout: CsvLayout,
  row: number,
  taken: Set<string>,
): { name: string; renamed: boolean } {
  const user = layout.idUser >= 0 ? (cells[layout.idUser] ?? '').trim() : ''
  const base = AWS_PROFILE_NAME_RE.test(user) ? user : `imported-${row}`
  if (!taken.has(base)) {
    taken.add(base)
    return { name: base, renamed: false }
  }
  const unique = `${base}-${row}`
  taken.add(unique)
  return { name: unique, renamed: true }
}

type CsvKey = { name: string; accessKeyId: string; secretAccessKey: string }

/**
 * Rút cặp khoá từ CSV. Trả về CẢ giá trị secret — chỉ `applyImport` được gọi;
 * `previewImport` dùng bản `csvNames()` bên dưới, thứ không chạm giá trị.
 */
function parseCsvKeys(raw: string): { rows: CsvKey[]; warnings: string[] } {
  const table = parseCsv(raw)
  const layout = csvLayout(table)
  if (!layout) return { rows: [], warnings: [table[0] ? CSV_BAD_HEADER : 'CSV is empty'] }

  const rows: CsvKey[] = []
  const warnings: string[] = []
  const taken = new Set<string>()
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!
    const accessKeyId = (cells[layout.idId] ?? '').trim()
    const secretAccessKey = (cells[layout.idSecret] ?? '').trim()
    if (accessKeyId === '' || secretAccessKey === '') {
      warnings.push(`CSV row ${i}: missing a key column, skipped`)
      continue
    }
    const named = csvRowName(cells, layout, i, taken)
    if (named.renamed) warnings.push(`CSV row ${i}: duplicate name, imported as "${named.name}"`)
    rows.push({ name: named.name, accessKeyId, secretAccessKey })
  }
  return { rows, warnings }
}

// ─── Parser cho ĐƯỜNG GHI ───────────────────────────────────────────────────

/**
 * ⚠ Parser thứ hai, và là chỗ DUY NHẤT trong file này giữ giá trị secret trong
 * bộ nhớ. Kết quả của nó KHÔNG BAO GIỜ được trả về RPC, đưa vào `warnings`, đưa
 * vào nhật ký, hay log — chỉ đi thẳng vào `applyAwsIniEdits()`.
 *
 * Luật phân loại dòng giống hệt `parseAwsIni` (comment `;`/`#`, CRLF, khoảng
 * trắng quanh `=`, khoá trùng thì cái sau thắng, section trùng thì gộp, block
 * thụt `s3 =` bị bỏ cả block) — nếu hai bên hiểu file khác nhau thì màn xem
 * trước sẽ hứa một đằng và lần ghi làm một nẻo.
 */
function parseSectionsForWrite(raw: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  let inNested = false

  for (const rawLine of raw.split('\n')) {
    const indented = rawLine.charCodeAt(0) === 32 || rawLine.charCodeAt(0) === 9
    const line = rawLine.trim()

    if (line === '') {
      inNested = false
      continue
    }
    if (inNested && indented) continue
    inNested = false

    const first = line.charCodeAt(0)
    if (first === 59 /* ; */ || first === 35 /* # */) continue

    if (first === 91 /* [ */) {
      // Dấu `]` ĐẦU TIÊN — cùng luật với `parseAwsIni` (botocore dừng tên
      // section ở `]` đầu tiên). Dùng `lastIndexOf` ở đây thì đường GHI đọc ra
      // một tên section khác đường ĐỌC, và người dùng thấy xem-trước nói một
      // đằng còn file ghi một nẻo.
      const close = line.indexOf(']')
      if (close <= 1) {
        current = null
        continue
      }
      const name = line.slice(1, close).trim().replace(/\s+/g, ' ')
      if (name === '') {
        current = null
        continue
      }
      current = out.get(name) ?? new Map<string, string>()
      out.set(name, current)
      continue
    }

    if (!current) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (value === '') {
      // `s3 =` mở block thụt — không phải khoá.
      inNested = true
      continue
    }
    current.set(key, value)
  }
  return out
}

/**
 * Tên profile từ tên section của file nguồn. `[profile x]` (file config) và `[x]`
 * (file credentials) cùng cho ra `x`; `[sso-session x]` KHÔNG phải profile.
 */
function profileNameOfSection(section: string): string | null {
  if (section.startsWith(SSO_SESSION_PREFIX)) return null
  if (section.startsWith(CONFIG_PROFILE_PREFIX)) {
    return section.slice(CONFIG_PROFILE_PREFIX.length).trim() || null
  }
  return section
}

// ─── Trạng thái `~/.aws` hiện tại ───────────────────────────────────────────

async function readIniSafe(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // Chưa có `~/.aws` là trạng thái hợp lệ của máy chưa cài AWS CLI.
    return ''
  }
}

type Existing = {
  config: Set<string>
  credentials: Set<string>
  /** Profile dùng `credential_process` — chỉ ĐỌC ở v1 (luật cứng #3). */
  process: Set<string>
}

async function existingProfiles(): Promise<Existing> {
  const [configRaw, credentialsRaw] = await Promise.all([
    readIniSafe(awsConfigPath()),
    readIniSafe(awsCredentialsPath()),
  ])
  const config = new Set<string>()
  // Luật cứng #3 (`credential_process` chỉ ĐỌC ở v1) được `profile-ops.ts` ép
  // trên đường CRUD, nhưng nhập là một đường ghi THỨ HAI vào cùng hai file —
  // không chặn ở đây thì một lần nhập biến profile của người dùng thành thứ
  // chính app không sửa/xoá lại được nữa.
  const process = new Set<string>()
  const parsedConfig = parseAwsIni(configRaw)
  for (const [section, body] of Object.entries(parsedConfig)) {
    let name: string | null = null
    if (section === 'default') name = 'default'
    else if (section.startsWith(CONFIG_PROFILE_PREFIX)) {
      const trimmed = section.slice(CONFIG_PROFILE_PREFIX.length).trim()
      if (trimmed) name = trimmed
    }
    if (name === null) continue
    config.add(name)
    if (deriveKind(body.keys, body.hasStaticKeys) === 'process') process.add(name)
  }
  const credentials = new Set(Object.keys(parseAwsIni(credentialsRaw)))
  return { config, credentials, process }
}

function conflictOf(name: string, existing: Existing): ImportConflict {
  const inConfig = existing.config.has(name)
  const inCreds = existing.credentials.has(name)
  if (inConfig && inCreds) return 'both'
  if (inConfig) return 'config'
  if (inCreds) return 'credentials'
  return 'none'
}

// ─── A4 — xem trước ─────────────────────────────────────────────────────────

/**
 * Đọc nguồn nhập và mô tả sẽ tạo/ghi đè gì, TRƯỚC khi có gì chạm đĩa.
 *
 * Không trả về giá trị secret nào: `keys` chỉ có khoá không-secret (qua
 * `parseAwsIni`), phần secret rút gọn thành hai boolean.
 */
export async function previewImport(input: ImportInput): Promise<ImportPreview> {
  const raw = await readSourceText(input)
  const existing = await existingProfiles()

  if (input.source === 'csv') {
    const table = parseCsv(raw)
    const layout = csvLayout(table)
    if (!layout) return { entries: [], warnings: [table[0] ? CSV_BAD_HEADER : 'CSV is empty'] }

    const entries: ImportEntry[] = []
    const warnings: string[] = []
    const taken = new Set<string>()
    for (let i = 1; i < table.length; i++) {
      const cells = table[i]!
      // Chỉ hỏi CÓ hay KHÔNG, không giữ giá trị: đây là đường xem trước, và nó
      // đi thẳng lên UI.
      if (
        (cells[layout.idId] ?? '').trim() === '' ||
        (cells[layout.idSecret] ?? '').trim() === ''
      ) {
        warnings.push(`CSV row ${i}: missing a key column, skipped`)
        continue
      }
      const named = csvRowName(cells, layout, i, taken)
      if (named.renamed) warnings.push(`CSV row ${i}: duplicate name, imported as "${named.name}"`)
      const name = named.name
      entries.push({
        name,
        kind: 'static',
        keys: {},
        hasStaticKeys: true,
        hasSessionToken: false,
        conflict: conflictOf(name, existing),
      })
    }
    return { entries, warnings }
  }

  const parsed = parseAwsIni(raw)
  const entries: ImportEntry[] = []
  const warnings: string[] = []

  for (const [section, body] of Object.entries(parsed)) {
    if (section.startsWith(SSO_SESSION_PREFIX)) {
      // Nhập block `[sso-session x]` chưa có ở v1: nó là cấu hình dùng chung của
      // cả tổ chức chứ không thuộc một profile, và luồng đúng cho nó là "Nhập từ
      // SSO" (A5). Nói ra thay vì im lặng bỏ — một profile trỏ `sso_session = x`
      // mà thiếu block sẽ hỏng đúng lúc người dùng bấm chạy lệnh.
      warnings.push(`Skipped [${section}] — import an SSO session from the SSO tab instead`)
      continue
    }
    const name = profileNameOfSection(section)
    if (name === null) continue
    if (!AWS_PROFILE_NAME_RE.test(name)) {
      warnings.push(`Skipped an invalid profile name (${name.length} chars)`)
      continue
    }

    const keys: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.keys)) {
      if (CONFIG_KEY_SET.has(key)) keys[key] = value
      else warnings.push(`Profile "${name}": ignoring key "${key}" (AWOG does not write it)`)
    }

    entries.push({
      name,
      kind: deriveKind(body.keys, body.hasStaticKeys),
      keys,
      hasStaticKeys: body.hasStaticKeys,
      hasSessionToken: body.hasSessionToken,
      conflict: conflictOf(name, existing),
    })
  }

  return { entries, warnings }
}

// ─── A4 — áp dụng ───────────────────────────────────────────────────────────

/** Bộ khoá của một profile nguồn, đã tách hai nhánh file. */
type SplitKeys = {
  config: Record<string, string>
  secrets: Record<string, string>
  ignored: string[]
}

function splitKeys(source: ReadonlyMap<string, string>): SplitKeys {
  const config: Record<string, string> = {}
  const secrets: Record<string, string> = {}
  const ignored: string[] = []
  for (const [key, value] of source) {
    if (SECRET_KEY_SET.has(key)) secrets[key] = value
    else if (CONFIG_KEY_SET.has(key)) config[key] = value
    else ignored.push(key)
  }
  return { config, secrets, ignored }
}

/**
 * Ghi những profile người dùng đã tick ở màn xem trước.
 *
 * Ngữ nghĩa "ghi đè" là THAY THẾ: khoá AWOG mô hình hoá mà bản mới không có sẽ
 * bị gỡ (`removeKeys`). Nếu không gỡ, một profile SSO ghi đè lên profile static
 * cũ sẽ để lại `aws_access_key_id` mồ côi và AWS CLI vẫn dùng khoá cũ — người
 * dùng thấy "đã ghi đè" nhưng lệnh chạy bằng credential họ tưởng đã thay. Khoá
 * KHÔNG mô hình hoá (`cli_pager`, block `s3 =`, comment) vẫn nguyên — đó là luật
 * sửa phẫu thuật của A1.
 */
export async function applyImport(
  input: ImportInput & { selections: readonly ImportSelection[] },
): Promise<ImportApplyResult> {
  const raw = await readSourceText(input)
  const existing = await existingProfiles()

  // ⚠ `sources` giữ giá trị secret. Nó không rời khỏi hàm này.
  const sources = new Map<string, Map<string, string>>()
  const warnings: string[] = []

  if (input.source === 'csv') {
    const parsed = parseCsvKeys(raw)
    warnings.push(...parsed.warnings)
    for (const row of parsed.rows) {
      sources.set(
        row.name,
        new Map([
          ['aws_access_key_id', row.accessKeyId],
          ['aws_secret_access_key', row.secretAccessKey],
        ]),
      )
    }
  } else {
    for (const [section, body] of parseSectionsForWrite(raw)) {
      const name = profileNameOfSection(section)
      if (name === null) continue
      const prev = sources.get(name)
      // File config + credentials dán chung một khối: gộp, `credentials` (đến
      // sau trong file dán) thắng ở từng khoá, giống botocore.
      if (prev) for (const [k, v] of body) prev.set(k, v)
      else sources.set(name, new Map(body))
    }
  }

  const created: string[] = []
  const overwritten: string[] = []
  const skipped: string[] = []
  const configEdits: IniEdit[] = []
  const credentialEdits: IniEdit[] = []

  // Hai lựa chọn cùng ghi vào một tên đích = hai `upsertSection` giẫm lên nhau,
  // và cái sau thắng IM LẶNG. Fail fast thay vì để người dùng tin cả hai đã vào.
  const targets = new Set<string>()

  for (const sel of input.selections) {
    if (!AWS_PROFILE_NAME_RE.test(sel.to)) {
      throw new Error(`INVALID_NAME: "${sel.to.slice(0, 64)}" is not a valid AWS profile name`)
    }
    if (targets.has(sel.to)) {
      throw new Error(`INVALID_NAME: "${sel.to.slice(0, 64)}" is selected twice`)
    }
    targets.add(sel.to)
    const source = sources.get(sel.from)
    if (!source) {
      skipped.push(sel.to)
      warnings.push(`Profile "${sel.from}" was not found in the import source`)
      continue
    }

    // Bỏ QUA (không ném): một profile hỏng không được giết cả lô — người dùng
    // thường tick 10 profile và chỉ một trong số đó là `credential_process`.
    if (existing.process.has(sel.to)) {
      skipped.push(sel.to)
      warnings.push(`Profile "${sel.to}" uses credential_process and is read-only in v1`)
      continue
    }

    const conflict = conflictOf(sel.to, existing)
    if (conflict !== 'none' && !sel.overwrite) {
      skipped.push(sel.to)
      continue
    }

    const split = splitKeys(source)
    for (const key of split.ignored) {
      warnings.push(`Profile "${sel.to}": ignoring key "${key}" (AWOG does not write it)`)
    }

    const hadConfig = existing.config.has(sel.to)
    const hadCredentials = existing.credentials.has(sel.to)

    if (Object.keys(split.config).length > 0 || hadConfig) {
      const stale = CONFIG_KEYS.filter((k) => !(k in split.config))
      configEdits.push({
        op: 'upsertSection',
        section: configSectionOf(sel.to),
        keys: split.config,
        ...(hadConfig ? { removeKeys: stale } : {}),
      })
    }
    if (Object.keys(split.secrets).length > 0 || hadCredentials) {
      const stale = SECRET_KEYS.filter((k) => !(k in split.secrets))
      credentialEdits.push({
        op: 'upsertSection',
        section: sel.to,
        keys: split.secrets,
        ...(hadCredentials ? { removeKeys: stale } : {}),
      })
    }

    if (conflict === 'none') created.push(sel.to)
    else overwritten.push(sel.to)
  }

  const backups: string[] = []
  if (configEdits.length > 0) {
    const { backup } = await applyAwsIniEdits('config', configEdits)
    if (backup) backups.push(backup)
  }
  if (credentialEdits.length > 0) {
    const { backup } = await applyAwsIniEdits('credentials', credentialEdits)
    if (backup) backups.push(backup)
  }

  // Luật #6 của mốc: mọi thao tác GHI để lại một dòng nhật ký. `argv` chỉ có tên
  // profile và tên nguồn — không có giá trị khoá nào.
  await recordInfraAction({
    actor: 'human',
    surface: 'settings',
    tool: 'profile_import',
    argv: [
      'import',
      input.source,
      ...(input.path !== undefined && input.path.trim() !== '' ? ['--from', input.path] : []),
      ...created,
      ...overwritten,
    ],
    context: {},
    class: 'write',
    decision: 'approved',
    result: {
      summary: `imported ${created.length} profile(s), overwrote ${overwritten.length}, skipped ${skipped.length}`,
    },
  })

  return { ok: true, created, overwritten, skipped, backups, warnings }
}

// ─── A6 — xuất ──────────────────────────────────────────────────────────────

/**
 * Các dòng secret NGUYÊN VĂN của một section trong `~/.aws/credentials`.
 *
 * Trả về DÒNG chứ không phải cặp khoá-giá trị, và đó là chủ đích: giá trị không
 * bao giờ bị cắt ra thành một biến có tên trên đường đi, nên không có chỗ nào
 * để nó lọt vào log hay vào một object khác. Chỉ `exportProfiles` gọi hàm này.
 */
function secretLinesOf(raw: string, section: string): string[] {
  const out: string[] = []
  let inSection = false
  let inNested = false

  for (const rawLine of raw.split('\n')) {
    const indented = rawLine.charCodeAt(0) === 32 || rawLine.charCodeAt(0) === 9
    const line = rawLine.trim()
    if (line === '') {
      inNested = false
      continue
    }
    if (inNested && indented) continue
    inNested = false

    const first = line.charCodeAt(0)
    if (first === 59 || first === 35) continue
    if (first === 91) {
      // `]` đầu tiên — xem chú thích ở `parseSectionsForWrite`.
      const close = line.indexOf(']')
      const name = close > 1 ? line.slice(1, close).trim().replace(/\s+/g, ' ') : ''
      inSection = name === section
      continue
    }
    if (!inSection) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    if (line.slice(eq + 1).trim() === '') {
      inNested = true
      continue
    }
    if (SECRET_KEY_SET.has(key)) out.push(line.replace(/\r$/, ''))
  }
  return out
}

/**
 * `targetPath` là L1. Hai thư mục bị từ chối thẳng:
 *   · `~/.aws` — "xuất" đè lên chính nguồn sự thật là một cách mất dữ liệu mà
 *     người dùng không bao giờ có ý định; đường ghi hợp lệ vào đó là
 *     `applyAwsIniEdits` (sao lưu + verify), không phải hàm này.
 *   · `~/.awog` — dữ liệu của app, và nó cũng là nhà của bản sao lưu.
 */
async function resolveExportTarget(rawPath: string): Promise<string> {
  const abs = resolve(expandHome(rawPath))

  // So chuỗi trên đường dẫn CHƯA giải symlink là một denylist mù: `~/Desktop/out.ini`
  // trỏ tới `~/.aws/credentials` (hoặc một thư mục cha là symlink vào `~/.aws`)
  // vượt qua vòng lặp bên dưới rồi ghi thẳng đè file credential — không sao lưu,
  // không verify. Nên so trên đường dẫn THẬT ở CẢ HAI vế: cả đích lẫn danh sách
  // cấm. Vế thứ hai không bỏ được — trên macOS `/var/…` tự nó là symlink tới
  // `/private/var/…`, nên một đích đã giải sẽ không bao giờ khớp một thư mục cấm
  // chưa giải.
  const candidates = new Set([abs, await realPathOf(abs)])

  const forbidden = new Set<string>()
  for (const dir of [
    join(homedir(), '.aws'),
    awogHome(),
    dirname(awsConfigPath()),
    dirname(awsCredentialsPath()),
  ]) {
    forbidden.add(dir)
    forbidden.add(await realPathOf(dir))
  }

  for (const candidate of candidates) {
    for (const dir of forbidden) {
      if (candidate === dir || candidate.startsWith(dir + sep)) {
        throw new Error(`FORBIDDEN_TARGET: refusing to write inside ${dir}`)
      }
    }
  }
  return abs
}

/**
 * `realpath` chịu được đường dẫn CHƯA tồn tại: giải tổ tiên tồn tại gần nhất rồi
 * gắn lại phần đuôi chưa có. Cần thế vì đích xuất thường là một file sắp được
 * tạo, còn `~/.awog` có thể chưa tồn tại trên máy mới.
 */
async function realPathOf(target: string): Promise<string> {
  const tail: string[] = []
  let current = target
  for (;;) {
    try {
      const real = await realpath(current)
      return tail.length === 0 ? real : join(real, ...tail)
    } catch {
      const parent = dirname(current)
      if (parent === current) return target
      tail.unshift(basename(current))
      current = parent
    }
  }
}

function iniLinesFor(name: string, keys: Record<string, string>): string[] {
  const out = [`[${name}]`]
  // Thứ tự cố định theo `CONFIG_KEYS` để hai lần xuất cùng một profile cho ra
  // cùng một file (diff được, so sánh được).
  for (const key of CONFIG_KEYS) {
    const value = keys[key]
    if (value !== undefined) out.push(`${key} = ${value}`)
  }
  return out
}

const EXPORT_HEADER = [
  '# Exported by AWOG.',
  '# Paste these sections into ~/.aws/credentials, or into ~/.aws/config',
  '# with each header rewritten as [profile <name>] (except [default]).',
]

/**
 * Xuất cấu hình profile ra INI.
 *
 * Hai chế độ, và cái mặc định KHÔNG BAO GIỜ mở `~/.aws/credentials` — không phải
 * "mở rồi lọc", mà là không đọc file đó một lần nào. Chế độ kèm khoá đòi gõ lại
 * đúng một tên profile trong danh sách để xác nhận (spec: static key xuất ra file
 * là thứ rủi ro nhất trong cả họ tính năng này — nó không hết hạn và đi theo file).
 */
export async function exportProfiles(input: ExportInput): Promise<ExportResult> {
  const names = [...new Set(input.names)]
  if (names.length === 0) throw new Error('NO_PROFILES: nothing selected to export')
  for (const name of names) {
    if (!AWS_PROFILE_NAME_RE.test(name)) {
      throw new Error(`INVALID_NAME: "${name.slice(0, 64)}" is not a valid AWS profile name`)
    }
  }
  const targetPath = input.targetPath?.trim() ?? ''
  if (input.includeSecrets) {
    const confirm = input.confirmName?.trim() ?? ''
    if (confirm === '' || !names.includes(confirm)) {
      throw new Error('CONFIRM_REQUIRED: type one of the exported profile names to confirm')
    }
    // Hàng rào ở BIÊN cho luật cứng #5 + invariant #1: nội dung kèm khoá chỉ đi
    // xuống ĐĨA, không bao giờ ngược lên renderer qua JSON-RPC. Không có nhánh
    // "trả chuỗi để UI tự lưu" — một nhánh như vậy là một cái rò chờ người gọi.
    if (targetPath === '') {
      throw new Error('TARGET_REQUIRED: exporting with secrets must write to a file')
    }
  }

  const configRaw = await readIniSafe(awsConfigPath())
  const config = parseAwsIni(configRaw)
  // ⚠ Chỉ đọc khi thật sự xuất kèm khoá.
  const credentialsRaw = input.includeSecrets ? await readIniSafe(awsCredentialsPath()) : ''

  const lines = [...EXPORT_HEADER, '']
  for (const name of names) {
    const section = config[configSectionOf(name)]
    lines.push(...iniLinesFor(name, section?.keys ?? {}))
    if (input.includeSecrets) lines.push(...secretLinesOf(credentialsRaw, name))
    lines.push('')
  }
  const text = lines.join('\n')

  let path: string | undefined
  if (targetPath !== '') {
    path = await resolveExportTarget(targetPath)
    // `mode` của writeFile bị umask cắt ⇒ siết lại tường minh. 0600 cho CẢ hai
    // chế độ: file cấu hình thuần không bí mật, nhưng thắt chặt quyền của một
    // file người dùng vừa tạo chưa bao giờ là cái giá đáng bàn.
    await writeFile(path, text, { mode: 0o600 })
    await chmod(path, 0o600)
  }

  await recordInfraAction({
    actor: 'human',
    surface: 'settings',
    tool: 'profile_export',
    // Đường dẫn đích KHÔNG phải bí mật, và với thao tác rủi ro nhất của cả mốc
    // ("xuất kèm khoá") thì "ra chỗ nào" chính là thứ nhật ký cần trả lời.
    argv: [
      'export',
      ...(input.includeSecrets ? ['--include-secrets'] : []),
      ...(path !== undefined ? ['--to', path] : []),
      ...names,
    ],
    context: {},
    class: 'write',
    decision: 'approved',
    result: {
      summary: input.includeSecrets
        ? `export WITH SECRETS of ${names.length} profile(s)${path ? ` to a file` : ''}`
        : `export config-only of ${names.length} profile(s)`,
    },
  })

  return path !== undefined ? { ok: true, format: 'ini', path } : { ok: true, format: 'ini', text }
}

// ─── A6 — lệnh tương đương ──────────────────────────────────────────────────

/** Bọc nháy đơn khi giá trị có ký tự shell — đây là chuỗi để người dùng dán vào terminal. */
function shellQuote(value: string): string {
  return /^[A-Za-z0-9._:/@=+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Các dòng `aws configure set …` tương đương một profile, cho người muốn tự chạy
 * thay vì để AWOG ghi file.
 *
 * Dòng khoá dùng PLACEHOLDER, không bao giờ giá trị thật — và không phải vì ngại
 * rò: đường đọc của AWOG (`parseAwsIni`) vứt giá trị secret ngay trong vòng lặp
 * nên hàm này KHÔNG CÓ CÁCH NÀO biết chúng. Bất biến #1 làm cho lựa chọn an toàn
 * trở thành lựa chọn duy nhất.
 */
export async function exportCommands(name: string): Promise<{ commands: string[] }> {
  if (!AWS_PROFILE_NAME_RE.test(name)) {
    throw new Error(`INVALID_NAME: "${name.slice(0, 64)}" is not a valid AWS profile name`)
  }
  const config = parseAwsIni(await readIniSafe(awsConfigPath()))
  const credentials = parseAwsIni(await readIniSafe(awsCredentialsPath()))
  const section = config[configSectionOf(name)]
  const creds = credentials[name]

  const profileFlag = `--profile ${shellQuote(name)}`

  // Profile `login_session` KHÔNG tái tạo được bằng `aws configure set`: giá trị
  // là định danh phiên do `aws login` sinh ra và token nằm trong cache của CLI.
  // Chép các khoá còn lại ra đây sẽ cho một profile trông đúng nhưng không có
  // credential nào. Lệnh tương đương thật là chính lệnh đã tạo ra nó.
  if (section?.keys.login_session) {
    return { commands: [`aws login ${profileFlag}`] }
  }

  const commands: string[] = []
  for (const key of CONFIG_KEYS) {
    const value = section?.keys[key]
    if (value !== undefined) commands.push(`aws configure set ${key} ${shellQuote(value)} ${profileFlag}`)
  }
  if (creds?.hasStaticKeys) {
    commands.push(`aws configure set aws_access_key_id <your-access-key-id> ${profileFlag}`)
    commands.push(`aws configure set aws_secret_access_key <your-secret-access-key> ${profileFlag}`)
  }
  if (creds?.hasSessionToken) {
    commands.push(`aws configure set aws_session_token <your-session-token> ${profileFlag}`)
  }
  return { commands }
}
