import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAwsProfilesApi } from '~/composables/useAwsProfilesApi'
import { useInfraContext } from '~/composables/useInfraContext'
import { useSidecar } from '~/composables/useSidecar'
import type { AwsProfile } from '~/types'

// Page-controller cho /infra → Tài khoản (Mốc 1, việc U0 — CHỈ dựng khung).
// Sở hữu: danh sách profile (derive mỗi lần gọi, không cache lâu dài — ADR 0088
// §2), ô tìm, profile đang chọn, trạng thái tải/lỗi, và 4 overlay
// (editor/import/sso-import/export). KHÔNG chứa logic ghi/xoá/nhân bản/kiểm tra
// danh tính thật — bốn component ruột (A2-A6) tự gọi useAwsProfilesApi() bên
// trong chính chúng và chỉ emit một tín hiệu "xong việc" lên đây để page reload().
//
// Khuôn theo useSshPage.ts, nhưng KHÔNG có store Pinia riêng cho AWS profile —
// đúng quyết định ADR 0088 §2 "không có store mới; watcher thay cho state".

export type InfraOverlay = 'editor' | 'import' | 'sso-import' | 'export' | 'console-login' | null

export function useInfraPage() {
  const api = useAwsProfilesApi()
  const sidecar = useSidecar()
  // `sessionId: null` — trang /infra đứng NGOÀI mọi phiên (ADR 0088 §7 phần
  // useInfraContext.ts), nên tầng phiên bị bỏ qua dù đang có phiên mở ở tab khác.
  const infraContext = useInfraContext({ sessionId: null })

  // --- danh sách ---------------------------------------------------------
  const profiles = ref<AwsProfile[]>([])
  const loading = ref(false)
  const error = ref('')
  const search = ref('')
  const selected = ref('')

  const visibleProfiles = computed<AwsProfile[]>(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return profiles.value
    return profiles.value.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.ssoAccountId ?? '').toLowerCase().includes(q),
    )
  })

  // Mặc định TOÀN APP đang ghim — hiển thị dấu "● mặc định" trên đúng một dòng.
  const defaultProfile = computed(() => infraContext.appValue.value.profile ?? '')

  async function reload(): Promise<void> {
    // Browser dev (không có Electron shell) — trạng thái rỗng, không vỡ trang.
    if (!sidecar.available) {
      profiles.value = []
      error.value = ''
      return
    }
    loading.value = true
    error.value = ''
    try {
      const res = await api.contexts()
      profiles.value = res.contexts
      if (!res.contexts.some((p) => p.name === selected.value)) {
        selected.value = res.contexts[0]?.name ?? ''
      }
    } catch (err) {
      console.error('[infra] load profiles failed', err)
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function select(name: string): void {
    selected.value = name
  }

  // "Đặt làm mặc định" KHÔNG phải RPC (aws-profile-manager.md) — chỉ ghi mặc định
  // toàn app qua store settings, giữ nguyên các field khác (cluster/namespace/…)
  // đã ghim trước đó chứ không xoá sạch cụm.
  //
  // REGION ĐI THEO PROFILE khi profile có khai region (2026-09-14). Yêu cầu "các
  // dịch vụ, service phải theo account đó": đọc tài khoản mới bằng region cũ là
  // đọc đúng credential nhưng SAI chỗ — endpoint vẫn là region của tài khoản
  // trước, nên bảng có thể trống một cách vô lý (hoặc tệ hơn, hiện tài nguyên
  // trùng tên ở region cũ). Profile KHÔNG khai region thì giữ nguyên region đang
  // ghim: `aws` sẽ tự rơi về region trong `~/.aws/config` của chính profile đó,
  // còn xoá trắng ở đây thì mọi lệnh sau đó mất luôn region.
  function setDefaultProfile(name: string): void {
    // `accountId` đã ghim thuộc về profile CŨ. Giữ nó lại khi đổi profile là gắn
    // nhãn tài khoản này lên tài khoản khác — và sai theo hướng nguy hiểm:
    // `accountKindOf()` (sidecar infra/policy.ts) chấm cột `production` THEO
    // accountId, nên một id dev còn sót sẽ hạ đúng một profile production xuống
    // `normal` và mở lại ô `destructive` mà lẽ ra bị chặn. InfraChip đã phòng
    // đúng ca này khi đổi profile trong phiên; tầng app phải phòng y hệt.
    //
    // Chỉ điền lại id khi biết CHẮC nó thuộc profile mới — `ssoAccountId` là
    // giá trị nằm sẵn trong `~/.aws/config` của chính profile đó, không phải
    // suy đoán. Các kiểu còn lại để trống: `''` nghĩa là "không ghim" và
    // `accountKindOf()` sẽ fail-safe về `production`, tức hỏi thừa chứ không
    // bao giờ hỏi thiếu.
    const next = profiles.value.find((p) => p.name === name)
    infraContext.setForApp({
      ...infraContext.appValue.value,
      profile: name,
      accountId: next?.ssoAccountId ?? '',
      ...(next?.region ? { region: next.region } : {}),
    })
  }

  /**
   * Đổi REGION của ngữ cảnh toàn app, giữ nguyên profile/accountId đang ghim.
   * Cùng một cửa vào như `setDefaultProfile` — thanh ngữ cảnh đầu trang là control
   * duy nhất chọn tài khoản, mà region là một nửa của "tài khoản" đó (cùng một
   * lệnh `aws` vừa nhận `--profile` vừa nhận `--region`).
   */
  function setRegion(region: string): void {
    infraContext.setForApp({ ...infraContext.appValue.value, region })
  }

  /**
   * Ghim account id vừa do AWS trả về vào ngữ cảnh TOÀN APP — nhưng chỉ khi nó
   * thuộc đúng profile đang là mặc định, vì `settings.infra` giữ MỘT cặp
   * (profile, accountId) chứ không phải một bảng.
   *
   * Đây là đường DUY NHẤT để id phân giải ở màn này tới được ma trận quyền, và
   * nó cố ý đi qua kênh cũ (`settings.infra`, khuôn InfraChip) thay vì qua cache
   * `~/.awog/infra/account-ids.json`: file đó agent ghi được bằng `Bash` và
   * trường `fp` của nó KHÔNG phải chữ ký (xem runtime/permission.ts), nên để nó
   * làm đầu vào của `accountKindOf()` là biến một file giả mạo được thành thứ
   * hạ được hàng rào mạnh nhất. Giá trị truyền vào đây phải đến thẳng từ một
   * lời gọi STS vừa chạy, không phải đọc lên từ cache.
   */
  function pinAccountIdForDefault(profileName: string, accountId: string): void {
    if (!accountId || profileName !== defaultProfile.value) return
    infraContext.setForApp({
      ...infraContext.appValue.value,
      profile: profileName,
      accountId,
    })
  }

  // --- 4 overlay -----------------------------------------------------------
  const overlay = ref<InfraOverlay>(null)
  const editTarget = ref<AwsProfile | null>(null)

  const openNewProfile = () => {
    editTarget.value = null
    overlay.value = 'editor'
  }
  const openEditProfile = (p: AwsProfile) => {
    editTarget.value = p
    overlay.value = 'editor'
  }
  const closeEditor = () => {
    overlay.value = null
    editTarget.value = null
  }
  const openImport = () => {
    overlay.value = 'import'
  }
  const closeImport = () => {
    overlay.value = null
  }
  const openSsoImport = () => {
    overlay.value = 'sso-import'
  }
  const closeSsoImport = () => {
    overlay.value = null
  }
  const openExport = () => {
    overlay.value = 'export'
  }
  const closeExport = () => {
    overlay.value = null
  }

  // Đăng nhập Console (`aws login`). `profile` có giá trị khi mở từ màn sửa của
  // một profile `login` sẵn có ("đăng nhập lại") — lúc đó KHÔNG gợi ý tên mới.
  const consoleLoginTarget = ref('')
  const openConsoleLogin = (profile?: string) => {
    consoleLoginTarget.value = profile ?? ''
    overlay.value = 'console-login'
  }
  const closeConsoleLogin = () => {
    overlay.value = null
    consoleLoginTarget.value = ''
  }

  // Component ruột tự gọi RPC + tự toast; đây chỉ là điểm neo "đã xong, nạp lại
  // danh sách" dùng chung cho mọi lối ra (save/import/duplicate/delete/…).
  const refresh = () => {
    void reload()
  }
  const onEditorSaved = () => {
    closeEditor()
    refresh()
  }
  const onImportDone = () => {
    closeImport()
    refresh()
  }
  const onSsoImportDone = () => {
    closeSsoImport()
    refresh()
  }
  const onConsoleLoginDone = () => {
    closeConsoleLogin()
    refresh()
  }

  // --- theo dõi ~/.aws đổi ngoài app (`aws configure`/`aws sso login` chạy từ
  // terminal khác) — sidecar/src/watcher.ts bắn `infra.fs-changed` khi đúng hai
  // file config/credentials đổi (allowlist cứng, xem comment ở đó). ------------
  let unlisten: (() => void) | null = null
  onMounted(async () => {
    await reload()
    if (!sidecar.available) return
    try {
      unlisten = await sidecar.onEvent((e) => {
        if (e.type === 'infra.fs-changed') refresh()
      })
    } catch (err) {
      console.error('[infra] subscribe infra.fs-changed failed', err)
    }
  })
  onBeforeUnmount(() => {
    unlisten?.()
  })

  return {
    // danh sách
    profiles: visibleProfiles,
    // Danh sách GỐC (chưa lọc theo ô tìm). Overlay phải dùng cái này: picker bên
    // trong modal (source_profile của assume-role, tick profile để xuất) nói về
    // TOÀN BỘ profile, không phải tập mà ô tìm của màn nền tình cờ đang lọc.
    allProfiles: profiles,
    loading,
    error,
    search,
    selected,
    defaultProfile,
    select,
    reload,
    setDefaultProfile,
    setRegion,
    pinAccountIdForDefault,
    /** Region đang ghim toàn app — điền sẵn cho modal đăng nhập Console. */
    pinnedRegion: computed(() => infraContext.appValue.value.region ?? ''),
    // overlay
    overlay,
    editTarget,
    openNewProfile,
    openEditProfile,
    closeEditor,
    openImport,
    closeImport,
    openSsoImport,
    closeSsoImport,
    openExport,
    closeExport,
    openConsoleLogin,
    closeConsoleLogin,
    consoleLoginTarget,
    onEditorSaved,
    onImportDone,
    onSsoImportDone,
    onConsoleLoginDone,
    refresh,
  }
}
