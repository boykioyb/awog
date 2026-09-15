import { ref } from 'vue'

// CẦU NỐI HAI CHIỀU: khoảng thời gian của màn Giám sát ↔ màn Logs (Mốc 6, 6.3).
//
// Hai màn trả lời hai câu khác nhau — "bao nhiêu" và "chuyện gì đã xảy ra" — nhưng
// CÙNG một trục thời gian. Kéo chọn một khoảng trên biểu đồ số liệu rồi mở Logs thì
// phải đã lọc sẵn đúng khoảng đó, và ngược lại. Không có cầu nối thì người dùng tự
// gõ lại hai mốc thời gian bằng tay, và hai màn nói về hai khoảng khác nhau.
//
// VÌ SAO MODULE-SCOPED REF: `app.vue` bọc `<NuxtPage keepalive />` nên trang
// `/infra` KHÔNG remount khi quay lại, và hai màn này là hai TAB của cùng một trang —
// không tab nào bị unmount. Một biến sống trong component sẽ chết cùng lần chuyển
// tab, còn đọc query-param trong `onMounted` thì lần vào thứ hai im lặng không chạy.
// Khuôn này giống `useInfraGraphOpen` / `useInfraServiceOpen`, KHÁC lý do thay đổi:
// bên kia xin một TAB, bên này mang một KHOẢNG THỜI GIAN.
//
// VÌ SAO CÓ `nonce`: kéo đúng cùng một khoảng hai lần là chuyện thường (mắt đọc
// chưa ra, tay kéo lại y hệt). Nếu bên nhận chỉ so `{startMs, endMs}` thì lần thứ
// hai bị coi là "không đổi" và nút im lặng không có tác dụng. `nonce` tăng mỗi lần
// gieo, nên MỌI lần gieo đều là một sự kiện mới — cùng lý do `LogsSeed` của
// `useInfraLogs.ts` có trường này.
//
// MỘT LẦN DÙNG: `consumeWindow()` đọc rồi xoá. Để lại thì lần vào tab sau sẽ áp lại
// một khoảng cũ mà người dùng không hề yêu cầu.
//
// ⚠ ĐẦU BÊN LOGS CHƯA ĐƯỢC NỐI (file `components/infra/logs/InfraLogs.vue` thuộc
// workstream khác — xem ghi chú cuối file để có đúng đoạn cần dán).

/** Một lần gieo khoảng thời gian sang màn kia. */
export type WindowSeed = {
  startMs: number
  endMs: number
  /** Tăng mỗi lần gieo — thứ khiến hai lần gieo TRÙNG NHAU vẫn được áp. */
  nonce: number
  /** Câu mô tả ngắn hiện ở màn nhận ("từ sự cố HighCPU"). `null` = không nói gì. */
  note: string | null
}

/** Hai màn nhận được gieo. `logs` = tab Nhật ký, `monitoring` = tab Giám sát. */
export type WindowTarget = 'logs' | 'monitoring'

const pendingLogs = ref<WindowSeed | null>(null)
const pendingMonitoring = ref<WindowSeed | null>(null)

let nonce = 0

export function useInfraWindowSync() {
  /**
   * Gieo một khoảng sang `target`.
   *
   * `endMs <= startMs` bị BỎ QUA: một khoảng rỗng làm màn nhận hoặc hỏi AWS một cửa
   * sổ vô nghĩa, hoặc nhảy về mặc định — cả hai đều là "nút bấm không có tác dụng",
   * mà im lặng bỏ qua còn tệ hơn. Người gọi ở đây là một cú kéo chuột đã hợp lệ.
   */
  function pushWindow(
    target: WindowTarget,
    startMs: number,
    endMs: number,
    note?: string,
  ): boolean {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return false
    nonce += 1
    const seed: WindowSeed = {
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      nonce,
      note: note?.trim() ? note.trim() : null,
    }
    if (target === 'logs') pendingLogs.value = seed
    else pendingMonitoring.value = seed
    return true
  }

  /** Đọc-và-xoá. Trả `null` khi không có gì đang chờ. */
  function consumeWindow(target: WindowTarget): WindowSeed | null {
    const ref_ = target === 'logs' ? pendingLogs : pendingMonitoring
    const got = ref_.value
    ref_.value = null
    return got
  }

  return { pendingLogs, pendingMonitoring, pushWindow, consumeWindow }
}

// ─────────────────────────────────────────────────────────────────────────────
// CÒN LẠI MỘT ĐOẠN ĐỂ CẦU NỐI KÍN — việc của người điều phối (file ngoài WS-A).
//
// (1) `components/infra/logs/InfraLogs.vue` — đọc khoảng được gieo sang. Thêm vào
//     `<script setup>` (cạnh `watch(() => props.seed, …)` đã có):
//
//       import { useInfraWindowSync } from '~/composables/useInfraWindowSync'
//       const { pendingLogs } = useInfraWindowSync()
//       watch(
//         pendingLogs,
//         (seed) => {
//           if (!seed) return
//           // `nonce` là thứ khiến lần kéo LẶP LẠI cùng khoảng vẫn được áp.
//           zoomToWindow(seed.startMs, seed.endMs)
//           pendingLogs.value = null
//         },
//         { immediate: true },
//       )
//
//     (`zoomToWindow` đã có sẵn ở `useInfraLogs.ts:485` — nó đặt preset `custom` rồi
//     điền hai ô thời gian; KHÔNG tự chạy truy vấn, đúng luật "không tốn tiền sau
//     lưng người dùng".)
//
// (2) `pages/infra.vue` — khi có ai gieo sang tab Logs thì phải CHUYỂN sang tab đó,
//     nếu không khoảng được áp vào một màn người dùng không nhìn thấy:
//
//       watch(pendingLogs, (s) => { if (s) tab.value = 'logs' })
//
//     Chiều ngược lại (Logs → Giám sát) thì KHÔNG cần gì ở trang: màn Giám sát tự
//     đọc `pendingMonitoring` khi mount và khi nó đổi (xem `useInfraMetrics`).
// ─────────────────────────────────────────────────────────────────────────────
