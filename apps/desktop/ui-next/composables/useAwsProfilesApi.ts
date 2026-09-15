// Thin typed wrapper around the sidecar `infra.*` RPCs for AWS profile CRUD +
// import/export (Mốc 1 — ADR 0088 §1b, docs/features/aws-profile-manager.md).
// Mirrors useSshApi.ts: one function per method, types matching the FROZEN
// contract handed down for this milestone — không tự đổi tên/shape.
//
// Bề mặt CỦA CON NGƯỜI: mọi hàm ở đây là UI gọi trực tiếp qua sidecar RPC, KHÔNG
// hàm nào được nối vào AgentTool (ADR 0088 §1b invariant "agent không có đường
// ghi này"). `profileSave` là đường MỘT CHIỀU duy nhất nhận giá trị secret — nó đi
// UI → sidecar trong đúng một lần gọi; không hàm nào ở đây TRẢ VỀ giá trị secret.
import { useSidecar } from './useSidecar'
import type { AwsProfile, AwsProfileKind } from '~/types'

// ── infra.profile-save ───────────────────────────────────────────────────────
/**
 * Kiểu profile ghi được qua `profileSave`. `login` là trường hợp HẸP HƠN: chỉ đổi
 * được tên + `region` của một profile `aws login` có sẵn (sidecar từ chối mọi thứ
 * khác bằng `LOGIN_READONLY`) — ruột của nó do `aws login` sinh ra.
 */
export type AwsProfileWriteKind = 'static' | 'sso' | 'assume-role' | 'login'

// Allowlist khoá ghi vào ~/.aws/config — khớp đúng bảng trong hợp đồng RPC.
export type AwsProfileConfigFields = {
  region?: string
  output?: string
  sso_start_url?: string
  sso_region?: string
  sso_account_id?: string
  sso_role_name?: string
  sso_session?: string
  role_arn?: string
  source_profile?: string
  mfa_serial?: string
  external_id?: string
  duration_seconds?: string
}

// CHỈ dùng khi kind === 'static'. Đi vào ~/.aws/credentials trong đúng một lần
// ghi; sidecar không lưu lại, không log, không event.
export type AwsProfileSecretFields = {
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
}

export type AwsProfileSaveParams = {
  name: string
  /**
   * Profile ĐANG ĐƯỢC SỬA — bằng `name` là sửa tại chỗ, khác `name` là đổi tên.
   * Vắng mặt ⇒ TẠO MỚI, và sidecar sẽ ném `EXISTS` nếu tên đã có người dùng.
   */
  previousName?: string
  kind: AwsProfileWriteKind
  config: AwsProfileConfigFields
  secrets?: AwsProfileSecretFields
  overwrite?: boolean
}

export type AwsProfileSaveResult = { ok: true; profile: AwsProfile; backups: string[] }

// Mã lỗi đứng ở ĐẦU message khi infra.profile-save / -delete / -duplicate ném lỗi
// (RpcError/Error thường, không phải discriminated result) — dùng để narrow ở
// call site, vd `err.message.startsWith('EXISTS')`.
export type AwsProfileWriteErrorCode =
  | 'INVALID_NAME'
  | 'EXISTS'
  | 'TARGET_REQUIRED'
  | 'CONFIRM_REQUIRED'
  | 'FORBIDDEN_TARGET'
  | 'NOT_FOUND'
  | 'PROCESS_READONLY'
  /** Profile `login`: tạo bằng form / đổi kiểu / ghi `login_session` đều bị chặn. */
  | 'LOGIN_READONLY'
  | 'UNKNOWN_KEY'
  | 'WRITE_FAILED'
  | 'VERIFY_FAILED'

// ── infra.profile-delete / -duplicate ───────────────────────────────────────
export type AwsProfileDeleteResult = {
  ok: true
  removedFrom: ('config' | 'credentials')[]
  backups: string[]
}
export type AwsProfileDuplicateResult = { ok: true; profile: AwsProfile; backups: string[] }

// ── infra.identity-check ────────────────────────────────────────────────────
export type AwsIdentityCheckResult =
  | { ok: true; accountId: string; arn: string; userId: string }
  | { ok: false; error: string }

/**
 * Hai nguồn danh tính LOẠI TRỪ NHAU (sidecar ép bằng zod):
 *   · `profile` — profile đã ghi trên đĩa (ngữ cảnh đi bằng `--profile`).
 *   · `secrets` — bộ khoá người dùng vừa gõ trong form, kiểm tra TRƯỚC khi ghi.
 *     Khoá đi bằng env của tiến trình con, KHÔNG bao giờ bằng cờ/argv.
 */
