import { register } from '../transport/rpc.js'
import { listSchedules } from '../schedules/store.js'

// Lịch đã lưu (`~/.awog/schedules/*.json`), đã validate. File hỏng bị bỏ qua ở
// tầng store kèm log — danh sách không bao giờ chết vì một file lỗi.
//
// Lời hẹn agent tự đặt (`session-wakeup`, gói #14) KHÔNG nằm trong danh sách này.
// Nó không phải lịch của người dùng: sống vài phút rồi tự xoá, không có gì để bật
// /tắt hay "chạy ngay", và biểu thức `once` của nó không nằm trong ba dạng mà
// trang Lịch chạy biết diễn đạt. Người dùng huỷ nó bằng cách nhắn tiếp vào phiên
// (schedules/wakeup.ts tự dọn), không phải bằng một hàng trong bảng này.
// Lọc theo CẢ HAI trục — `job` lẫn `trigger` — chứ không chỉ một: một file bị sửa
// tay có thể lệch cặp, mà trang Lịch chạy diễn đạt `trigger` bằng một switch chỉ
// biết ba dạng lặp. Lọt một biểu thức `once` vào đó là làm hỏng cả trang chỉ vì
// một file lạ.
register('schedules.list', async () => ({
  schedules: (await listSchedules()).filter(
    (s) => s.job.kind !== 'session-wakeup' && s.trigger.kind !== 'once',
  ),
}))
