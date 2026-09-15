// CRUD profile AWS — lớp nghiệp vụ giữa RPC và trình soạn INI (ADR 0088 §1b,
// Mốc 1 việc A3). Nó biết *profile* (kiểu, khoá nào vào file nào); `ini-edit.ts`
// chỉ biết *dòng*; `write.ts` chỉ biết *file*.
//
// INVARIANT #1 — giá trị secret đi qua đây trong ĐÚNG một lần ghi. Ba khoá
// static chỉ tồn tại trong `pickSecrets()` rồi đi thẳng vào `IniEdit`; chúng
// KHÔNG vào log, KHÔNG vào nhật ký (`argv` bên dưới chỉ có tên profile và cờ
// `--with-secrets`, không bao giờ có giá trị), KHÔNG vào giá trị trả về, và
// KHÔNG có thông báo lỗi nào nhắc tới chúng. Nhân bản profile static vì thế
// KHÔNG ĐƯỢC "đọc rồi lưu lại" — đường đọc của AWOG cố tình mù với secret nên
// bản sao sẽ mất khoá; nó đi qua `copySection`, chép nguyên văn từng dòng.
//
// BỀ MẶT CỦA CON NGƯỜI, KHÔNG PHẢI CỦA AGENT (ADR 0088 §1b luật 4). Không tồn
// tại AgentTool nào gọi được module này và không được phép tạo ra một cái. Đó
// cũng là lý do `actor` dưới đây là hằng `'human'` thay vì tham số: module này
// theo thiết kế không có người gọi nào khác. Nếu điều đó đổi, `actor` phải
// thành tham số TRƯỚC khi người gọi mới được nối vào.

import { RpcError } from '../../transport/rpc.js'
import { recordInfraAction, type InfraSurface } from '../audit/store.js'
import type { InfraCommandClass } from '../types.js'
import { applyAwsIniEdits, type AwsIniTarget } from './write.js'
import type { IniEdit } from './ini-edit.js'
import {
  AWS_PROFILE_NAME_RE,
  listAwsProfiles,
  type AwsProfile,
  type AwsProfileSource,
} from './profiles.js'

/**
 * Kiểu profile AWOG ghi được. `process` chỉ ĐỌC ở v1 (ADR 0088 §1b luật 3).
 *
 * `login` (thêm 2026-09-14) là trường hợp HẸP HƠN ba kiểu kia: AWOG chỉ đổi được
 * TÊN và `region` của một profile `login` có sẵn — ruột của nó (`login_session`)
 * do `aws login` sinh ra trong `console-login.ts`, và phiên đăng nhập nằm trong
 * cache của CLI. Xem `assertLoginEdit()`.
 */
export type WritableProfileKind = 'static' | 'sso' | 'assume-role' | 'login'

export type ProfileSecrets = {
  accessKeyId?: string | undefined
  secretAccessKey?: string | undefined
  sessionToken?: string | undefined
}

export type SaveProfileInput = {
  name: string
  /**
   * Profile ĐANG ĐƯỢC SỬA. Bằng `name` ⇒ sửa tại chỗ; khác `name` ⇒ đổi tên.
   *
   * VẮNG MẶT ⇒ TẠO MỚI — và đó là thứ phân biệt "sửa" với "tạo", không phải một
   * cờ riêng. Trước đây trường này chỉ được gắn khi ĐỔI TÊN, nên một lần sửa
   * không đổi tên không nói được "đích chính là tôi": hàng rào `EXISTS` bên dưới
   * bắn vào chính profile người dùng đang mở và nút Sửa của /infra không bao giờ
   * lưu được. Nới nghĩa (chứ không nới hàng rào) vì hàng rào vẫn phải bắt được
   * ca thật: tạo mới trùng tên, và đổi tên vào chỗ đã có người.
   */
  previousName?: string | undefined
  kind: WritableProfileKind
  /** Khoá `~/.aws/config`, tên khoá viết như trong file (`sso_start_url`…). */
  config: Readonly<Record<string, string>>
  /** Chỉ hợp lệ khi `kind === 'static'`. */
  secrets?: ProfileSecrets | undefined
  overwrite?: boolean | undefined
  surface: InfraSurface
}

export type SaveProfileResult = { profile: AwsProfile; backups: string[] }