export type AwsIdentityCheckParams = {
  profile?: string
  region?: string
  secrets?: AwsProfileSecretFields
}

// ── infra.profile-secrets ───────────────────────────────────────────────────
//
// BA khoá tĩnh của MỘT profile, để form SỬA hiển thị giá trị hiện tại thay vì
// placeholder "để trống = giữ nguyên". Đây là hàm ĐỌC secret duy nhất của UI:
// đường liệt kê (`contexts()`) vẫn không bao giờ trả secret (invariant #1).
export type AwsProfileStaticSecrets = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

// ── infra.console-login ─────────────────────────────────────────────────────
//
// Đăng nhập Console bằng trình duyệt qua `aws login` (aws-cli 2.35.9+). Đây là
// đường DUY NHẤT đưa được bộ ba `Account ID/alias + IAM username + Password`
// thành credential mà CLI dùng được mà KHÔNG sinh khoá dài hạn — và nó không cần
// người dùng mở terminal gõ lệnh.
export type AwsConsoleLoginParams = { profile: string; region: string }

// `ok:false` là kết quả hợp lệ (người dùng đóng trình duyệt, CLI hết thời gian
// chờ…), không phải lỗi transport — nên kiểu phải nói ra điều đó.
export type AwsConsoleLoginResult =
  | { ok: true; profile: string; backups: string[] }
  | { ok: false; error: string }

// Kết quả `infra.console-login-private`: mở URL uỷ quyền trong cửa sổ ẩn danh để
// thoát trang `400 Bad Request` do cookie AWS cũ (aws/aws-cli#10186). `ok:false`
// kèm mã (`BAD_URL` · `NO_BROWSER` · `LAUNCH_FAILED`) để UI nói được ĐÚNG việc
// người dùng cần làm tiếp, thay vì "không mở được".
export type AwsConsoleLoginPrivateResult =
  | { ok: true; browser: string }
  | { ok: false; error: 'BAD_URL' | 'NO_BROWSER' | 'LAUNCH_FAILED' }

// Payload của sự kiện `infra.console-login.url`: URL uỷ quyền mà `aws login` in
// ra NGAY khi mở trình duyệt (trước khi người dùng đăng nhập xong). Có nó thì
// người dùng vẫn đi tiếp được khi trình duyệt mặc định không mở, hoặc khi trang
// đăng nhập trả `400 Bad Request` vì cookie AWS cũ — lỗi đã biết của aws-cli
// (aws/aws-cli#10186), lúc đó CLI treo im lặng cho tới hết timeout.
export type AwsConsoleLoginUrlEvent = { profile: string; url: string }

// ── infra.profile-import-preview / -apply ───────────────────────────────────
export type AwsProfileImportSource = 'paste' | 'file' | 'csv'

export type AwsProfileImportEntry = {
  name: string
  kind: AwsProfileKind
  // Metadata thô đọc được từ khối dán/file — KHÔNG bao giờ chứa giá trị secret.
  keys: Record<string, string>
  hasStaticKeys: boolean
  hasSessionToken: boolean
  conflict: 'none' | 'config' | 'credentials' | 'both'
}

export type AwsProfileImportPreviewParams = {
  source: AwsProfileImportSource
  text?: string
  path?: string
}
export type AwsProfileImportPreviewResult = {
  entries: AwsProfileImportEntry[]
  warnings: string[]
}

export type AwsProfileImportSelection = { from: string; to: string; overwrite: boolean }
export type AwsProfileImportApplyParams = AwsProfileImportPreviewParams & {
  selections: AwsProfileImportSelection[]
}
export type AwsProfileImportApplyResult = {
  ok: true
  created: string[]
  overwritten: string[]
  skipped: string[]
  backups: string[]
  warnings: string[]
}

// ── infra.sso-* ──────────────────────────────────────────────────────────────
export type AwsSsoLoginParams = { sessionName: string; startUrl: string; ssoRegion: string }
export type AwsSsoLoginResult = { ok: true } | { ok: false; error: string }

export type AwsSsoAccount = {
  accountId: string
  accountName: string
  emailAddress?: string
  roles: string[]
}
export type AwsSsoListResult =
  | { ok: true; accounts: AwsSsoAccount[]; warnings: string[] }
  | { ok: false; error: string; needsLogin?: boolean }

