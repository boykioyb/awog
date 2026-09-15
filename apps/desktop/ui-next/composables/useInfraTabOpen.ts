// Cầu nối MỌC MODULE: một bề mặt xin `/infra` mở THẲNG một tab, trang `/infra` tiêu thụ
// yêu cầu đó.
//
// Trước 2026-09-15 đây là `useInfraGraphOpen` — chỉ xin được ĐÚNG tab Topology, vì lúc
// đó chỉ có trang `/playbooks` cần xin. Nay Playbook đã nằm trong chính `/infra` và màn
// Chi phí cũng cần chuyển sang nó sau khi dựng kế hoạch dọn dẹp, nên cầu nối mang theo
// TÊN TAB thay vì một cờ boolean. Một cầu nối có tham số, không phải hai cầu nối gần
// giống nhau.
//
// VÌ SAO KHÔNG DÙNG QUERY PARAM `?tab=graph`: `app.vue` bọc `<NuxtPage keepalive />` nên
// `/infra` KHÔNG remount khi đã từng mở — `onMounted` đọc query sẽ im lặng không chạy ở
// lần vào thứ hai. Cầu nối mọc-module sống ngoài vòng đời component nên `immediate: true`
// phủ ca mount mới còn `watch` phủ ca trang đang sống.
//
// MỘT LẦN DÙNG. `consume()` lấy-và-xoá: một yêu cầu còn treo sau khi đã chuyển tab sẽ
// kéo người dùng về đó lần nữa ở lần ghé sau, và họ không hiểu vì sao.
import { ref } from 'vue'

/**
 * Các màn của `/infra`. Khai Ở ĐÂY chứ không ở `pages/infra.vue` để bên XIN cũng gõ
 * đúng tên — một chuỗi tự do thì `selectTab('playbook')` (thiếu `s`) lặng lẽ không làm gì.
 */
export type InfraTab =
  | 'overview'
  | 'services'
  | 'graph'
  | 'delivery'
  | 'audit'
  | 'logs'
  | 'monitoring'
  | 'dashboards'
  | 'cost'
  | 'playbooks'
  | 'reports'
  | 'kubernetes'
  | 'accounts'

const pending = ref<InfraTab | null>(null)

export function useInfraTabOpen() {
  /** Bên gọi xin trước khi (nếu cần) điều hướng sang `/infra`. */
  function request(tab: InfraTab): void {
    pending.value = tab
  }

  /** Trang gọi để lấy-và-xoá yêu cầu. */
  function consume(): InfraTab | null {
    const was = pending.value
    pending.value = null
    return was
  }

  return { pending, request, consume }
}
