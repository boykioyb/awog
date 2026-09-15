import { ref } from 'vue'

// Cầu nối MỌC MODULE: ⌘K palette yêu cầu mở một dịch vụ AWS, trang `/infra` tiêu
// thụ yêu cầu đó. Tách khỏi `useInfraExplorerCatalog` (danh mục + ghim) để mỗi
// module có một lý do thay đổi — bridge này chỉ giữ MỘT id dịch vụ; trang tự phân
// giải id đó theo danh mục nó đã sở hữu và dùng lại chính luồng mở của nó
// (`onServiceTarget`). Palette không được biết cách một cột trong /infra được mở.
//
// Vì sao chỉ dùng cho dịch vụ mức `view`/`tab` (mở trong app): dịch vụ mức
// `console` là liên kết ngoài, palette tự mở bằng `useLinkOpen` — không cần điều
// hướng qua /infra cho một URL trình duyệt.

const pending = ref<string | null>(null)

export function useInfraServiceOpen() {
  /** Palette gọi trước khi navigateTo('/infra'). */
  function request(serviceId: string): void {
    pending.value = serviceId
  }
  /** Trang gọi để lấy-và-xoá yêu cầu (một lần dùng). */
  function consume(): string | null {
    const id = pending.value
    pending.value = null
    return id
  }
  return { pending, request, consume }
}
