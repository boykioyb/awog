// ADR 0098 — cutover: /sessions → /workbench.
// Mọi callsite cũ navigateTo('/sessions') tự động vào workbench; giữ query để
// tương lai deep-link (?id=…) không gãy.
//
// Mở app: Electron nạp "/" (Home) — chỉ LẦN CHẠY ĐẦU TIÊN của middleware (tức
// điều hướng khởi động) tới "/" được đưa sang workbench. KHÔNG dùng `from` để
// nhận ra lần đầu: ở SPA, Nuxt chỉ chạy middleware từ cú `router.replace(..., {
// force: true })` lúc `app:created`, khi đó `from` đã là chính "/" chứ không phải
// START_LOCATION. Bấm Home trên NavRail sau đó vẫn vào Home; cửa sổ phụ (tray
// popover, popout phiên) nạp route riêng nên không bị đụng.
let booted = false

export default defineNuxtRouteMiddleware((to) => {
  const isStartup = !booted
  booted = true
  if (to.path === '/sessions' || to.path.startsWith('/sessions/')) {
    return navigateTo({ path: '/workbench', query: to.query, hash: to.hash }, { replace: true })
  }
  if (isStartup && to.path === '/') {
    return navigateTo({ path: '/workbench', query: to.query, hash: to.hash }, { replace: true })
  }
})
