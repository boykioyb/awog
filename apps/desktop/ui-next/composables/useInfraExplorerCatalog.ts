// Danh mục + GHIM của Explorer — state ở MỌC MODULE, không nằm trong component.
//
// VÌ SAO. Danh mục Dịch vụ (task 3.8) và màn Explorer (task 3.1–3.7) là hai tab
// của cùng một trang, và chúng chia nhau đúng một thứ: danh sách dịch vụ ĐÃ GHIM.
// Nếu mỗi tab tự gọi `useInfraExplorer()`, mỗi bên có một `pinnedServices` riêng —
// ghim ở tab Dịch vụ thì sidebar của Explorer không đổi, và người dùng phải bấm
// hai lần cho một hành động. Một nguồn sự thật, hai chỗ đọc.
//
// Danh mục là hằng số serialize từ sidecar (không chạm CLI), nên nạp một lần cho
// cả phiên là đủ và rẻ.
import { computed, ref } from 'vue'
import { useInfraContext } from '~/composables/useInfraContext'
import { useInfraResourcesApi } from '~/composables/useInfraResourcesApi'
import { infraCatalogFallback } from '~/composables/infraCatalogFallback'
import { useSidecar } from '~/composables/useSidecar'
import type { InfraExplorerCatalog, InfraViewDescriptor } from '~/composables/useInfraResourcesApi'

const PIN_KEY = 'awog-infra-pins'

const catalog = ref<InfraExplorerCatalog | null>(null)
const catalogLoading = ref(false)
/**
 * VÌ SAO danh mục trống — không phải "trống vì không có gì".
 *
 * Ba trạng thái phải phân biệt được: đang đọc / không đọc được / đọc rồi nhưng
 * không khớp. `'offline'` (không có engine) nay KHÔNG còn để màn hình trống: nó
 * dùng danh mục mẫu ở `infraCatalogFallback` và bật cờ `mock` để UI nói rõ. Chỉ
 * `'failed'` (có engine mà lời gọi hỏng) mới là lỗi thật, và chỉ nó mới có nút
 * "Thử lại" — gọi lại không sinh ra được cầu nối vốn không tồn tại.
 */
const catalogError = ref<'offline' | 'failed' | null>(null)
/** Danh mục đang xem là bản MẪU, không phải tài khoản thật của người dùng. */
const catalogMock = ref(false)
const pinned = ref<string[]>(readPins() ?? [])

function readPins(): string[] | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(PIN_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

export function useInfraExplorerCatalog() {
  const api = useInfraResourcesApi()
  const sidecar = useSidecar()
  const infraContext = useInfraContext({ sessionId: null })

  const views = computed<InfraViewDescriptor[]>(() => catalog.value?.views ?? [])
  const services = computed(() => catalog.value?.services ?? [])
  const groups = computed(() => catalog.value?.groups ?? [])
  const pinnedServices = computed(() => pinned.value)

  /** View được ghim lên sidebar: mọi dịch vụ đang ghim mà có view, theo thứ tự ghim. */
  const sidebarViews = computed<InfraViewDescriptor[]>(() => {
    const byService = new Map<string, InfraViewDescriptor[]>()
    for (const v of views.value) {
      const list = byService.get(v.service) ?? []
      list.push(v)
      byService.set(v.service, list)
    }
    const out: InfraViewDescriptor[] = []
    for (const svc of pinned.value) for (const v of byService.get(svc) ?? []) out.push(v)
    return out
  })

  function togglePin(serviceId: string): void {
    const next = pinned.value.includes(serviceId)
      ? pinned.value.filter((s) => s !== serviceId)
      : [...pinned.value, serviceId]
    pinned.value = next
    if (typeof localStorage !== 'undefined') localStorage.setItem(PIN_KEY, JSON.stringify(next))
  }

  /**
   * Nạp danh mục MẪU (xem `infraCatalogFallback`) — chỉ dùng khi không có engine.
   * Ghim thì để nguyên như người dùng đã chọn: một bản mẫu không được phép ghi đè
   * lựa chọn thật của họ.
   */
  function applyFallback(): void {
    const res = infraCatalogFallback(infraContext.effective.value.region ?? '')
    catalog.value = res
    catalogMock.value = true
    if (!pinned.value.length) {
      pinned.value = res.defaultPinned
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PIN_KEY, JSON.stringify(pinned.value))
      }
    }
  }

  /** Nạp danh mục một lần. Không chạm CLI — chỉ serialize hằng số ở sidecar. */
  async function ensureCatalog(force = false): Promise<void> {
    if (!force && (catalog.value || catalogLoading.value)) return
    // Chưa nối được engine (mở web bằng trình duyệt thường): không có gì để gọi,
    // nhưng KHÔNG để màn hình trống — dùng danh mục mẫu để còn nhìn/review được
    // giao diện, và bật cờ `mock` để màn Dịch vụ nói rõ đây không phải tài khoản
    // thật. Lý do vẫn được ghi lại (`'offline'`) để chỗ khác đọc được.
    if (!sidecar.available) {
      applyFallback()
      catalogError.value = 'offline'
      return
    }
    catalogLoading.value = true
    catalogError.value = null
    try {
      const region = infraContext.effective.value.region ?? ''
      const res = await api.catalog(region)
      catalog.value = res
      catalogMock.value = false
      if (!pinned.value.length) {
        pinned.value = res.defaultPinned
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(PIN_KEY, JSON.stringify(pinned.value))
        }
      }
    } catch (err) {
      catalogError.value = 'failed'
      console.error('[infra] explorer catalog failed', err)
    } finally {
      catalogLoading.value = false
    }
  }

  /** Nút "Thử lại" của màn Dịch vụ: bỏ qua bộ nhớ đệm một lần. */
  function retryCatalog(): Promise<void> {
    return ensureCatalog(true)
  }

  return {
    catalog,
    catalogLoading,
    catalogError,
    catalogMock,
    views,
    services,
    groups,
    pinnedServices,
    sidebarViews,
    togglePin,
    ensureCatalog,
    retryCatalog,
  }
}