export type AwsSsoProfilePick = { accountId: string; roleName: string; profileName: string }
export type AwsSsoCreateProfilesParams = {
  sessionName: string
  ssoRegion: string
  startUrl: string
  region?: string
  picks: AwsSsoProfilePick[]
  overwrite?: boolean
}
export type AwsSsoCreateProfilesResult = {
  ok: true
  created: string[]
  skipped: string[]
  backups: string[]
  /** Profile bị ghi đè mà sidecar đã gỡ khoá dài hạn cũ khỏi ~/.aws/credentials. */
  clearedStaticKeys: string[]
  warnings: string[]
}

// ── infra.profile-export* ───────────────────────────────────────────────────
export type AwsProfileExportParams = {
  names: string[]
  includeSecrets: boolean
  /** Bắt buộc khi includeSecrets=true — phải khớp đúng một tên trong `names`. */
  confirmName?: string
  /** BẮT BUỘC khi includeSecrets=true — thiếu ⇒ sidecar ném `TARGET_REQUIRED`. */
  targetPath?: string
}
// Hai nhánh LOẠI TRỪ nhau, khớp union thật của `exportProfiles()` phía sidecar:
// có `targetPath` ⇒ ghi file, trả `path`; không có ⇒ trả nội dung qua `text` —
// và nhánh `text` chỉ tồn tại khi includeSecrets=false, vì sidecar từ chối xuất
// kèm khoá mà không có đích (luật cứng #5: không xem trước nội dung có khoá).
export type AwsProfileExportResult =
  | { ok: true; format: 'ini'; path: string }
  | { ok: true; format: 'ini'; text: string }

export type AwsProfileExportCommandsResult = { commands: string[] }

// ── A7: tự dò nguồn SSO ──────────────────────────────────────────────────────
// Ba nơi trên máy đã biết start URL của tổ chức: block `[sso-session x]` trong
// config, profile SSO kiểu cũ (`sso_start_url`), và cache của những lần
// `aws sso login` trước. Không nguồn nào chứa secret — `accessToken` trong cache
// KHÔNG BAO GIỜ đi lên đây, chỉ còn `hasLiveToken: boolean`.
export type AwsSsoSourceOrigin = 'sso-session' | 'profile' | 'cache'
export type AwsSsoSource = {
  /** Có khi nguồn là `[sso-session x]`; hai nguồn kia thì UI tự gợi ý tên. */
  sessionName?: string
  startUrl: string
  ssoRegion?: string
  origin: AwsSsoSourceOrigin
  /** Cache còn token chưa hết hạn ⇒ bỏ qua được bước đăng nhập. */
  hasLiveToken: boolean
  /** Profile đang dùng nguồn này (để UI nói "đã có N profile từ đây"). */
  profileCount: number
}
export type AwsSsoSourcesResult = { sources: AwsSsoSource[] }

// ── A8: account id theo profile ──────────────────────────────────────────────
// Vì sao đáng làm: `accountKindOf()` (sidecar infra/policy.ts) coi **vắng
// accountId ⇒ production**. Profile static/assume-role chưa biết id vì thế luôn
// bị chấm ở cột nghiêm nhất — điền id vào là cách duy nhất để tài khoản dev được
// đối xử như dev.
export type AwsAccountIdEntry = {
  profile: string
  accountId: string
  arn?: string
  /** ISO 8601 — lúc phân giải. */
  at: string
  /** Nguồn: `sso_account_id` có sẵn trong config, hay phải gọi STS. */
  origin: 'config' | 'sts'
}
export type AwsAccountIdsResult = { entries: AwsAccountIdEntry[] }
export type AwsResolveAccountIdsResult = {
  entries: AwsAccountIdEntry[]
  failures: { profile: string; error: string }[]
}
/** Bao nhiêu entry thật sự bị gỡ — gồm cả entry rác mà lần ghi này dọn tiện tay. */
export type AwsForgetAccountIdsResult = { removed: number }

