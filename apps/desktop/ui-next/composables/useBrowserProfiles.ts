import { computed, onScopeDispose, ref, watch } from 'vue'
import type { BrowserProfile, BrowserProfilesList, BrowserProxyType } from '~/types'
import { SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

// Hồ sơ trình duyệt nhúng (ADR 0101, docs/features/browser-profiles-bookmarks.md).
//
// Mỗi hồ sơ = một partition Chromium riêng (cookie/login) + bộ bookmark riêng.
// Sidecar SỞ HỮU danh sách (`~/.awog/browser/profiles.json`); đây chỉ là bản chiếu
// phía UI, state cấp module để Settings, menu ⋮ và thanh bookmark nhìn cùng một
// sự thật. Event `browser.profiles-changed` kéo nó về đồng bộ.
//
// "Hồ sơ hiệu lực của một scope" thì KHÔNG tự tính ở renderer: luật ưu tiên
// (phiên → project → mặc định) chạy ở sidecar, main cache kết quả, và renderer chỉ
// hỏi `browser.profileOf(scope)` — nên một luật, một nơi.

export const DEFAULT_PROFILE_ID = 'default'

// Bảng màu cố định cho chấm hồ sơ. Là DỮ LIỆU của người dùng (lưu cùng hồ sơ), không
// phải màu theme, nên không đi qua useTheme(): đổi theme không được làm hồ sơ
// "Công việc" đổi màu.
export const PROFILE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#64748b',
] as const

const profiles = ref<BrowserProfile[]>([])
const defaultProfileId = ref<string>(DEFAULT_PROFILE_ID)
const loaded = ref(false)
// Tăng mỗi lần danh sách/mặc định đổi — watcher ngoài dùng để hỏi lại profileOf.
const version = ref(0)

let loadingPromise: Promise<void> | null = null
let unlisten: (() => void) | null = null

const fetchList = async (): Promise<void> => {
  const res = await useSidecar().request<BrowserProfilesList>('browserProfiles.list')
  profiles.value = res.profiles
  defaultProfileId.value = res.defaultProfileId
  loaded.value = true
  version.value++
}

const subscribe = async (): Promise<void> => {
  if (unlisten) return
  try {
    unlisten = await useSidecar().onEvent((evt) => {
      if (evt?.type === 'browser.profiles-changed') void fetchList().catch(() => {})
      // Override của một phiên đổi (kể cả từ cửa sổ khác) → mọi useScopeProfile hỏi lại.
      else if (evt?.type === 'session.browser-profile') version.value++
    })
  } catch {
    // Không có engine (browser-dev) — không có gì để nghe.
  }
}

const load = (force = false): Promise<void> => {
  if (loaded.value && !force) return Promise.resolve()
  if (!loadingPromise || force) {
    loadingPromise = fetchList()
      .catch((err: unknown) => {
        // Không engine thì danh sách rỗng là đúng; lỗi thật để caller thấy ở lần gọi sau.
        if (!(err instanceof SidecarUnavailableError)) console.warn('[browser] profiles load', err)
      })
      .finally(() => {
        loadingPromise = null
      })
  }
  void subscribe()
  return loadingPromise
}

export function useBrowserProfiles() {
  const sc = useSidecar()
  void load()

  const byId = (id: string | undefined | null): BrowserProfile | undefined =>
    profiles.value.find((p) => p.id === id)

  // Hồ sơ không tồn tại (đã xoá trong lúc tab còn giữ id cũ) rơi về mặc định thay vì
  // hiện ô trống.
  const resolve = (id: string | undefined | null): BrowserProfile | undefined =>
    byId(id) ?? byId(defaultProfileId.value) ?? profiles.value[0]

  const defaultProfile = computed(() => resolve(defaultProfileId.value))

  const create = async (name: string, color?: string): Promise<BrowserProfile> => {
    const p = await sc.request<BrowserProfile>('browserProfiles.create', {
      name,
      ...(color ? { color } : {}),
    })
    await load(true)
    return p
  }

  const update = async (id: string, patch: { name?: string; color?: string }): Promise<void> => {
    await sc.request('browserProfiles.update', { id, ...patch })
    await load(true)
  }

  // Xoá hồ sơ XOÁ LUÔN partition (login + cookie) và bookmark của nó — caller phải
  // confirm trước. Sidecar tự dọn tham chiếu ở phiên/project.
  const remove = async (id: string): Promise<void> => {
    await sc.request('browserProfiles.delete', { id })
    await load(true)
  }

  // Đặt/gỡ proxy của hồ sơ (ADR 0103). `auth`: vắng = giữ creds cũ, null = xoá,
  // object = ghi mới (đi thẳng tới keychain ở sidecar, KHÔNG bao giờ quay lại renderer).
  const setProxy = async (
    id: string,
    proxy: { type: BrowserProxyType; host: string; port: number; bypass?: string } | null,
    auth?: { username: string; password: string } | null,
  ): Promise<void> => {
    await sc.request('browserProfiles.setProxy', {
      id,
      proxy,
      ...(auth !== undefined ? { auth } : {}),
    })
    await load(true)
  }

  const setDefault = async (id: string): Promise<void> => {
    await sc.request('browserProfiles.setDefault', { id })
    await load(true)
  }

  // Đặt (hoặc gỡ, null) override hồ sơ của MỘT phiên. Main đóng + mở lại tab của phiên
  // đó ở partition mới khi sidecar đẩy scope→profile xuống.
  const setSessionProfile = async (sessionId: string, profileId: string | null): Promise<void> => {
    await sc.request('sessions.setBrowserProfile', { sessionId, profileId })
    version.value++
  }

  return {
    profiles,
    defaultProfileId,
    defaultProfile,
    loaded,
    version,
    byId,
    resolve,
    reload: () => load(true),
    create,
    update,
    remove,
    setProxy,
    setDefault,
    setSessionProfile,
  }
}

// Hồ sơ hiệu lực của một scope, tự cập nhật. `tabProfile` là gợi ý tức thì từ tab đang
// xem (main gửi kèm `profileId`) để khỏi nháy giá trị mặc định trong lúc đợi IPC;
// `browser.profileOf` mới là câu trả lời cuối — nó là thứ duy nhất đúng khi scope chưa
// có tab nào (tab mới sẽ mở ở hồ sơ nào?).
export function useScopeProfile(
  scope: () => string | undefined,
  tabProfile: () => string | undefined,
) {
  const { version: v, defaultProfileId: def } = useBrowserProfiles()
  const profileId = ref<string>(tabProfile() ?? def.value)
  let seq = 0

  const refresh = async (): Promise<void> => {
    const hint = tabProfile()
    if (hint) profileId.value = hint
    const api = typeof window === 'undefined' ? null : (window.awog?.browser ?? null)
    if (!api) return
    const mine = ++seq
    try {
      const res = await api.profileOf(scope())
      if (mine === seq) profileId.value = res.profileId
    } catch {
      // main chưa biết scope — giữ gợi ý/mặc định.
    }
  }

  watch([scope, tabProfile, v], () => void refresh(), { immediate: true })
  onScopeDispose(() => {
    seq++
  })

  return { profileId, refresh }
}