export type DeleteProfileResult = {
  /** File đã thực sự bị sửa. Rỗng = profile không tồn tại (xoá là idempotent). */
  removedFrom: AwsIniTarget[]
  backups: string[]
}

export type DuplicateProfileInput = {
  from: string
  to: string
  overwrite?: boolean | undefined
  surface: InfraSurface
}

/** Mã lỗi trong hợp đồng RPC — nằm ở ĐẦU `message` và trong `err.name`. */
export type ProfileOpCode =
  | 'INVALID_NAME'
  | 'EXISTS'
  | 'NOT_FOUND'
  | 'PROCESS_READONLY'
  /**
   * Profile `login` (`aws login`): AWOG chỉ đổi được tên/region. Dùng cho cả ba
   * đường bị chặn — tạo bằng form, đổi kiểu khỏi `login`, và ghi `login_session`
   * từ form (xem `assertLoginEdit`).
   */
  | 'LOGIN_READONLY'
  | 'UNKNOWN_KEY'
  | 'WRITE_FAILED'
  | 'VERIFY_FAILED'

function opError(code: ProfileOpCode, message: string): Error {
  const err = new Error(`${code}: ${message}`)
  err.name = code
  return err
}

/**
 * Đổi lỗi của module này thành lỗi RPC, giữ mã ở `data.code` (và ở đầu
 * `message` theo hợp đồng Mốc 1) — UI phân nhánh theo MÃ, không so chuỗi tiếng
 * Anh. Để ở đây chứ không copy vào từng method: mã lỗi sinh ra ở file này thì
 * cách dịch nó cũng nên ở file này.
 */
export function throwProfileRpcError(err: unknown): never {
  if (err instanceof RpcError) throw err
  if (err instanceof Error) {
    // `opError()` của file này gắn mã vào `err.name`. `import-export.ts` và
    // `sso.ts` thì ném `Error` thường với mã ở ĐẦU message (`TARGET_REQUIRED: …`)
    // — không bóc ra thì `data.code` thành chuỗi `"Error"` vô nghĩa và UI mất
    // đường phân nhánh theo mã.
    const fromMessage = /^([A-Z][A-Z0-9_]{2,40}):/.exec(err.message)?.[1]
    const code = err.name !== 'Error' ? err.name : fromMessage
    throw new RpcError(-32000, err.message, code !== undefined ? { code } : undefined)
  }
  throw new RpcError(-32000, String(err))
}

// Allowlist khoá ghi vào `config` = `WRITABLE_KEYS` của `ini-edit.ts` trừ ba
// khoá secret (chúng thuộc file `credentials`). Giữ bản riêng ở đây vì đây là
// biên nhận dữ liệu L1 từ UI: khoá lạ phải bị từ chối kèm mã `UNKNOWN_KEY` mà
// UI hiểu được, chứ không phải một `Error` chung của tầng dưới.
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'region',
  'output',
  'sso_start_url',
  'sso_region',
  'sso_account_id',
  'sso_role_name',
  'sso_session',
  'role_arn',
  'source_profile',
  'mfa_serial',
  'external_id',
  'duration_seconds',
])

/**
 * Khoá config ĐẶC TRƯNG cho từng kiểu profile. Đổi kiểu = khoá của kiểu cũ
 * thành rác, và rác ở đây không vô hại: botocore vẫn đọc `aws_access_key_id`
 * trong `credentials` khi section `config` đã thành SSO, nên người dùng tin
 * mình đã bỏ khoá dài hạn trong khi lệnh vẫn chạy bằng chính khoá đó.
 *
 * `region`/`output` KHÔNG thuộc nhóm nào — chúng chung cho mọi kiểu.
 */
const SSO_CONFIG_KEYS = [
  'sso_start_url',
  'sso_region',
  'sso_account_id',
  'sso_role_name',
  'sso_session',
] as const

const ASSUME_ROLE_CONFIG_KEYS = [
  'role_arn',
  'source_profile',
  'mfa_serial',
  'external_id',
  'duration_seconds',
] as const

/**
 * Khoá `login_session` — do `console-login.ts` ghi, KHÔNG nhận từ form. Vẫn nằm
 * trong danh sách để lượt ghi nào vô tình mang nó theo thì bị từ chối tường minh
 * (`assertLoginEdit`) chứ không âm thầm ghi đè phiên đang dùng.
 */
