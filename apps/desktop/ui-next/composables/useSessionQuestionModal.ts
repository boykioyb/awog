// Trạng thái "đã đóng popup câu hỏi" — dùng chung giữa hộp thoại
// (SessionQuestionModal) và byline của lượt (SessionMessageItem), nên nút "Trả lời"
// mở lại đúng câu vừa đóng.
//
// Singleton ở tầng module (một cửa sổ = một bộ): danh sách này là trạng thái xem, cố
// tình KHÔNG persist — mở lại app thì câu hỏi còn park sẽ nổi popup trở lại, đúng thứ
// người dùng cần thấy.
import { ref } from 'vue'

const dismissed = ref<string[]>([])

export function useSessionQuestionModal() {
  // eid rỗng/không có ⇒ coi như chưa đóng: thà hiện popup còn hơn nuốt mất câu hỏi.
  const isDismissed = (eid?: string): boolean => !!eid && dismissed.value.includes(eid)
  const dismiss = (eid?: string): void => {
    if (eid && !dismissed.value.includes(eid)) dismissed.value.push(eid)
  }
  const reopen = (eid?: string): void => {
    if (!eid) return
    const i = dismissed.value.indexOf(eid)
    if (i !== -1) dismissed.value.splice(i, 1)
  }
  return { isDismissed, dismiss, reopen }
}
