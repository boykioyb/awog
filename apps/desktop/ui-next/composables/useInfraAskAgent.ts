import { computed, reactive } from 'vue'
import { useInfraBubble } from '~/composables/useInfraBubble'
import { useSessionsStore } from '~/stores/sessions'

// "Hỏi agent" — một luật, ba màn dùng chung (Logs, Tổng quan, Explorer, Nhật ký).
//
// YÊU CẦU NGƯỜI DÙNG: "các phần hỏi agent đều có option là cho vào session hiện tại
// hay mở session mới". Vì vậy `askAgent()` KHÔNG còn gửi thẳng vào draft nữa — nó
// MỞ MỘT LỰA CHỌN, và việc gửi nằm ở `deliver()`.
//
// VÌ SAO LỰA CHỌN NẰM Ở MỘT HOST DÙNG CHUNG chứ không ở từng màn: bốn màn đều cần
// đúng hai lựa chọn đó với đúng hai kết cục. Bốn bản sao của hộp chọn là bốn chỗ để
// "phiên mới" hiểu khác nhau về việc nó nên rơi vào project nào.
//
// HAI ĐÍCH ĐẾN, HAI NGỮ NGHĨA KHÁC NHAU:
//   · `current` — nối THÊM vào draft của phiên đang mở (không ghi đè: người dùng
//     thường gõ câu hỏi trước rồi mới đính ngữ cảnh vào — khuôn
//     `useBrowserContext.insertBlock`).
//   · `new` — tạo một phiên trong project `awog-infra` (thư mục riêng của họ hạ
//     tầng, xem `useInfraBubble`) rồi ghim nội dung vào ô soạn tin của nó. KHÔNG
//     tự gửi: câu hỏi về một dòng log thường cần người dùng viết thêm.
//
// KHÔNG BAO GIỜ MẤT NỘI DUNG. Không có phiên nào đang mở mà người dùng chọn
// "phiên hiện tại" thì rơi về clipboard VÀ nói rõ vì sao — im lặng làm mất thứ họ
// vừa yêu cầu gửi là kiểu hỏng tệ nhất của một nút "gửi".
//
// An toàn: nội dung log đã qua `redactString()` của `runInfra` TRƯỚC khi rời
// sidecar, nên chỗ này chỉ NỐI chứ không lọc lại — hai lớp lọc khác nhau là hai
// định nghĩa khác nhau về "bí mật" (invariant #1).

/** Trạng thái hộp chọn, đặt ở module để host toàn cục và call site nhìn cùng một cái. */
const chooser = reactive({
  open: false,
  text: '',
  /** Nhãn nguồn ("một dòng log", "EC2 Instances"…) để hộp chọn nói rõ đang gửi gì. */
  source: '',
})

export type InfraAskTarget = 'current' | 'new'

export function useInfraAskAgent() {
  const { t } = useI18n()
  const toast = useToast()
  const sessions = useSessionsStore()
  const bubble = useInfraBubble()

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      toast.add({ title: t('infra.ask.copyFailed'), color: 'error' })
      return false
    }
  }

  function appendToDraft(id: number, text: string): void {
    const current = sessions.sessions.find((s) => s.id === id)?.draft ?? ''
    const next = current.trim() ? `${current.replace(/\s+$/, '')}\n\n${text}\n` : `${text}\n`
    sessions.setDraft(id, next)
    sessions.seedComposer(next)
  }

  /**
   * Mở hộp chọn "phiên hiện tại hay phiên mới". Mọi màn gọi cái này — không màn nào
   * tự gửi thẳng, vì tự gửi thẳng là bỏ mất lựa chọn mà người dùng đã yêu cầu.
   */
  async function askAgent(text: string, source = ''): Promise<void> {
    if (!text.trim()) return
    chooser.text = text
    chooser.source = source
    chooser.open = true
  }

  function closeChooser(): void {
    chooser.open = false
    chooser.text = ''
    chooser.source = ''
  }

  /** Kết cục của hộp chọn. Trả `true` khi nội dung đã tới được một chỗ nào đó. */
  async function deliver(text: string, target: InfraAskTarget): Promise<boolean> {
    closeChooser()
    if (target === 'new') {
      const ok = await bubble.seedIntoNewSession(text)
      if (!ok) {
        // Tạo phiên không được (quota chặn, không có sidecar) ⇒ vẫn phải giữ nội
        // dung. `useInfraBubble` đã toast lý do; ở đây chép vào clipboard.
        if (await copyText(text)) {
          toast.add({ title: t('infra.ask.copiedInstead'), color: 'warning' })
        }
        return false
      }
      toast.add({ title: t('infra.ask.doneNew'), color: 'success' })
      return true
    }

    const id = sessions.activeId
    if (id == null) {
      if (await copyText(text)) toast.add({ title: t('infra.ask.noSession'), color: 'warning' })
      return false
    }
    appendToDraft(id, text)
    toast.add({ title: t('infra.ask.done'), color: 'success' })
    return true
  }

  return {
    askAgent,
    deliver,
    closeChooser,
    copyText,
    /** Đọc trong component host. */
    chooser,
    hasActiveSession: computed(() => sessions.activeId != null),
  }
}