const LOGIN_CONFIG_KEYS = ['login_session'] as const

const SECRET_INI_KEYS = [
  'aws_access_key_id',
  'aws_secret_access_key',
  'aws_session_token',
] as const

/** Khoá config phải BIẾN MẤT khi profile chuyển sang `kind`. */
function staleConfigKeysFor(kind: WritableProfileKind): string[] {
  return [
    ...(kind !== 'sso' ? SSO_CONFIG_KEYS : []),
    ...(kind !== 'assume-role' ? ASSUME_ROLE_CONFIG_KEYS : []),
    ...(kind !== 'login' ? LOGIN_CONFIG_KEYS : []),
  ]
}

const CONFIG_PROFILE_PREFIX = 'profile '

// Trong `config`, profile mặc định là `[default]` — `[profile default]` là một
// section KHÁC mà AWS CLI bỏ qua. Trong `credentials` mọi profile là tên trần.
function configSection(name: string): string {
  return name === 'default' ? 'default' : `${CONFIG_PROFILE_PREFIX}${name}`
}

function assertProfileName(name: string): string {
  const trimmed = name.trim()
  if (!AWS_PROFILE_NAME_RE.test(trimmed)) {
    throw opError(
      'INVALID_NAME',
      `profile name must match ${AWS_PROFILE_NAME_RE.source}: ${JSON.stringify(trimmed.slice(0, 64))}`,
    )
  }
  return trimmed
}

function inFile(source: AwsProfileSource, target: AwsIniTarget): boolean {
  return source === 'both' || source === target
}

// Khoá không truyền (hoặc truyền chuỗi rỗng) = KHÔNG ĐỤNG dòng đó. Cùng luật
// với secret bên dưới: sửa region mà không nhập lại khoá thì khoá cũ phải còn,
// nên cách duy nhất nhất quán là "vắng mặt = giữ nguyên". Muốn bỏ hẳn một khoá
// thì xoá cả profile rồi tạo lại — lệnh đó nói đúng ý người dùng.
function pickConfigKeys(config: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(config)) {
    const key = rawKey.trim().toLowerCase()
    if (key === 'credential_process') {
      throw opError('PROCESS_READONLY', 'credential_process is read-only in v1')
    }
    if (!CONFIG_KEYS.has(key)) {
      throw opError('UNKNOWN_KEY', `${JSON.stringify(key.slice(0, 64))} is not a writable key`)
    }
    if (typeof rawValue !== 'string') continue
    const value = rawValue.trim()
    if (value === '') continue
    out[key] = value
  }
  return out
}

// ⚠ Hàm duy nhất trong file chạm vào giá trị secret. Không log, không đưa vào
// thông báo lỗi, không giữ lại — kết quả đi thẳng vào `IniEdit` rồi ra đĩa.
function pickSecrets(
  kind: WritableProfileKind,
  secrets: ProfileSecrets | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!secrets) return out
  const byIniKey: Record<string, string | undefined> = {
    aws_access_key_id: secrets.accessKeyId,
    aws_secret_access_key: secrets.secretAccessKey,
    aws_session_token: secrets.sessionToken,
  }
  for (const [key, raw] of Object.entries(byIniKey)) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (value === '') continue
    out[key] = value
  }
  if (Object.keys(out).length > 0 && kind !== 'static') {
    throw opError('UNKNOWN_KEY', `${kind} profiles do not take static keys`)
  }
  return out
}

// ─── Nhật ký ─────────────────────────────────────────────────────────────────

type AuditCtx = {
  surface: InfraSurface
  /** Tên tool AWOG cho nhật ký, KHÔNG phải tên binary. */
  tool: string
  /** Chỉ metadata: tên profile, kiểu, cờ. Không bao giờ có giá trị khoá. */
  argv: string[]
  profile: string
  class: InfraCommandClass
}

