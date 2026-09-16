// Cây component đang render THUỘC VỀ phiên nào.
//
// Trước chế độ LƯỚI, câu hỏi này không tồn tại: trên màn hình chỉ có một transcript và
// nó luôn là phiên đang mở, nên mọi chỗ cứ đọc `store.active`. Lưới phá đúng giả định
// đó — nhiều transcript sống cùng lúc, mỗi cái một phiên khác nhau. Một `store.active`
// đọc từ trong ô con sẽ trả về phiên CHA: trích dẫn rơi vào composer sai, badge ① và
// highlight vẽ lên nhầm message.
//
// Cùng khuôn với `useTranscriptSurface` (ADR 0075): phạm vi là CẤU TRÚC, không phải
// thời gian. Mỗi bề mặt tự khai phiên của nó; component con hỏi xuống mà không cần biết
// mình đang nằm trong bề mặt nào.
//
// Không có ai khai (SSH co-pilot, bubble infra, …) ⇒ rơi về `store.active` như cũ.

import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'

const KEY: InjectionKey<ComputedRef<number | null>> = Symbol('sessionScope')

// Khai phạm vi. Gọi MỘT LẦN trong setup của component host một transcript
// (hôm nay: SessionDetail, SessionGridPane).
export function provideSessionScope(sessionId: () => number | null): void {
  provide(
    KEY,
    computed(() => sessionId()),
  )
}

export interface SessionScope {
  sessionId: ComputedRef<number | null>
  session: ComputedRef<Session | null>
}

// Phiên của bề mặt gần nhất, hoặc phiên đang mở khi không có bề mặt nào khai.
export function useSessionScope(): SessionScope {
  const store = useSessionsStore()
  const injected = inject(KEY, null)
  const sessionId = computed<number | null>(() => injected?.value ?? store.activeId)
  const session = computed<Session | null>(() => {
    const id = sessionId.value
    if (id == null) return null
    if (id === store.activeId) return store.active ?? null
    return store.sessions.find((s) => s.id === id) ?? null
  })
  return { sessionId, session }
}
