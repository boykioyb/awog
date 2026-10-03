<template>
  <div class="top">
    <!-- Rail collapse toggle (the proto's SidebarTrigger): header-left, momentary
         flip of the shared navCollapsed state — no .on state. Full width only;
         in compact mode the rail is an off-canvas drawer with its own ☰ below. -->
    <Button
      v-if="!compact"
      variant="ghost"
      size="iconSm"
      class="shelltgl"
      :title="t('nav.collapse')"
      @click="toggleNavCollapsed"
    >
      <Icon name="dock-left" style="width: var(--icon-md); height: var(--icon-md)" />
    </Button>
    <!-- Compact-mode drawer toggles (≤1100px): ☰ reveals the nav rail; the
         panel-left icon reveals the page's secondary list. Hidden at full width. -->
    <Button
      v-if="compact"
      variant="ghost"
      size="iconSm"
      class="shelltgl"
      :class="{ on: navOpen }"
      :title="t('topbar.openNav')"
      @click="toggleNav"
    >
      <Icon name="menu" style="width: var(--icon-md); height: var(--icon-md)" />
    </Button>
    <Button
      v-if="compact && hasList"
      variant="ghost"
      size="iconSm"
      class="shelltgl"
      :class="{ on: listOpen }"
      :title="t('topbar.openList')"
      @click="toggleList"
    >
      <Icon name="dock-left" style="width: var(--icon-md); height: var(--icon-md)" />
    </Button>
    <span class="ptitle">{{ title }}</span>
    <span class="sp" />
    <!-- GitHub notification inbox (bell + unread badge). Left of the search box so
         the two live in the same "utilities" cluster before the primary action. -->
    <TopBarNotifications />
    <button
      type="button"
      class="kbd"
      data-tour="cmdk-hint"
      :title="t('topbar.searchHint')"
      @click="openPalette"
    >
      <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
      <span class="kbd-label">{{ t('topbar.search') }}</span>
      <span class="kk">⌘K</span>
    </button>
    <Button size="sm" class="shrink-0" data-tour="new-btn" :title="t('topbar.new')" @click="onNew">
      <Icon name="plus" />
      <span>{{ t('topbar.new') }}</span>
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useCommandPalette } from '~/composables/useCommandPalette'

// Route → page-title i18n key (reuses the NavRail nav.* keys).
const TITLE_KEYS: Record<string, string> = {
  '/': 'nav.home',
  '/sessions': 'nav.sessions',
  '/tasks': 'nav.tasks',
  '/workflows': 'nav.workflows',
  '/agents': 'nav.agents',
  '/skills': 'nav.skills',
  '/commands': 'nav.commands',
  '/rules': 'nav.rules',
  '/templates': 'nav.templates',
  '/projects': 'nav.projects',
  '/git': 'nav.git',
  '/connections': 'nav.connections',
  '/hooks': 'nav.hooks',
  '/settings': 'nav.settings',
  // `/infra` trước đây rơi vào nhánh mặc định ⇒ thanh trên hiện "AWOG". Mục menu
  // đã đổi tên thành "AWS" (2026-09-14) nên tiêu đề trang đi theo cùng một nguồn.
  '/infra': 'nav.infra',
}

const { t } = useI18n()
const route = useRoute()
const { compact, navOpen, listOpen, hasList, toggleNav, toggleList, toggleNavCollapsed } =
  useResponsiveShell()

// Search box opens the ⌘K command palette (the keyboard shortcut is bound in the
// layout; this makes the visible box clickable too).
const { open: openPalette } = useCommandPalette()
const title = computed(() => {
  const path = route.path
  const key = Object.keys(TITLE_KEYS).find((k) => (k === '/' ? path === '/' : path.startsWith(k)))
  const titleKey = key ? TITLE_KEYS[key] : undefined
  return titleKey ? t(titleKey) : 'AWOG'
})

// Global "New" → always start a fresh DEFAULT (global, no-project) session and land
// on the Sessions page. This header button is the neutral "clean slate" entry point;
// project scoping is intentionally left to ⌘T + the page "+" (which follow the
// current project). Do NOT pass activeTab here.
const sessions = useSessionsStore()
function onNew() {
  sessions.create()
  if (!route.path.startsWith('/sessions')) navigateTo('/sessions')
}
</script>

<style scoped>
/* Compact drawer toggles — ghost iconSm Buttons (28px) left of the page title.
   Geometry + hover/focus come from the primitive; scoped keeps the resting dim
   icon and the drawer-open wash (same idiom as the nav rail's selection). */
.shelltgl {
  flex: 0 0 auto;
  color: var(--textDim);
}
.shelltgl:hover {
  color: var(--foreground);
}
.shelltgl.on {
  color: var(--accent-foreground);
  background: var(--accent-wash);
}
</style>
