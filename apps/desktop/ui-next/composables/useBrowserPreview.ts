import { shallowReactive } from 'vue'

// Thẻ xem trước trang của `browser_tool` (docs/features/browser-preview-card.md).
//
// Ảnh thu nhỏ + title/url thật do sidecar lưu dưới thư mục session lúc agent mở trang;
// UI lấy lazy qua RPC `sessions.browserPreview`, key theo step id (= tool_use id nên
// còn nguyên sau reload ở pointer-mode — ADR 0097). Cache cấp module vì cùng một thẻ
// bị mount lại mỗi khi transcript virtualise/KeepAlive, mà data URL đắt hơn một lượt
// RPC để kéo lại.

export type BrowserPreview = {
  url: string
  title: string
  tabId: string
  hasThumb: boolean
  // `data:image/jpeg;base64,…` hoặc null (chụp lỗi / file đã bị dọn).
  thumbDataUrl: string | null
}

// Mỗi entry tối đa ~700KB base64 ⇒ cap 40 thẻ giữ RAM dưới ~30MB. Map giữ thứ tự chèn
// nên xoá phần tử đầu = loại cái cũ nhất.
const MAX_CACHED = 40
const cache = shallowReactive(new Map<string, BrowserPreview | null>())
const inflight = new Set<string>()

export function useBrowserPreview() {
  const sc = useSidecar()

  const keyOf = (engineId: string, stepId: string): string => `${engineId}:${stepId}`

  // undefined = chưa hỏi; null = đã hỏi và sidecar không có gì cho step này.
  const previewOf = (engineId: string | undefined, stepId: string | undefined) =>
    engineId && stepId ? cache.get(keyOf(engineId, stepId)) : undefined

  const ensurePreview = async (engineId: string, stepId: string): Promise<void> => {
    if (!sc.available) return
    const key = keyOf(engineId, stepId)
    if (cache.has(key) || inflight.has(key)) return
    inflight.add(key)
    try {
      const res = await sc.request<{ preview: BrowserPreview | null }>('sessions.browserPreview', {
        sessionId: engineId,
        stepId,
      })
      cache.set(key, res.preview)
      if (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
    } catch {
      // Thẻ chỉ là phần trình bày: lỗi RPC thì thẻ vẫn dựng từ input của step, và
      // KHÔNG cache null để lần mount sau còn thử lại.
    } finally {
      inflight.delete(key)
    }
  }

  return { previewOf, ensurePreview }
}
