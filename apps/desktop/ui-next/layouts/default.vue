<template>
  <!-- Reka TooltipProvider bọc toàn shell một lần (giống layouts/proto.vue) —
       `Tooltip` cần provider trong cây tổ tiên; thiếu nó là crash
       "Injection TooltipProviderContext not found" (rail collapse của Sessions
       từng trắng trang vì lỗi này). -->
  <TooltipProvider :delay-duration="300">
    <!-- Cột toàn cửa sổ: hàng Sidebar | SidebarInset nằm trên status bar full-width
         (footer kiểu VSCode). -->
    <div class="flex h-svh min-w-0 flex-col overflow-hidden bg-background">
      <!-- Shell theo mẫu shadcn-vue `sidebar-07`. Mở/thu sidebar nối vào state
           cấp app của useResponsiveShell (persist 'awog-nav-expanded'). -->
      <!-- `flex-col`: khối title bar full-width ở trên cùng (đèn giao thông macOS +
           ☰ + tab/breadcrumb + tiện ích), bên dưới mới là hàng Sidebar | Inset — như
           VS Code. Header nằm TRONG provider vì SidebarTrigger cần context sidebar. -->
      <SidebarProvider
        :open="navOpen"
        class="min-h-0 flex-1 flex-col overflow-hidden"
        @update:open="onSidebarOpen"
      >
        <!-- SidebarProvider stock tự bọc TooltipProvider delay 0 (tooltip rail icon
             hiện ngay); trả header + trang về độ trễ 300ms như cả app trước đây. -->
        <TooltipProvider :delay-duration="300">
          <AppTopBar />
        </TooltipProvider>
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <!-- Sidebar stock là `fixed inset-y-0 h-svh`: đẩy xuống dưới title bar
               (`top-titlebar` = chiều cao AppTopBar, token trong main.css) và dừng ở mép trên status bar để status
               bar giữ full-width. -->
          <AppSidebar
            :class="
              isWorkbench
                ? 'top-titlebar bottom-0 h-auto'
                : 'top-titlebar bottom-(--statusbar-h) h-auto'
            "
          />
          <!-- `relative` (sẵn trong SidebarInset): dock terminal toàn cục float đè lên
               đáy vùng làm việc, không chạm sidebar. -->
          <SidebarInset class="min-w-0 overflow-hidden">
            <TooltipProvider :delay-duration="300">
              <!-- Global auto-update notice — sits above the page body so it pushes
                 content down on every page (ADR 0028). -->
              <UpdateBanner />
              <div class="flex min-h-0 flex-1 overflow-hidden">
                <!-- Hook không có hộp (`contents`) cho CSS cũ của app-shell.css:
                   `body:has(.app)` bật token --titlebar-inset-* cho overlay full-bleed;
                   `.app.compact{,.list-open} .list` biến cột list của trang thành drawer;
                   `.body > .page` chừa chỗ cho dock terminal (--awog-dock-h).
                   hook-ok: app-shell.css đọc `app` / `body` / `list-open` -->
                <div class="app body contents" :class="{ compact, 'list-open': listOpen }">
                  <slot />
                </div>
              </div>

              <!-- App-wide terminal dock. Mounted INSIDE the inset (under the page body,
                 above the status bar) so it spans only the work area — never the
                 sidebar. It stops short of a page's leading rail via useDockInset (the
                 Sessions list publishes its width). Single mount: its PTYs persist across
                 navigation and across open/close (useGlobalTerminal). -->
              <GlobalTerminalHost v-if="!isWorkbench" />
            </TooltipProvider>
          </SidebarInset>
        </div>
      </SidebarProvider>

      <!-- Compact-mode drawer backdrop: dim the main content and dismiss the open
           list drawer on click. Only mounted while the drawer is open; dừng ở mép
           trên status bar để status bar vẫn bấm được.
           hook-ok: `shell-scrim` — OVERLAYS trong useEmbeddedBrowser.ts đọc class này -->
      <div v-if="showScrim" class="shell-scrim" :class="SCRIM_CLASS" @click="closeList" />

      <!-- Global status bar — single app-lifetime mount, shows on every page. -->
      <AppStatusBar v-if="!isWorkbench" />

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
      <!-- Browser PiP — card nổi cấp app giữ view native sống (docs/features/
         session-browser-panel.md). Cố ý ở ĐÂY chứ không vào AppGlobalHosts:
         AppGlobalHosts lắp lại trong cửa sổ popout phiên, còn PiP chỉ tồn tại ở
         cửa sổ chính — subscriber dọn-dẹp của useBrowserPip cũng chỉ đăng ký
         khi layout này chạm tới composable. -->
      <BrowserPip />
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
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useCommandPalette } from '~/composables/useCommandPalette'
import { startCicdNotifications } from '~/composables/useCicdNotify'
import { startGhNotifications } from '~/composables/useGhNotifications'
import { useSettingsStore } from '~/stores/settings'

