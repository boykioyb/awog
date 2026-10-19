<template>
  <!-- Header của SidebarInset (mẫu sidebar-07): SidebarTrigger · Separator dọc ·
       Breadcrumb theo route, rồi các tiện ích cấp app (chuông, ⌘K, New).

       Cửa sổ ẩn title bar (electron/src/window.ts) nên thanh này CHÍNH LÀ title bar:
       nền là vùng kéo cửa sổ, mọi control bên trong phải opt-out (`no-drag`), không
       thì control nằm trong vùng kéo nuốt mất click của chính nó. Opt-out viết rộng
       theo loại phần tử (thay cho rule `.top button, .top a…` của app-shell.css) để
       control thêm sau này không lặng lẽ thành vật chết. `[role=tab]` cho tab phiên
       của SessionTabBar (thẻ <div>); nền strip tab vẫn kéo được như VS Code. -->
  <header
    class="flex h-titlebar shrink-0 items-center gap-2 bg-sidebar px-3 shadow-[inset_0_-1px_0_var(--border)] [-webkit-app-region:drag] [&_:is(button,a,input,select,textarea,label,[role=button],[role=tab],[data-slot=button])]:[-webkit-app-region:no-drag]"
  >
    <!-- Khối title bar chạy hết bề ngang cửa sổ (sidebar nằm BÊN DƯỚI), nên cụm ba
         đèn giao thông macOS luôn nằm trong thanh này: chừa đúng bề rộng của chúng
         (--titlebar-inset-start = 68px ở darwin, 0 khi fullscreen / Windows / Linux). -->
    <div aria-hidden="true" class="w-(--titlebar-inset-start) shrink-0" />
    <SidebarTrigger :title="t('nav.collapse')" />
    <Separator orientation="vertical" class="mr-1 h-4!" />
    <!-- Chế độ hẹp (≤1100px): cột list phụ của trang thành drawer — nút này bật nó. -->
    <Button
      v-if="compact && hasList"
      variant="ghost"
      size="iconSm"
      :class="listOpen ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
      :title="t('topbar.openList')"
      :aria-pressed="listOpen"
      @click="toggleList"
    >
      <Icon name="dock-left" />
    </Button>
    <SessionTabBar v-if="isWorkbench" hide-list-toggle class="min-w-0 flex-1" />
    <Breadcrumb v-else class="min-w-0 flex-1">
      <BreadcrumbList class="flex-nowrap">
        <template v-if="crumb.groupKey">
          <BreadcrumbItem class="hidden md:inline-flex">{{ t(crumb.groupKey) }}</BreadcrumbItem>
          <BreadcrumbSeparator class="hidden md:block" />
        </template>
        <BreadcrumbItem class="min-w-0">
          <BreadcrumbPage class="truncate">{{ title }}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
    <!-- GitHub / CI notification inbox (bell + unread badge). -->
    <TopBarNotifications />
    <template v-if="!isWorkbench">
      <Button
        variant="outline"
        size="sm"
        class="min-w-0 shrink justify-start font-normal text-muted-foreground"
        data-tour="cmdk-hint"
        :title="t('topbar.searchHint')"
        @click="openPalette"
      >
        <Icon name="search" />
        <span class="min-w-0 truncate">{{ t('topbar.search') }}</span>
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        size="sm"
        class="shrink-0"
        data-tour="new-btn"
        :title="t('topbar.new')"
        @click="onNew"
      >
        <Icon name="plus" />
        <span>{{ t('topbar.new') }}</span>
      </Button>
    </template>
    <!-- Windows/Linux: `titleBarOverlay` vẽ nút thu nhỏ/phóng to/đóng đè lên góc
         phải — chừa đúng bề rộng Chromium báo (token của app-shell.css, 0 ở macOS). -->
    <div aria-hidden="true" class="w-(--titlebar-inset-end) shrink-0" />
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useCommandPalette } from '~/composables/useCommandPalette'
import SessionTabBar from '~/components/session/SessionTabBar.vue'
import TopBarNotifications from '~/components/shell/TopBarNotifications.vue'
import { routeCrumb } from '~/components/shell/sidebar07/nav-groups'
const { t } = useI18n()
const route = useRoute()
const isWorkbench = computed(() => route.path.startsWith('/workbench'))
const { compact, listOpen, hasList, toggleList } = useResponsiveShell()

// Search box opens the ⌘K command palette (the keyboard shortcut lives in
// useGlobalShortcuts; this makes the visible box clickable too).
const { open: openPalette } = useCommandPalette()

// Breadcrumb: nhóm sidebar → tên trang (nguồn chung với sidebar, nav-groups.ts).
// Route không có tên thì hiện "AWOG" như thanh trên cũ.
const crumb = computed(() => routeCrumb(route.path))
const title = computed(() => (crumb.value.titleKey ? t(crumb.value.titleKey) : 'AWOG'))

// Global "New" → always start a fresh DEFAULT (global, no-project) session and land
// on the Sessions page. This header button is the neutral "clean slate" entry point;
// project scoping is intentionally left to ⌘T + the page "+" (which follow the
// current project). Do NOT pass activeTab here.
const sessions = useSessionsStore()
function onNew() {
  sessions.create()
  if (!route.path.startsWith('/workbench')) navigateTo('/workbench')
}
</script>
