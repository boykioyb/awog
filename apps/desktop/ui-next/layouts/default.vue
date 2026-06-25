<template>
  <div class="app">
    <NavRail />
    <div class="main">
      <AppTopBar />
      <div class="body">
        <slot />
      </div>
    </div>

    <!-- §9 globals: mounted once so they work on every page. -->
    <CommandPalette />
    <SessionPromptEditOverlay />
    <SettingsModal />
    <WhatsNewModal />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useCommandPalette } from '~/composables/useCommandPalette'

// Shell layout: NavRail | (TopBar + page body). Ported from awog-prototype.html
// `.app > .side + .main > .top + .body`. NavRail/AppTopBar auto-imported.
//
// Also the single app-lifetime mount point for the §9 globals: ⌘K command
// palette, prompt-edit overlay, and the native turn-complete notification watcher.

const { toggle, isOpen, close } = useCommandPalette()

// Watch the sessions store for turn-complete → fire a native notification when
// the window is unfocused (composable owns the gating + permission flow).
useNativeNotify()

// Global ⌘K / Ctrl+K toggle (+ Esc to close while open). Bound at the window so it
// fires regardless of focus; ignore the browser's own find shortcut by handling K
// ourselves and preventing default.
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    toggle()
    return
  }
  if (e.key === 'Escape' && isOpen.value) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