// Luật #6 của mốc: mọi thao tác ghi để lại một dòng, kể cả lần hỏng. Bọc ở đây
// chứ không ở từng RPC vì một method quên gọi thì nhật ký thôi là bằng chứng.
async function audited<T>(ctx: AuditCtx, fn: () => Promise<T>): Promise<T> {
  const record = async (summary?: string): Promise<void> => {
    await recordInfraAction({
      actor: 'human',
      surface: ctx.surface,
      tool: ctx.tool,
      argv: ctx.argv,
      context: { profile: ctx.profile },
      class: ctx.class,
      decision: 'approved',
      result: summary !== undefined ? { summary } : {},
    })
  }
  try {
    const out = await fn()
    await record()
    return out
  } catch (err) {
    // Chỉ ghi MÃ lỗi, không ghi message: message của tầng dưới có thể mang
    // đường dẫn và tên khoá, và không có lý do gì để nhật ký cầm thêm thứ đó.
    await record(`failed: ${err instanceof Error ? err.name : 'Error'}`)
    throw err
  }
}

// ─── Đường ghi ───────────────────────────────────────────────────────────────

// `VERIFY_FAILED` của `write.ts` đã đúng khuôn mã lỗi nên đi thẳng lên; mọi lỗi
// khác (quyền, đĩa đầy, tên section sai) gom về `WRITE_FAILED`.
async function applyEdits(
  target: AwsIniTarget,
  edits: readonly IniEdit[],
  backups: string[],
): Promise<void> {
  if (edits.length === 0) return
  try {
    const { backup } = await applyAwsIniEdits(target, edits)
    if (backup !== null) backups.push(backup)
  } catch (err) {
    if (err instanceof Error && err.name === 'VERIFY_FAILED') throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw opError('WRITE_FAILED', `cannot write ~/.aws/${target}: ${detail}`)
  }
}

async function profileByName(name: string): Promise<AwsProfile | undefined> {
  return (await listAwsProfiles()).find((p) => p.name === name)
}

/**
 * `login_session` KHÔNG đi qua form: nó là định danh phiên do `aws login` sinh ra
 * và chỉ `console-login.ts` được ghi. Chặn ngay ở cửa vào, TRƯỚC `pickConfigKeys`,
 * để câu lỗi nói đúng sự thật — allowlist của `pickConfigKeys` trả "không phải
 * khoá ghi được", trong khi khoá này CÓ ghi được, chỉ không ghi từ đường này.
 */
function assertNoLoginSessionInPayload(config: Readonly<Record<string, string>>): void {
  const offending = Object.keys(config).find((k) => k.trim().toLowerCase() === 'login_session')
  if (offending === undefined) return
  throw opError(
    'LOGIN_READONLY',
    'login_session is written by `aws login` (console-login.ts), not by the profile form',
  )
}

/**
 * Hàng rào riêng cho profile `login` (`aws login`, aws-cli 2.35.9+).
 *
 * VÌ SAO CẦN. Ruột của một profile `login` là `login_session` — định danh phiên do
 * CLI sinh ra, còn token thật nằm trong cache của CLI. AWOG không dựng lại được
 * thứ đó từ form, nên ở đây nó chỉ được ĐỔI TÊN và đổi `region`:
 *
 *   · KHÔNG tạo: profile `login` chỉ ra đời từ `console-login.ts` (sau khi người
 *     dùng đăng nhập thật trong trình duyệt). Nhận `kind: 'login'` mà không có
 *     `previousName` là một profile trông như đã đăng nhập nhưng không có phiên
 *     nào — đúng loại dữ liệu giả mà luật §1b dựng ra để chặn.
 *   · KHÔNG đổi kiểu: bỏ `login_session` để thành `static` sẽ khiến botocore
 *     chạy bằng khoá dài hạn vừa nhập trong khi người dùng tưởng vẫn là phiên
 *     Console (cùng lý do `AwsProfileEditorLoginView.vue` chặn form static cho
 *     kiểu này). Muốn thế thì xoá profile rồi tạo lại — một hành động nói đúng ý.
 *   · KHÔNG ghi `login_session` từ form: giá trị đó chỉ có `console-login.ts`
 *     được sinh ra, và một lần ghi đè nhầm là mất phiên đang dùng.
 *
 * TÊN là thứ duy nhất người dùng cần sửa ở đây (2026-09-14): tên gợi ý mặc định
 * là `console`, mà trước bản vá này nó KHÔNG đổi được — người dùng muốn tên khác
 * chỉ còn cách đăng nhập lần nữa với tên mới, và kết quả là hai profile cho CÙNG
 * một tài khoản (`console` + `hoatq.dev`, cùng `login_session`, đo trên máy người
 * dùng 08:36 và 08:37 ngày 2026-09-14).
 */
