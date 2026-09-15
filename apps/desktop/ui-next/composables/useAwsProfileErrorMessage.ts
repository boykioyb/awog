// Dịch lỗi của các infra.profile-*/-account-id RPC thành câu tiếng người — tách
// khỏi InfraAccounts.vue để giữ SFC gọn (.claude/rules/nuxt-vue.md, ~250 dòng) và
// vì đây là một mối quan tâm riêng (đọc RpcError.data.code / nhận diện mẫu lỗi
// thô) khác với việc điều phối UI của component gọi nó.
//
// profileSave/-delete/-duplicate ném lỗi có mã ở `data.code` (RpcError, xem
// throwProfileRpcError ở sidecar profile-ops.ts) — dịch mã thành câu tiếng người,
// KHÔNG đoán nếu mã lạ (fallback về message thô của lỗi thay vì im lặng nuốt).
import { useI18n } from '~/composables/useI18n'
import { SidecarError } from '~/composables/useSidecar'

const PROFILE_ERROR_I18N: Record<string, string> = {
  INVALID_NAME: 'infra.list.err.invalidName',
  EXISTS: 'infra.list.err.exists',
  NOT_FOUND: 'infra.list.err.notFound',
  PROCESS_READONLY: 'infra.list.err.processReadonly',
  // Profile `login` (`aws login`): form chỉ đổi được tên/region, nên cả ba đường
  // tạo mới — lưu bằng form, đổi kiểu, nhân bản — đều trả về cùng một mã.
  LOGIN_READONLY: 'infra.list.err.loginReadonly',
  UNKNOWN_KEY: 'infra.list.err.unknownKey',
  WRITE_FAILED: 'infra.list.err.writeFailed',
  VERIFY_FAILED: 'infra.list.err.verifyFailed',
  // A8 — infra.resolve-account-ids ném mã này khi >50 tên trong một lần gọi
  // (xem ResolveAccountIdsInput ở sidecar); dùng chung bảng dịch mã có sẵn thay
  // vì viết một lớp dịch lỗi thứ hai.
  TOO_MANY: 'infra.list.err.tooManyAccountIds',
}

// A8 — `infra.resolve-account-ids` trả `failures[]` là CHUỖI THÔ từ AWS CLI
// (message redact + cắt 400 ký tự phía sidecar), không phải mã lỗi có cấu trúc
// như PROFILE_ERROR_I18N ở trên. Nhận diện vài mẫu THƯỜNG GẶP để dịch sang câu
// người; mẫu lạ thì KHÔNG bịa ra chi tiết — trả một câu chung chung thay vì lộ
// message thô ra UI (LUẬT "dịch thành câu tiếng người, không phải mã thô" của A8).
const ACCOUNT_ID_FAILURE_PATTERNS: readonly { test: RegExp; key: string }[] = [
  { test: /expired/i, key: 'infra.list.accountId.err.expired' },
  { test: /InvalidClientTokenId|SignatureDoesNotMatch/i, key: 'infra.list.accountId.err.badKeys' },
  { test: /AccessDenied/i, key: 'infra.list.accountId.err.denied' },
  {
    test: /Unable to locate credentials|could not be found/i,
    key: 'infra.list.accountId.err.noCredentials',
  },
]

export function useAwsProfileErrorMessage() {
  const { t } = useI18n()

  function describeError(err: unknown, fallback: string): string {
    if (
      err instanceof SidecarError &&
      err.data &&
      typeof err.data === 'object' &&
      'code' in err.data
    ) {
      const code = (err.data as { code?: unknown }).code
      if (typeof code === 'string') {
        const key = PROFILE_ERROR_I18N[code]
        if (key) return t(key)
      }
    }
    return err instanceof Error && err.message ? err.message : fallback
  }

  function describeAccountIdFailure(raw: string): string {
    const hit = ACCOUNT_ID_FAILURE_PATTERNS.find((p) => p.test.test(raw))
    return t(hit ? hit.key : 'infra.list.accountId.err.generic')
  }

  return { describeError, describeAccountIdFailure }
}
