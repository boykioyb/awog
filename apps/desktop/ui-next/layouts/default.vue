<template>
  <!-- Column wrapper: the NavRail|main row sits above the full-width status bar
       (VSCode-style footer). The row keeps the compact-drawer classes so the
       `.app.compact …` rules in app-shell.css are unchanged. -->
  <div class="appwrap">
    <div class="app" :class="{ compact, 'nav-open': navOpen, 'list-open': listOpen }">
      <NavRail />
      <div class="main">
        <AppTopBar />
        <!-- Global auto-update notice — sits above the page body so it pushes
             content down on every page (ADR 0028). -->
        <UpdateBanner />
        <div class="body">
          <slot />
        </div>

        <!-- App-wide terminal dock. Mounted INSIDE .main (under the page body, above
             the status bar) so it spans only the work area — never the NavRail. It
             stops short of a page's leading rail via useDockInset (the Sessions list
             publishes its width). Single mount: its PTYs persist across navigation and
             across open/close (useGlobalTerminal). -->
        <GlobalTerminalHost />
      </div>

      <!-- Compact-mode drawer backdrop: dim the main content and dismiss the open
           nav/list drawer on click. Only mounted while a drawer is open. -->
      <div v-if="compact && (navOpen || listOpen)" class="shell-scrim" @click="closeDrawers" />
    </div>

    <!-- Global status bar — single app-lifetime mount, shows on every page. -->
    <AppStatusBar />

    <!-- §9 globals: mounted once so they work on every page. The shared host stack
         (confirm/toast/preview/session modals) lives in AppGlobalHosts so a session
         popout window gets exactly the same set (docs/features/session-popout-window.md);
         only the app-shell-only globals stay here. -->
    <CommandPalette />
    <SettingsModal />
    <ActivityModal />
    <WhatsNewModal />
    <OnboardingWizard />
    <TourHost />
    <AppGlobalHosts />
    <!-- Phiên bong bóng ở góc phải (mini session, thư mục riêng `awog-infra`).
         Cố ý ở lại ĐÂY chứ không vào AppGlobalHosts: một cửa sổ popout ĐÃ là một
         phiên, nên thêm một phiên thu nhỏ nổi bên trong nó là hai điều khiển cho
         cùng một việc.

         CHỈ VẼ TRÊN `/infra` (yêu cầu người dùng 2026-09-15). Nó là phụ tá của màn
         hạ tầng, không phải một nút chat toàn app: ở `/sessions` nó đứng ngay cạnh
         ô soạn tin của MỘT PHIÊN THẬT và đè lên nút Gửi — hai điều khiển cho cùng
         một việc, đúng thứ đoạn trên vừa nói.

         GATE Ở CHỖ VẼ, KHÔNG Ở STATE. `useInfraBubble` giữ state ở mức module và
         phải giữ nguyên như vậy: rời `/infra` rồi quay lại thì phiên đang mở dở vẫn
         còn. Không đường nào khác hỏng vì gate này — mọi `openBubble()` đều nằm
         trong `/infra`, còn "Hỏi agent → phiên mới" đi qua `seedIntoNewSession()`,
         thứ chỉ tạo phiên và gieo draft chứ không cần bong bóng hiện ra. -->
    <InfraBubble v-if="onInfraPage" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { startCicdNotifications } from '~/composables/useCicdNotify'
import { startGhNotifications } from '~/composables/useGhNotifications'
import { useSettingsStore } from '~/stores/settings'

// Shell layout: NavRail | (TopBar + page body). Ported from awog-prototype.html
// `.app > .side + .main > .top + .body`. NavRail/AppTopBar auto-imported.
//
// Also the single app-lifetime mount point for the §9 globals: ⌘K command
// palette, prompt-edit overlay, and the native turn-complete notification watcher.

const { isOpen, close } = useCommandPalette()
const route = useRoute()

/** Bong bóng hạ tầng chỉ sống trên màn AWS — xem comment ở chỗ vẽ nó. */
const onInfraPage = computed(() => route.path === '/infra')

// Compact responsive shell (≤1100px): nav rail + list become off-canvas drawers.
// initResponsiveShell binds the viewport listener once; closing on navigation means
// tapping a nav item or opening a list row dismisses the overlay.
const { compact, navOpen, listOpen, closeDrawers, initResponsiveShell } = useResponsiveShell()
watch(() => route.path, closeDrawers)

// Watch the sessions store for turn-complete + new attention items → fire native
// notifications when the window is unfocused (composable owns gating/permission).
useNativeNotify()

// Poll the GitHub notification inbox for the opted-in projects and toast what's
// new (docs/features/github-notifications.md). Main window only — a popout must
// not double-toast. No-op until the user picks projects in Settings → Git.
startGhNotifications()

// Pipeline hỏng / đang chờ duyệt → hộp bell + toast (docs/features/infra-cicd.md,
// Mốc 4 task 4.5). Mặc định TẮT: mỗi lượt kiểm tra là vài tiến trình `aws` cộng
// một `gh run list` mỗi dự án, nên nó chỉ chạy khi người dùng bật ở
// Settings → Thông báo. Main window only — popout không toast lần thứ hai.
startCicdNotifications()

// Drive the live system-tray status surface (rate limits / usage / running /
// attention) + route tray menu clicks. No-op outside Electron.
useTrayStatus()

// Drive the desktop pet window (ambient status sprite + mini-HUD): push prefs +
// status model, execute the commands it sends back. No-op when disabled/outside
// Electron.
usePetStatus()

// App-lifetime global shortcuts: ⌘J terminal · ⌘G Git modal · ⌘T new session ·
// ⌘H session Files view (self-registers its own window keydown listener).
useGlobalShortcuts()

// Esc handling for the §9 globals: close the command palette, else dismiss an open
// responsive drawer. The ⌘K palette toggle + the other global shortcuts live in
// useGlobalShortcuts (keymap-driven); Esc stays here because it also drives the
// palette + drawers owned by this layout.
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (isOpen.value) {
    close()
    return
  }
  if (navOpen.value || listOpen.value) closeDrawers()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  initResponsiveShell()
  // FM1: hydrate the account safe-view early & globally so creators don't show a
  // false "no active account". Fire-and-forget — does not block first paint;
  // hydrateFromSidecar no-ops when the sidecar is offline and dedups if called
  // again (§12.2). Errors are swallowed inside the store, so no .catch needed.
  void useSettingsStore().hydrateFromSidecar()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
