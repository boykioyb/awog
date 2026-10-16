// Luật `window.open` của trình duyệt nhúng — thuần, có test (browser-popup.test.ts).
// Nơi dùng: BrowserController.openHandler (browser.ts).
//
//   'popup' — cửa sổ popup thật, giữ `window.opener`: window.open có features
//             (width/height/popup ⇒ disposition 'new-window') hoặc mở about:blank để
//             ghi rồi mới điều hướng. Đây là hình của popup đăng nhập OAuth/SSO/thanh
//             toán — biến nó thành tab là mất opener, đăng nhập xong không quay về.
//   'tab'   — link `target=_blank`, window.open không features: mở tab như trước.
// Luật host (SSRF) áp SAU ở caller — hàm này chỉ phân loại hình dạng lời mở.
export type PopupKind = 'popup' | 'tab'

export function classifyWindowOpen(details: {
  url: string
  disposition?: string
  features?: string
}): PopupKind {
  if (details.url === '' || details.url === 'about:blank') return 'popup'
  if (details.disposition === 'new-window') return 'popup'
  if ((details.features ?? '').trim() !== '') return 'popup'
  return 'tab'
}