function assertLoginEdit(
  kind: WritableProfileKind,
  source: AwsProfile | undefined,
  target: AwsProfile | undefined,
  previousName: string | undefined,
  name: string,
): void {
  if (kind === 'login') {
    if (previousName === undefined || source?.kind !== 'login') {
      throw opError(
        'LOGIN_READONLY',
        `a login profile is created by \`aws login\`, not by saving ${
          JSON.stringify(name)
        } (edit an existing login profile to rename it)`,
      )
    }
    return
  }
  if (source?.kind === 'login' || target?.kind === 'login') {
    throw opError(
      'LOGIN_READONLY',
      `profile ${
        JSON.stringify(source?.kind === 'login' ? (previousName ?? name) : name)
      } is a Console sign-in profile — delete it first to replace it with another kind`,
    )
  }
}

/**
 * Tạo hoặc sửa một profile.
 *
 * `previousName` ⇒ đổi tên ở CẢ HAI file (bỏ qua file không chứa section đó).
 * Khoá/secret không truyền = không đụng. Profile đích hoặc nguồn đang là
 * `credential_process` ⇒ `PROCESS_READONLY`.
 */
export async function saveProfile(input: SaveProfileInput): Promise<SaveProfileResult> {
  const name = assertProfileName(input.name)
  const previousName =
    input.previousName !== undefined ? assertProfileName(input.previousName) : undefined
  assertNoLoginSessionInPayload(input.config)
  // Cờ cho nhật ký: "lượt này CÓ ghi khoá" — tính từ việc có giá trị thật hay
  // không, chứ không từ việc form có gửi object `secrets` hay không (form luôn
  // gửi, và một dòng nhật ký nói sai thì tệ hơn là không có dòng nào).
  const hasSecretValues = Object.values(input.secrets ?? {}).some(
    (v) => typeof v === 'string' && v.trim() !== '',
  )

  return audited(
    {
      surface: input.surface,
      tool: 'profile_save',
      argv: [
        'save',
        '--name',
        name,
        '--kind',
        input.kind,
        ...(previousName !== undefined ? ['--rename-from', previousName] : []),
        ...(hasSecretValues ? ['--with-secrets'] : []),
      ],
      profile: name,
      class: 'write',
    },
    async () => {
      const configKeys = pickConfigKeys(input.config)
      const secretKeys = pickSecrets(input.kind, input.secrets)

      const existing = await listAwsProfiles()
      const byName = new Map(existing.map((p) => [p.name, p]))

      const source = previousName !== undefined ? byName.get(previousName) : undefined
      if (previousName !== undefined && !source) {
        throw opError('NOT_FOUND', `profile ${JSON.stringify(previousName)} does not exist`)
      }
      if (source?.kind === 'process') {
        throw opError(
          'PROCESS_READONLY',
          `profile ${JSON.stringify(previousName)} uses credential_process`,
        )
      }

      const target = byName.get(name)
      if (target?.kind === 'process') {
        throw opError('PROCESS_READONLY', `profile ${JSON.stringify(name)} uses credential_process`)
      }
      assertLoginEdit(input.kind, source, target, previousName, name)
      // "Đụng chỗ" = đích đã tồn tại và KHÔNG phải chính profile đang sửa.
      // `previousName` là danh tính của profile đang sửa (xem `SaveProfileInput`):
      // vắng mặt nghĩa là TẠO MỚI, và tạo mới đè lên tên đã có đúng là xung đột.
      const conflict = target !== undefined && target.name !== previousName
      if (conflict && input.overwrite !== true) {
        throw opError('EXISTS', `profile ${JSON.stringify(name)} already exists`)
      }
      const renaming = previousName !== undefined && previousName !== name

      const config: IniEdit[] = []
      const credentials: IniEdit[] = []
      const backups: string[] = []

      // CHỈ dọn chỗ khi ĐỔI TÊN vào một chỗ đã có người: `renameSection` từ chối
      // tên đích tồn tại. Ghi đè TẠI CHỖ (không đổi tên) thì không xoá gì — sửa
      // profile là sửa đúng những dòng đổi.
      //
      // Và cú xoá đó phải là một lần ghi RIÊNG: `applyAwsIniEdits` verify từng
      // edit trên bản đọc lại CUỐI CÙNG, nên "xoá X rồi đổi tên vào X" trong
      // cùng một lần ghi sẽ tự báo "section vẫn còn" và cuộn ngược cả hai.
      if (renaming && conflict && target) {
        if (inFile(target.source, 'config')) {
          await applyEdits(
            'config',
            [{ op: 'deleteSection', section: configSection(name) }],
            backups,
          )
        }
        if (inFile(target.source, 'credentials')) {
          await applyEdits('credentials', [{ op: 'deleteSection', section: name }], backups)
        }
      }
      if (renaming && source && previousName !== undefined) {
        if (inFile(source.source, 'config')) {
          config.push({
            op: 'renameSection',
            from: configSection(previousName),
            to: configSection(name),
          })
        }
        if (inFile(source.source, 'credentials')) {
          credentials.push({ op: 'renameSection', from: previousName, to: name })
        }
      }
      // Không có khoá nào thì KHÔNG tạo section rỗng: một profile static chỉ có
      // khoá (không region) là hợp lệ, và `[profile x]` trống chỉ làm bẩn file.
      // ĐỔI KIỂU ⇒ dọn khoá của kiểu cũ. Luật "vắng mặt = giữ nguyên" nói về
      // từng khoá TRONG một kiểu; nó không có nghĩa là giữ lại khoá của một kiểu
      // vừa bị bỏ. Chỉ dọn khi kiểu THẬT SỰ đổi — sửa region của một profile SSO
      // không được đụng vào `sso_*` của chính nó.
      const editing = source ?? target
      const kindChanged = editing !== undefined && editing.kind !== input.kind
      const staleConfig = kindChanged ? staleConfigKeysFor(input.kind) : []
      const hadConfigSection = editing !== undefined && inFile(editing.source, 'config')
      const hadCredentialsSection = editing !== undefined && inFile(editing.source, 'credentials')

      if (Object.keys(configKeys).length > 0 || (staleConfig.length > 0 && hadConfigSection)) {
        config.push({
          op: 'upsertSection',
          section: configSection(name),
          keys: configKeys,
          // Chỉ gắn khi section đã tồn tại: `upsertSection` với `keys` rỗng trên
          // một section chưa có sẽ ĐẺ RA `[profile x]` trống.
          ...(hadConfigSection && staleConfig.length > 0 ? { removeKeys: staleConfig } : {}),
        })
      }
      if (Object.keys(secretKeys).length > 0) {
        credentials.push({ op: 'upsertSection', section: name, keys: secretKeys })
      } else if (kindChanged && input.kind !== 'static' && hadCredentialsSection) {
        // Static → SSO/assume-role: ba khoá dài hạn phải rời `~/.aws/credentials`.
        credentials.push({ op: 'upsertSection', section: name, keys: {}, removeKeys: SECRET_INI_KEYS })
      }

      // Hai file, hai lần ghi — không có giao dịch chung. Mỗi file có bản sao
      // lưu riêng và mỗi lần ghi đã tự verify, nên hỏng ở file thứ hai để lại
      // trạng thái lệch nhưng KHÔNG mất dữ liệu: `backups` trả về đủ để lùi.
      await applyEdits('config', config, backups)
      await applyEdits('credentials', credentials, backups)

      const profile = await profileByName(name)
      if (!profile) {
        throw opError('VERIFY_FAILED', `profile ${JSON.stringify(name)} is missing after write`)
      }
      return { profile, backups }
    },
  )
}

