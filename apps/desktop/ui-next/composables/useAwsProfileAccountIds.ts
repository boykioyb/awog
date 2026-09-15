// A8 — account id theo profile (docs/features/aws-profile-manager.md, ADR 0088
// §5 `accountKindOf()`). Dùng chung giữa InfraAccountsList.vue (cột account id
// trong hàng danh sách) và InfraAccountsDetail.vue (hàng "Account" + nút điền
// riêng từng profile) — cả hai đọc qua orchestrator InfraAccounts.vue, không tự
// gọi composable này (giữ chúng THUẦN TRÌNH BÀY, đúng comment sẵn có trong hai
// file đó).
//
// `load()` CHỈ đọc cache trên đĩa (`infra.account-ids`, sidecar KHÔNG gọi mạng ở
// method này) — gọi được lúc mở trang. `resolve()` gọi `sts get-caller-identity`
// qua `infra.resolve-account-ids` — CHỈ được gọi khi người dùng bấm một nút,
// KHÔNG BAO GIỜ tự chạy trong onMounted/watch: đây là credential của người dùng
// và là tiền của họ (LUẬT CỨNG #1 của việc A8).
import { reactive, ref } from 'vue'
import { useAwsProfilesApi } from '~/composables/useAwsProfilesApi'
import type { AwsAccountIdEntry } from '~/composables/useAwsProfilesApi'
import { accountIdOfProfile } from '~/utils/aws-profile-view'
import type { AwsProfile } from '~/types'

export type AwsAccountIdFailure = { profile: string; error: string }

/**
 * Id đã biết cho một profile, GỘP cả hai nguồn:
 *  - `origin: 'config'` — miễn phí, đọc thẳng từ `~/.aws/config` (SSO
 *    `sso_account_id`, hoặc rút ra từ `role_arn`) — KHÔNG có mốc thời gian vì nó
 *    luôn "tươi" theo đúng nghĩa của việc đọc file cấu hình hiện hành.
 *  - `origin: 'sts'` — đã gọi `sts get-caller-identity` và cache lại; `at` là lúc
 *    phân giải (ISO 8601), hiện ra cho người dùng biết đây là giá trị đã cũ tới
 *    đâu.
 */
export type ResolvedAccountId = {
  accountId: string
  origin: AwsAccountIdEntry['origin']
  at?: string
}

export function useAwsProfileAccountIds() {
  const api = useAwsProfilesApi()

  // Khoá theo TÊN profile — phản chiếu cache trên đĩa
  // (~/.awog/infra/account-ids.json phía sidecar) sau load()/resolve().
  const entries = reactive<Record<string, AwsAccountIdEntry>>({})
  let loadInFlight = false

  // Nhiều nút có thể bấm gần nhau (bulk ở toolbar + nút riêng ở pane chi tiết) —
  // theo dõi ĐANG chạy theo TỪNG TÊN bằng một Set, không phải một cờ chung, để
  // nút của profile khác không bị khoá lây khi một cái khác đang gọi STS.
  const resolvingNames = reactive(new Set<string>())

  // Lỗi của LẦN resolve() gần nhất cho mỗi profile — mảng vì đó là hình dạng RPC
  // trả về (`failures[]`), tra theo tên qua failureFor().
  const failures = ref<AwsAccountIdFailure[]>([])

  /** Đọc cache trên đĩa — KHÔNG gọi mạng, an toàn để gọi lúc mở trang. */
  async function load(): Promise<void> {
    if (loadInFlight) return
    loadInFlight = true
    try {
      const { entries: fetched } = await api.accountIds()
      for (const e of fetched) entries[e.profile] = e
    } catch (err) {
      // Best-effort giống ensureHydrated() của useAwsProfileUsage.ts: cột account
      // id chỉ thiếu dữ liệu, không phải lỗi chặn trang.
      console.error('[infra] load account id cache failed', err)
    } finally {
      loadInFlight = false
    }
  }

  /**
   * Gọi `sts get-caller-identity` cho từng profile trong `names` — CHỈ được gọi
   * từ một tay bấm của người dùng (xem comment đầu file). Trả về tên đã điền
   * được / còn thất bại để nơi gọi tự ghép câu tóm tắt (toast) theo ngữ cảnh của
   * nó (bulk toàn danh sách hay một profile lẻ).
   */
  async function resolve(
    names: readonly string[],
  ): Promise<{ resolved: string[]; failed: AwsAccountIdFailure[] }> {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    if (!unique.length) return { resolved: [], failed: [] }
    for (const n of unique) resolvingNames.add(n)
    try {
      const res = await api.resolveAccountIds(unique)
      for (const e of res.entries) entries[e.profile] = e
      // Thay đúng phần của LẦN NÀY trong `failures` — profile không nằm trong
      // `unique` giữ nguyên lỗi cũ (nếu có) của một lần bấm khác trước đó; profile
      // trong `unique` mà lần này thành công thì lỗi cũ của nó phải biến mất.
      failures.value = [
        ...failures.value.filter((f) => !unique.includes(f.profile)),
        ...res.failures,
      ]
      const failedNames = new Set(res.failures.map((f) => f.profile))
      return { resolved: unique.filter((n) => !failedNames.has(n)), failed: res.failures }
    } finally {
      for (const n of unique) resolvingNames.delete(n)
    }
  }

  /** Ưu tiên giá trị MIỄN PHÍ (ssoAccountId/roleArn) rồi mới tới cache đã resolve. */
  function accountIdOf(
    profile: Pick<AwsProfile, 'name' | 'ssoAccountId' | 'roleArn' | 'loginSession'>,
  ): ResolvedAccountId | null {
    const free = accountIdOfProfile(profile)
    if (free) return { accountId: free, origin: 'config' }
    const cached = entries[profile.name]
    return cached ? { accountId: cached.accountId, origin: cached.origin, at: cached.at } : null
  }

  /**
   * Quên account id đã nhớ của một profile — đường LÙI khi `resolve()` không sửa
   * được giá trị sai (token hết hạn, mất quyền `sts:GetCallerIdentity`).
   *
   * Chỉ gỡ bản sao trong bộ nhớ khi sidecar đã ghi đĩa xong: hàng Account sẽ
   * quay về nút "Điền account ID", và nói thế trước khi đĩa đổi thật là nói dối.
   */
  async function forget(name: string): Promise<void> {
    await api.forgetAccountIds([name])
    delete entries[name]
    failures.value = failures.value.filter((f) => f.profile !== name)
  }

  function isResolving(name: string): boolean {
    return resolvingNames.has(name)
  }

  /** Lỗi THÔ (chưa dịch) của lần resolve() gần nhất cho profile này, hoặc `null`. */
  function failureFor(name: string): string | null {
    return failures.value.find((f) => f.profile === name)?.error ?? null
  }

  return { load, resolve, forget, accountIdOf, isResolving, failureFor }
}
