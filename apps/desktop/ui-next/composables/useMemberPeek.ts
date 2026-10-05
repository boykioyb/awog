// Đích của click lên một @mention trong message đã render.
//
// SessionMarkdownHtml bọc token `@handle` thành chip `.mdmention`; bấm vào
// cần mở drawer xem phiên đang chạy của member đó — mà drawer (peekId) nằm ở
// WorkspaceBoardEditor, còn chip nằm sâu trong transcript. Bề mặt có roster
// khai provider này; chip gọi nó với handle đã match, resolver tự lo phần còn
// lại (slug → session → mở peek / báo không có phiên sống).
//
// Cùng khuôn `useQuoteSink`: phạm vi là CẤU TRÚC — markdown không cần biết
// mình nằm trong modal board hay transcript thường (không provider ⇒ chip
// chỉ là nhãn, không click được).
import { inject, provide, type InjectionKey } from 'vue'

// handle = token sau '@' đúng nguyên văn trong text (vd 'qa/qc-—-testing-&-automation').
export type MemberPeek = (handle: string) => void

const KEY: InjectionKey<MemberPeek> = Symbol('memberPeek')

export function provideMemberPeek(peek: MemberPeek): void {
  provide(KEY, peek)
}

// Provider của bề mặt gần nhất; null = không ai resolve — mention chỉ là nhãn.
export function useMemberPeek(): MemberPeek | null {
  return inject(KEY, null)
}