/**
 * Xoá profile khỏi cả hai file. Không tồn tại ⇒ no-op (UI có thể bắn lệnh xoá
 * trên một danh sách vừa cũ đi vài trăm ms). `credential_process` ⇒ từ chối:
 * v1 không ghi dòng đó, và xoá cũng là ghi.
 */
export async function deleteProfile(
  rawName: string,
  surface: InfraSurface,
): Promise<DeleteProfileResult> {
  const name = assertProfileName(rawName)

  return audited(
    {
      surface,
      tool: 'profile_delete',
      argv: ['delete', '--name', name],
      profile: name,
      class: 'destructive',
    },
    async () => {
      const profile = await profileByName(name)
      if (!profile) return { removedFrom: [], backups: [] }
      if (profile.kind === 'process') {
        throw opError('PROCESS_READONLY', `profile ${JSON.stringify(name)} uses credential_process`)
      }

      const backups: string[] = []
      const removedFrom: AwsIniTarget[] = []
      if (inFile(profile.source, 'config')) {
        await applyEdits('config', [{ op: 'deleteSection', section: configSection(name) }], backups)
        removedFrom.push('config')
      }
      if (inFile(profile.source, 'credentials')) {
        await applyEdits('credentials', [{ op: 'deleteSection', section: name }], backups)
        removedFrom.push('credentials')
      }
      return { removedFrom, backups }
    },
  )
}

