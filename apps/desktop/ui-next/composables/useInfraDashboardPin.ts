// "Ghim biểu đồ này vào một bảng" — cầu nối giữa tab Giám sát và hộp ghim.
//
// VÌ SAO LÀ MỘT COMPOSABLE RIÊNG. Cú bấm nằm ở tab Giám sát (`MetricChart`), còn hộp thoại
// được host ở `pages/infra.vue` — hai bề mặt không chung một vòng đời, và `app.vue` bọc
// `<NuxtPage keepalive />` nên trang không remount khi quay lại. State để trong `ref` của
// component gọi nó là mất giữa hai lần ghé màn. Cùng khuôn `useInfraTabOpen` (một cầu nối mọc-module nhỏ,
// cũng chỉ để bắc một cú bấm sang một hộp thoại host ở chỗ khác).
//
// VÌ SAO TÁCH KHỎI `useInfraDashboards`. Bên kia là page-controller của một TAB: nó sở hữu
// danh sách, bảng đang mở, cửa sổ thời gian. Đây chỉ là "một biểu đồ đang chờ được ghim".
// Gộp vào là để hộp thoại — thứ chỉ cần một biến — kéo theo cả trạng thái nạp số liệu.
//
// KHÔNG CHỌN HỘ Ở ĐÂY. `pending` là một `DashboardChart` đã dựng xong; việc chọn đích đến
// (bảng có sẵn hay bảng mới) là của hộp thoại, vì chỉ ở đó mới biết người dùng bấm gì.
import { ref } from 'vue'
import type { DashboardChart } from '~/composables/useInfraDashboards'

const open = ref(false)
const pending = ref<DashboardChart | null>(null)

export function useInfraDashboardPin() {
  /**
   * Mở hộp ghim cho một biểu đồ vừa dựng từ spec của màn Giám sát.
   *
   * Trả `false` khi biểu đồ không có chuỗi nào: lược đồ sidecar đòi `min(1)`, nên ghim nó
   * là mở một hộp thoại mà mọi lựa chọn đều dẫn tới một lượt lưu hỏng.
   */
  function requestPin(chart: DashboardChart): boolean {
    if (chart.series.length === 0) return false
    pending.value = chart
    open.value = true
    return true
  }

  function closePin(): void {
    open.value = false
    pending.value = null
  }

  return { open, pending, requestPin, closePin }
}
