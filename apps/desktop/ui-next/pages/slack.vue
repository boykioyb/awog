<template>
  <section class="page on slk-page" data-page="slack">
    <SlackWorkspace mode="window" />
  </section>
  <AppGlobalHosts />
</template>

<script setup lang="ts">
// Cửa sổ Slack riêng (docs/features/slack-threads.md) — `/slack?window=1`, mở từ
// electron/src/slack-window.ts. Không có app shell nên tự lắp AppGlobalHosts (toast,
// confirm, preview) như cửa sổ popout phiên.
//
// Trong cửa sổ chính Slack là MODAL (SlackModal). Vào `/slack` không kèm `window=1`
// (link cũ, chip phiên khi không có bridge) ⇒ mở modal và Ở LẠI trang đang đứng — người
// dùng chỉ thấy modal hiện lên, không bị đá về trang khác. Lần nạp đầu (gõ thẳng URL /
// reload) không có trang nào để ở lại ⇒ về trang chủ, modal mở đè lên.
definePageMeta({
  middleware: (to, from) => {
    if (to.query.window === '1') {
      // Cửa sổ riêng không lắp app shell (NavRail, TopBar…). Đặt thẳng `meta.layout` —
      // cùng việc setPageLayout làm, nhưng type của nó không nhận `false`.
      to.meta.layout = false
      return
    }
    useSlackModal().open(typeof to.query.thread === 'string' ? to.query.thread : null)
    const isInitial = !from.matched.length || from.fullPath === to.fullPath
    return isInitial ? navigateTo('/', { replace: true }) : abortNavigation()
  },
})
</script>

<style scoped>
/* Cửa sổ riêng không có layout ⇒ tự ghim kín cửa sổ. */
.slk-page {
  position: fixed;
  inset: 0;
  flex-direction: column;
  min-height: 0;
}
</style>
