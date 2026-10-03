// Đích của action "trích dẫn" trên một message.
//
// Trong màn session, quote → `store.addQuote` (chip trích dẫn gắn vào phiên đó,
// đi kèm tin gửi tiếp theo). Nhưng transcript còn được nhúng ở bề mặt KHÔNG có
// phiên — thread board render comment dưới dạng message (readonly): quote ở đó
// không được ghi vào phiên trong scope, mà chèn `> excerpt` vào composer của
// thread. Bề mặt đó khai sink này; SessionMessageItem ưu tiên sink khi readonly.
//
// Cùng khuôn `useSessionScope`: phạm vi là CẤU TRÚC — component con không cần
// biết mình đang nằm trong màn session hay trong modal board.
import { inject, provide, type InjectionKey } from 'vue'

export type QuoteSink = (excerpt: string) => void

const KEY: InjectionKey<QuoteSink> = Symbol('quoteSink')

export function provideQuoteSink(sink: QuoteSink): void {
  provide(KEY, sink)
}

// Sink của bề mặt gần nhất; null = dùng đường phiên (store.addQuote) như cũ.
export function useQuoteSink(): QuoteSink | null {
  return inject(KEY, null)
}
