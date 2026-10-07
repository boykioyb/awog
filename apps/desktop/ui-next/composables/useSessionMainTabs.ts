// Main tab strip của Session (session-main-tabs): "Trao đổi" (discuss) + mỗi
// trang web là MỘT tab ngang hàng — mô hình flat kiểu trình duyệt/Orca, thay
// cho việc mọi link phải mở view Browser trong dock.
//
// State nằm ở CẤP MODULE vì hai chỗ cần chạm tới nó không cùng cây component:
// `useLinkOpen` (interceptor click <a> cấp document) muốn "mở trong app" =
// sinh tab browser rồi PIN nó lên strip của session đang xem; `SessionDetail`
// là nơi render strip + giữ con trỏ. Khoá là scope của phiên (engineId) — giá
// trị 'discuss' hoặc một browser tabId thật.
//
// QUAN HỆ VỚI `activeByScope` CỦA MAIN: đây là con trỏ CỦA NGƯỜI DÙNG trên
// strip, không phải con trỏ của agent. Agent `browser_tool` tạo/chuyển tab chỉ
// làm tab MỚI XUẤT HIỆN trên strip (kèm spinner/dot activity) — KHÔNG được đổi
// `activeTabs` (giật focus là đúng cái phiền mà auto-PiP từng gây). Chiều ngược
// lại thì có: người dùng pin một tab ⇒ `useEmbeddedBrowser` (pinned mode)
// attach nó, và `attachTo` ở main tự `activate()` — agent lượt sau làm việc
// trên đúng tab người dùng đang nhìn.

import { reactive } from 'vue'

// scope → main tab đang active. Vắng mặt = 'discuss' (mặc định mở session là
// mở trao đổi — chưa ai bấm link nào).
const activeTabs = reactive(new Map<string, string>())

export const DISCUSS_TAB = 'discuss'

export function useSessionMainTabs() {
  const mainTabOf = (scope: string | undefined): string =>
    activeTabs.get(scope ?? '') ?? DISCUSS_TAB

  const setMainTab = (scope: string | undefined, tabId: string): void => {
    if (tabId === DISCUSS_TAB) activeTabs.delete(scope ?? '')
    else activeTabs.set(scope ?? '', tabId)
  }

  // Đường "mở link trong app": tạo tab browser trong scope của phiên ĐANG XEM
  // rồi pin nó — focus tức thì, đúng quyết định "click link → tab mới bên cạnh
  // trao đổi". `wait:false` vì người dùng cần thấy strip đổi ngay, trang tải sau
  // (spinner trên tab + navbar trong pane lo phần còn lại).
  const openBrowserTab = async (scope: string | undefined, url: string): Promise<string> => {
    const api = window.awog?.browser
    if (!api) throw new Error('embedded browser unavailable')
    const created = await api.newTab(url, { wait: false, scope })
    setMainTab(scope, created.tabId)
    return created.tabId
  }

  return { activeTabs, mainTabOf, setMainTab, openBrowserTab, DISCUSS_TAB }
}
