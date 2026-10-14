// Chỉ báo + nút mở của Network Capture trên thanh điều hướng trình duyệt
// (docs/features/network-capture.md). Chỉ giữ CaptureState (cờ ghi + số request) của
// tab đang xem — dữ liệu request nằm ở main và cửa sổ inspector, không đi qua đây.
import { onBeforeUnmount, ref, watch } from 'vue'
import type { CaptureState } from '~/types/network-capture'

const COUNT_REFRESH_MS = 400

export function useCaptureIndicator(tabId: () => string | null, scope: () => string | undefined) {
  const state = ref<CaptureState | null>(null)
  const api = () => window.awog?.browser?.capture ?? null

  async function refresh(): Promise<void> {
    const id = tabId()
    const a = api()
    if (!id || !a) {
      state.value = null
      return
    }
    try {
      const s = await a.state(id, scope())
      if (tabId() === id) state.value = s
    } catch {
      state.value = null // tab đã đóng giữa chừng
    }
  }

  // Upsert không mang số đếm → hỏi lại state, gộp theo nhịp để một trang tải hàng trăm
  // request không bắn hàng trăm IPC.
  let timer: number | undefined
  const unsubscribe = api()?.onEvent((ev) => {
    if (ev.tabId !== tabId()) return
    if (ev.kind === 'state') {
      state.value = ev.state
      return
    }
    if (state.value?.recording === false && ev.kind === 'upsert') return
    clearTimeout(timer)
    timer = window.setTimeout(() => void refresh(), COUNT_REFRESH_MS)
  })
  onBeforeUnmount(() => {
    unsubscribe?.()
    clearTimeout(timer)
  })

  watch(tabId, () => void refresh(), { immediate: true })

  /** Bấm nút: bật ghi nếu đang tắt, rồi mở (hoặc focus) cửa sổ inspector của tab. */
  async function openInspector(): Promise<void> {
    const id = tabId()
    const a = api()
    if (!id || !a) return
    if (!state.value?.recording) state.value = await a.start(id, scope())
    await a.openWindow(id, scope())
  }

  return { state, openInspector }
}
