// Tri thức thuần (không i18n, không store) dùng chung giữa InfraAccountsList và
// InfraAccountsDetail (Mốc 1, việc A2) — tách ra đây để hai nơi hiển thị cùng một
// profile không lặng lẽ lệch nhau về cách đọc account id / tính hạn dùng.
//
// CỐ Ý không trả chuỗi đã dịch: mỗi component tự ghép nhãn qua `t()` (i18n cần
// context component), hàm ở đây chỉ trả dữ liệu có cấu trúc.
import type { AwsProfile, AwsProfileSource } from '~/types'

export type AwsProfileExpiry =
  | { status: 'expired' }
  | { status: 'expiring'; hours: number; minutes: number }

/**
 * Đọc `expiresAt` (ISO 8601, từ `x_security_token_expires`) thành trạng thái còn
 * hạn/hết hạn. `Date.now()` được gọi tại thời điểm computed re-evaluate — nhãn
 * "còn N phút" có thể lệch vài phút giữa hai lần render nếu không có gì khác đổi
 * (không có đồng hồ đếm ngược); chấp nhận được cho Mốc 1, YAGNI.
 */
export function computeExpiry(expiresAt: string | undefined): AwsProfileExpiry | null {
  if (!expiresAt) return null
  const ms = Date.parse(expiresAt)
  if (Number.isNaN(ms)) return null
  const diffMs = ms - Date.now()
  if (diffMs <= 0) return { status: 'expired' }
  const totalMinutes = Math.round(diffMs / 60000)
  return { status: 'expiring', hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

// Account id "biết được" mà không cần gọi identity-check: trực tiếp từ SSO, hoặc
// rút ra từ `role_arn` (arn:aws:iam::<12 số>:role/...). Trả '' khi không biết —
// gọi nơi hiển thị đừng bịa ra một giá trị khác.
const IAM_ARN_ACCOUNT_RE = /^arn:aws[a-z0-9-]*:iam::(\d{12}):/

export function accountIdOfProfile(
  p: Pick<AwsProfile, 'ssoAccountId' | 'roleArn'> & Partial<Pick<AwsProfile, 'loginSession'>>,
): string {
  if (p.ssoAccountId) return p.ssoAccountId
  // `login_session` cũng là ARN IAM (…:iam::<account>:root) ⇒ account id đọc được
  // ngay từ file, không cần gọi STS. Trước đây profile `login` phải chờ
  // `resolve_account_id` mới hiện được số tài khoản.
  const m = (p.roleArn ?? p.loginSession ?? '').match(IAM_ARN_ACCOUNT_RE)
  return m?.[1] ?? ''
}

/**
 * Account id rút từ `login_session` của profile `aws login` — giá trị là ARN định
 * danh phiên (`arn:aws:iam::797859922771:root`). Cùng khuôn với `accountIdOfProfile`:
 * biết thì trả, không biết thì trả '' chứ không đoán.
 */
export function accountIdOfLoginSession(loginSession: string | undefined): string {
  return loginSession?.match(IAM_ARN_ACCOUNT_RE)?.[1] ?? ''
}

/**
 * Tên các profile KHÁC đang trỏ vào CÙNG một `login_session`.
 *
 * Ca thật 2026-09-14: người dùng có `console` và `hoatq.dev` cùng
 * `login_session = arn:aws:iam::797859922771:root` — hai profile cho một tài khoản,
 * vì tên gợi ý mặc định (`console`) không đổi được ở bản trước. Hàm này để màn Sửa
 * nói thẳng ra thay vì để người dùng tự phát hiện.
 */
export function otherProfilesWithSameSession(
  profile: Pick<AwsProfile, 'name' | 'loginSession'>,
  all: readonly Pick<AwsProfile, 'name' | 'loginSession'>[],
  pendingName = '',
): string[] {
  const session = profile.loginSession?.trim()
  if (!session) return []
  const self = new Set([profile.name, pendingName.trim()])
  return all
    .filter((p) => p.loginSession?.trim() === session && !self.has(p.name))
    .map((p) => p.name)
    .sort()
}

// Một nguồn duy nhất cho "profile.source → khoá i18n hiển thị" — InfraAccountsDetail
// (bảng thuộc tính) và InfraAccounts (mô tả hộp xác nhận xoá) đều cần đúng cùng một
// nhãn; tách khỏi cả hai để không lệch nhau khi một bên sửa mà quên bên kia.
export const AWS_PROFILE_SOURCE_LABEL_KEY: Record<AwsProfileSource, string> = {
  config: 'infra.list.field.sourceConfig',
  credentials: 'infra.list.field.sourceCredentials',
  both: 'infra.list.field.sourceBoth',
}

// Cùng bộ ký tự cho phép với sidecar (infra/aws/profiles.ts AWS_PROFILE_NAME_RE) —
// chép tay vì UI và sidecar là hai tiến trình riêng, không share module.
export const AWS_PROFILE_NAME_RE = /^[A-Za-z0-9._@:/+=-]{1,128}$/

/** Gợi ý tên khi nhân bản một profile — `<base>-copy`, lệch số nếu đã có. */
export function suggestDuplicateProfileName(base: string, existingNames: Iterable<string>): string {
  const existing = new Set(existingNames)
  let n = 2
  let candidate = `${base}-copy`
  while (existing.has(candidate)) {
    candidate = `${base}-copy-${n}`
    n += 1
  }
  return candidate
}