export function useAwsProfilesApi() {
  const sidecar = useSidecar()
  return {
    // ── đọc (đã có ở Mốc 0) ──
    contexts: () =>
      sidecar.request<{ tool: 'aws'; contexts: AwsProfile[] }>('infra.contexts', {
        tool: 'aws',
      }),

    // ── ghi profile (A1/A3) ──
    profileSave: (params: AwsProfileSaveParams) =>
      sidecar.request<AwsProfileSaveResult>('infra.profile-save', params),
    profileDelete: (name: string) =>
      sidecar.request<AwsProfileDeleteResult>('infra.profile-delete', { name }),
    profileDuplicate: (from: string, to: string, overwrite?: boolean) =>
      sidecar.request<AwsProfileDuplicateResult>('infra.profile-duplicate', {
        from,
        to,
        ...(overwrite != null ? { overwrite } : {}),
      }),
    identityCheck: (params: AwsIdentityCheckParams) =>
      sidecar.request<AwsIdentityCheckResult>('infra.identity-check', params),
    // Bề mặt CỦA CON NGƯỜI: form sửa gọi khi mở một profile có khoá tĩnh.
    // Sidecar ghi một dòng nhật ký cho mỗi lần đọc (không kèm giá trị khoá).
    profileSecrets: (name: string) =>
      sidecar.request<AwsProfileStaticSecrets>('infra.profile-secrets', { name }),

    // ── nhập (A4) ──
    profileImportPreview: (params: AwsProfileImportPreviewParams) =>
      sidecar.request<AwsProfileImportPreviewResult>('infra.profile-import-preview', params),
    profileImportApply: (params: AwsProfileImportApplyParams) =>
      sidecar.request<AwsProfileImportApplyResult>('infra.profile-import-apply', params),

    // ── SSO (A5) ──
    ssoLogin: (params: AwsSsoLoginParams) =>
      sidecar.request<AwsSsoLoginResult>('infra.sso-login', params),

    // ── đăng nhập Console (bổ sung sau Mốc 1) ──
    consoleLogin: (params: AwsConsoleLoginParams) =>
      sidecar.request<AwsConsoleLoginResult>('infra.console-login', params),
    // Huỷ CỨNG phiên đang chờ: giết tiến trình `aws login`, không chỉ bỏ chờ ở
    // UI (xem methods/infra.console-login-cancel.ts).
    consoleLoginCancel: () =>
      sidecar.request<{ cancelled: boolean }>('infra.console-login-cancel', {}),
    // Mở URL uỷ quyền CLI đã in ra trong cửa sổ ẩn danh/riêng tư. Đây là đường
    // thoát khỏi `400 Bad Request` (cookie AWS cũ) mà KHÔNG cần người dùng tự
    // sao chép URL sang cửa sổ riêng tư — xem methods/infra.console-login-private.ts.
    consoleLoginPrivate: (url: string) =>
      sidecar.request<AwsConsoleLoginPrivateResult>('infra.console-login-private', { url }),
    ssoList: (sessionName: string) =>
      sidecar.request<AwsSsoListResult>('infra.sso-list', { sessionName }),
    ssoCreateProfiles: (params: AwsSsoCreateProfilesParams) =>
      sidecar.request<AwsSsoCreateProfilesResult>('infra.sso-create-profiles', params),

    // ── xuất (A6) ──
    profileExport: (params: AwsProfileExportParams) =>
      sidecar.request<AwsProfileExportResult>('infra.profile-export', params),
    profileExportCommands: (name: string) =>
      sidecar.request<AwsProfileExportCommandsResult>('infra.profile-export-commands', {
        name,
      }),
    // ── tự dò nguồn SSO (A7) ──
    ssoSources: () => sidecar.request<AwsSsoSourcesResult>('infra.sso-sources', {}),

    // ── account id theo profile (A8) ──
    // `accountIds()` chỉ ĐỌC cache, không gọi mạng. `resolveAccountIds()` gọi
    // `sts get-caller-identity` — CHỈ chạy khi người dùng bấm, không bao giờ tự
    // chạy lúc mở trang.
    accountIds: () => sidecar.request<AwsAccountIdsResult>('infra.account-ids', {}),
    resolveAccountIds: (names: string[]) =>
      sidecar.request<AwsResolveAccountIdsResult>('infra.resolve-account-ids', { names }),
    // Đường LÙI của `resolveAccountIds()`: xoá giá trị đã nhớ. `names` vắng ⇒
    // quên SẠCH; `names: []` nghĩa là "không quên gì cả", nên hai ý không trùng
    // hình dạng (khớp hợp đồng phía sidecar).
    forgetAccountIds: (names?: string[]) =>
      sidecar.request<AwsForgetAccountIdsResult>(
        'infra.forget-account-ids',
        names === undefined ? {} : { names },
      ),
  }
}
