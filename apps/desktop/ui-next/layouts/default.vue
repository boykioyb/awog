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
      </div>

      <!-- Compact-mode drawer backdrop: dim the main content and dismiss the open
           nav/list drawer on click. Only mounted while a drawer is open. -->
      <div v-if="compact && (navOpen || listOpen)" class="shell-scrim" @click="closeDrawers" />
    </div>

    <!-- App-wide terminal dock — sits in the flex column between the page and the
         status bar so opening it pushes content up on every page. Single mount;
         its PTY persists across navigation + open/close (useGlobalTerminal). -->
    <GlobalTerminalHost />

    <!-- Global status bar — single app-lifetime mount, shows on every page. -->
    <AppStatusBar />

    <!-- §9 globals: mounted once so they work on every page. -->
    <CommandPalette />
    <SessionPromptEditOverlay />
    <SettingsModal />
    <ActivityModal />
    <WhatsNewModal />
    <SessionGitModal />
    <ProjectQuickViewModal />
    <SessionExportModal />
    <SessionForkTreeModal />
    <NewTaskModalHost />
    <ConfirmDialogHost />
    <TextPromptHost />
    <QuotaGuardHost />
    <ActionToastHost />
    <OnboardingWizard />
    <TourHost />

    <!-- Shared full-window file preview + the corner "minimize dock" (parked
         previews/sessions/tasks/terminal). Mounted once here so both survive
         navigation between pages (docs/features/minimize-dock.md). -->
    <PreviewModal />
    <MinimizeDock />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useCommandPalette } from '~/composables/useCommandPalette'

// Shell layout: NavRail | (TopBar + page body). Ported from awog-prototype.html
// `.app > .side + .main > .top + .body`. NavRail/AppTopBar auto-imported.
//
// Also the single app-lifetime mount point for the §9 globals: ⌘K command
// palette, prompt-edit overlay, and the native turn-complete notification watcher.

const { toggle, isOpen, close } = useCommandPalette()
const route = useRoute()

// Compact responsive shell (≤1100px): nav rail + list become off-canvas drawers.
// initResponsiveShell binds the viewport listener once; closing on navigation means
// tapping a nav item or opening a list row dismisses the overlay.
const { compact, navOpen, listOpen, closeDrawers, initResponsiveShell } = useResponsiveShell()
watch(() => route.path, closeDrawers)

// Watch the sessions store for turn-complete + new attention items → fire native
// notifications when the window is unfocused (composable owns gating/permission).
useNativeNotify()

// Drive the live system-tray status surface (rate limits / usage / running /
// attention) + route tray menu clicks. No-op outside Electron.
useTrayStatus()

// Global ⌘K / Ctrl+K toggle (+ Esc to close while open). Bound at the window so it
// fires regardless of focus; ignore the browser's own find shortcut by handling K
// ourselves and preventing default.
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    toggle()
    return
  }
  if (e.key === 'Escape' && isOpen.value) {
    close()
    return
  }
  if (e.key === 'Escape' && (navOpen.value || listOpen.value)) closeDrawers()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  initResponsiveShell()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