// Shell layout theo mẫu shadcn-vue `sidebar-07`: SidebarProvider → AppSidebar
// (thu về icon) + SidebarInset (AppTopBar + page body). AppSidebar/AppTopBar
// auto-imported.
//
// Also the single app-lifetime mount point for the §9 globals: ⌘K command
// palette, prompt-edit overlay, and the native turn-complete notification watcher.

const { isOpen, close } = useCommandPalette()
const route = useRoute()

/** Bong bóng hạ tầng chỉ sống trên màn AWS — xem comment ở chỗ vẽ nó. */
const onInfraPage = computed(() => route.path === '/infra')
/** Workbench page tự quản dock riêng — ẩn global terminal dock để khỏi chồng (ADR 0098). */
const isWorkbench = computed(() => route.path.startsWith('/workbench'))

// Compact responsive shell (≤1100px): cột list của trang thành drawer off-canvas
// (sidebar thì đã tự thu về icon). initResponsiveShell binds the viewport listener
// once; closing on navigation means opening a list row dismisses the overlay.
const { compact, navOpen, listOpen, setNavOpen, closeList, initResponsiveShell } =
  useResponsiveShell()
watch(() => route.path, closeList)
const showScrim = computed(() => compact.value && listOpen.value)
// Nền mờ phủ trang, chừa status bar; `no-drag` vì nó phủ lên cả header (vùng kéo).
const SCRIM_CLASS =
  'fixed inset-0 bottom-(--statusbar-h) z-90 bg-black/50 [-webkit-app-region:no-drag]'

// ⌘B: SidebarProvider stock tự bắt ⌘B (key 'b') để thu/mở sidebar. Trên /workbench
// phím đó đã thuộc Explorer của workbench (WorkbenchView.onKey, kiểu VS Code), nên
// ở đó bỏ qua lượt toggle do phím sinh ra — một phím chỉ làm một việc. Cờ được dựng
// ở pha capture (chạy trước listener của provider) và tự gỡ sau lượt dispatch, phòng
// khi provider không emit (chế độ mobile dùng Sheet).
let swallowSidebarKey = false
function onSidebarKeyCapture(e: KeyboardEvent) {
  if (!isWorkbench.value || !(e.metaKey || e.ctrlKey) || e.key !== 'b') return
  swallowSidebarKey = true
  setTimeout(() => (swallowSidebarKey = false), 0)
}
function onSidebarOpen(open: boolean) {
  if (swallowSidebarKey) {
    swallowSidebarKey = false
    return
  }
  setNavOpen(open)
}

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

// Canh gác tài nguyên: tiến trình AWOG mồ côi, CPU cao kéo dài, RAM vượt ngưỡng →
// thông báo (docs/features/activity-monitor.md §Cảnh báo). Mặc định BẬT — một lượt
// đo là một tiến trình `ps` mỗi phút. Main window only — popout không báo lần hai.
startResourceAlerts()

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
// list drawer. The ⌘K palette toggle + the other global shortcuts live in
// useGlobalShortcuts (keymap-driven); Esc stays here because it also drives the
// palette + drawers owned by this layout.
function onKeydown(e: KeyboardEvent) {
  // `defaultPrevented` = một overlay (preview/modal) đã tiêu thụ Esc — một nhấn
  // chỉ đóng đúng một lớp, không xuyên xuống palette/drawer bên dưới.
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (isOpen.value) {
    close()
    return
  }
  if (listOpen.value) closeList()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keydown', onSidebarKeyCapture, true)
  initResponsiveShell()
  // FM1: hydrate the account safe-view early & globally so creators don't show a
  // false "no active account". Fire-and-forget — does not block first paint;
  // hydrateFromSidecar no-ops when the sidecar is offline and dedups if called
  // again (§12.2). Errors are swallowed inside the store, so no .catch needed.
  void useSettingsStore().hydrateFromSidecar()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keydown', onSidebarKeyCapture, true)
})
</script>
