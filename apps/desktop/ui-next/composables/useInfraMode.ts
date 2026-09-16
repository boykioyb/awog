// Đơn giản / Chuyên sâu — MỘT công tắc cho cả khu `/infra`.
//
// Trước 2026-09-16 có hai công tắc rời, trên hai màn, với hai cái tên và hai
// khoá localStorage:
//   · Kế hoạch — `awog.playbooks.mode`, 'simple' | 'expert' (mở sẵn khối kỹ thuật
//     của từng bước);
//   · Explorer — `awog-infra-columns`, 'simple' | 'full' (bộ cột của bảng).
// Hai thứ đó là cùng MỘT câu hỏi của người dùng — "cho tôi xem phần kỹ thuật hay
// giấu nó đi" — nên bắt họ trả lời hai lần, ở hai chỗ, là ba cái dở cùng lúc: đặt
// ở chỗ nào cũng khó tìm, mười một màn còn lại không có gì, và hai câu trả lời
// mâu thuẫn được với nhau.
//
// Nay: một ref cấp module, một khoá, một control trên thanh đầu `/infra` nên nó
// nhìn thấy được ở mọi tab.
//
// CHUYỂN GIÁ TRỊ CŨ, không bỏ. Ai đã chọn "Chuyên sâu" ở màn Kế hoạch thì lần mở
// sau vẫn phải thấy Chuyên sâu — im lặng đặt lại về mặc định là một lựa chọn của
// người dùng bị nuốt mất.
import { computed, ref } from 'vue'

/**
 * LUẬT CỦA CÔNG TẮC, khai ở đây để màn sau còn theo:
 *
 *   Đơn giản  = dạng ĐỌC ĐƯỢC   — đủ để hiểu và quyết định.
 *   Chuyên sâu = dạng CHÍNH XÁC — copy dán thẳng vào terminal được.
 *
 * Nó KHÔNG phải "ẩn bớt cho đỡ rối": mỗi chỗ nó chạm đều hiện CÙNG MỘT sự thật ở
 * hai độ phân giải. Vì thế Đơn giản không bao giờ giấu thông tin an toàn (giá
 * tiền, cảnh báo, lớp lệnh) — thứ nó rút gọn là định danh máy: argv đầy đủ, ARN,
 * cột id, khối kỹ thuật của từng bước.
 *
 * Màn nào KHÔNG có thứ như thế thì công tắc không hiện trên thanh đầu — một
 * control bấm mà không đổi gì là lời hứa suông (người dùng nói thẳng 2026-09-16:
 * "không thấy sự khác biệt ở đâu trong khi nó lại nằm ở global page").
 */
// Tên là `InfraDetailMode` chứ không phải `InfraMode`: `InfraMode` đã là chế độ
// của ma trận quyền ('auto' | 'ask' | 'block', mirror sidecar, ở `~/types`). Hai
// kiểu khác nghĩa mà cùng tên thì auto-import của Nuxt chỉ giữ một — nơi gọi viết
// `InfraMode` tưởng đang nói độ chi tiết lại nhận đúng kiểu kia, và TypeScript
// không kêu vì cả hai đều là union chuỗi.
export type InfraDetailMode = 'simple' | 'expert'

const KEY = 'awog.infra.mode'
/** Khoá của công tắc riêng màn Kế hoạch, chỉ còn dùng để đọc một lần rồi xoá. */
const LEGACY_PLAYBOOK_KEY = 'awog.playbooks.mode'

const mode = ref<InfraDetailMode>('simple')
let loaded = false

function load(): void {
  if (loaded) return
  loaded = true
  if (typeof localStorage === 'undefined') return
  const saved = localStorage.getItem(KEY)
  if (saved === 'simple' || saved === 'expert') {
    mode.value = saved
    return
  }
  const legacy = localStorage.getItem(LEGACY_PLAYBOOK_KEY)
  if (legacy === 'simple' || legacy === 'expert') {
    mode.value = legacy
    localStorage.setItem(KEY, legacy)
  }
  // Xoá kể cả khi không đọc được gì: để lại một khoá chết thì lần sau đọc lại nó
  // và có thể ghi đè một lựa chọn mới hơn.
  localStorage.removeItem(LEGACY_PLAYBOOK_KEY)
}

export function useInfraMode() {
  load()

  function setMode(next: InfraDetailMode): void {
    mode.value = next
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, next)
  }

  /** `true` khi người dùng muốn thấy phần kỹ thuật — đọc ở template cho gọn. */
  const isExpert = computed(() => mode.value === 'expert')

  return { mode, isExpert, setMode }
}
