import { ref } from 'vue'

// Cầu nối MỌC MODULE: trang `/playbooks` yêu cầu mở THẲNG tab Topology của `/infra`,
// trang `/infra` tiêu thụ yêu cầu đó. Cùng khuôn với `useInfraServiceOpen` nhưng
// KHÁC lý do thay đổi — bên kia mang một ID DỊCH VỤ để trang tự phân giải, bên này
// chỉ xin một TAB, nên tách module thay vì nhồi thêm khái niệm vào nhau.
//
// Vì sao không dùng query param `?tab=graph`: `app.vue` bọc `<NuxtPage keepalive />`
// nên `/infra` KHÔNG remount khi đã từng mở — `onMounted` đọc query sẽ im lặng không
// chạy ở lần vào thứ hai. Cầu nối mọc-module sống ngoài vòng đời component nên
// `immediate: true` phủ ca mount mới còn `watch` phủ ca trang đang sống.
//
// Playbook gọi khi nó KHÔNG suy được ảnh hưởng lan (graph chưa dựng / không đọc
// được): việc dựng graph là việc của màn Hạ tầng, trang playbook không tự chạy CLI.

const pending = ref(false)

export function useInfraGraphOpen() {
  /** `/playbooks` gọi trước khi navigateTo('/infra'). */
  function request(): void {
    pending.value = true
  }
  /** Trang gọi để lấy-và-xoá yêu cầu (một lần dùng). */
  function consume(): boolean {
    const was = pending.value
    pending.value = false
    return was
  }
  return { pending, request, consume }
}