/**
 * Nhân bản một profile. Chạy Ở SIDECAR chứ không phải "UI đọc rồi lưu lại": UI
 * không bao giờ thấy giá trị secret nên bản sao client-side sẽ mất khoá.
 */
export async function duplicateProfile(input: DuplicateProfileInput): Promise<SaveProfileResult> {
  const from = assertProfileName(input.from)
  const to = assertProfileName(input.to)

  return audited(
    {
      surface: input.surface,
      tool: 'profile_duplicate',
      argv: ['duplicate', '--from', from, '--to', to],
      profile: to,
      class: 'write',
    },
    async () => {
      if (from === to) throw opError('EXISTS', 'source and target profile are the same')

      const existing = await listAwsProfiles()
      const byName = new Map(existing.map((p) => [p.name, p]))
      const source = byName.get(from)
      if (!source) throw opError('NOT_FOUND', `profile ${JSON.stringify(from)} does not exist`)
      if (source.kind === 'process') {
        throw opError('PROCESS_READONLY', `profile ${JSON.stringify(from)} uses credential_process`)
      }
      // Bản sao của một profile `login` dùng CHUNG một `login_session` ⇒ hai profile
      // cho một tài khoản, đúng thứ người dùng vừa gặp (2026-09-14). Việc có ích ở
      // đây là ĐỔI TÊN, và rename giữ nguyên phiên nên không cần bản sao nào.
      if (source.kind === 'login') {
        throw opError(
          'LOGIN_READONLY',
          `profile ${JSON.stringify(from)} is a Console sign-in profile — rename it instead of copying ` +
            '(a copy would share the same session and show up as a second profile for one account)',
        )
      }

      const target = byName.get(to)
      if (target && input.overwrite !== true) {
        throw opError('EXISTS', `profile ${JSON.stringify(to)} already exists`)
      }
      if (target?.kind === 'process') {
        throw opError('PROCESS_READONLY', `profile ${JSON.stringify(to)} uses credential_process`)
      }

      const overwrite = input.overwrite === true
      const backups: string[] = []
      // Ghi đè mà nguồn KHÔNG có mặt ở file nào đó thì bản cũ ở file đó phải đi
      // theo — nếu không, nhân bản một profile SSO đè lên một profile static sẽ
      // để lại khoá của bản cũ và profile mới lặng lẽ mang credential lạ.
      if (overwrite && target) {
        if (inFile(target.source, 'config') && !inFile(source.source, 'config')) {
          await applyEdits('config', [{ op: 'deleteSection', section: configSection(to) }], backups)
        }
        if (inFile(target.source, 'credentials') && !inFile(source.source, 'credentials')) {
          await applyEdits('credentials', [{ op: 'deleteSection', section: to }], backups)
        }
      }
      if (inFile(source.source, 'config')) {
        await applyEdits(
          'config',
          [
            {
              op: 'copySection',
              from: configSection(from),
              to: configSection(to),
              overwrite,
            },
          ],
          backups,
        )
      }
      if (inFile(source.source, 'credentials')) {
        await applyEdits('credentials', [{ op: 'copySection', from, to, overwrite }], backups)
      }

      const profile = await profileByName(to)
      if (!profile) {
        throw opError('VERIFY_FAILED', `profile ${JSON.stringify(to)} is missing after write`)
      }
      return { profile, backups }
    },
  )
}
