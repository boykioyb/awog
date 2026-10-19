<template>
  <!-- Chân sidebar (vị trí NavUser của mẫu sidebar-07): các hành động cấp app từng
       nằm ở chân NavRail. Cố ý là nút HIỆN SẴN chứ không gom vào dropdown — tour giới
       thiệu (useTour.ts) neo vào `settings-btn` / `whatsnew-btn`, menu đóng thì tour
       không tìm thấy neo. Chuông thông báo nằm ở header (AppTopBar). -->
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton
        :is-active="activityOpen"
        :tooltip="t('nav.activity')"
        @click="openActivity()"
      >
        <Icon name="act" />
        <span>{{ t('nav.activity') }}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton
        :is-active="settingsOpen"
        :tooltip="t('nav.settings')"
        data-tour="settings-btn"
        @click="openSettings()"
      >
        <Icon name="settings" />
        <span>{{ t('nav.settings') }}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton
        :tooltip="t('topbar.whatsNew')"
        data-tour="whatsnew-btn"
        @click="openPanel"
      >
        <Icon name="tag" />
        <span>{{ t('topbar.whatsNew') }}</span>
      </SidebarMenuButton>
      <!-- Chấm "có bản mới chưa xem" — neo góc ô bấm nên hiện cả khi sidebar thu về icon. -->
      <span
        v-if="hasUnseen"
        class="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-primary"
      />
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton :tooltip="themeLabel" @click="toggleTheme">
        <Icon :name="isDark ? 'moon' : 'sun'" />
        <span>{{ themeLabel }}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const { t } = useI18n()
const { open: settingsOpen, openSettings } = useSettingsModal()
const { open: activityOpen, openActivity } = useActivityModal()
const { hasUnseen, openPanel } = useWhatsNew()
// useTheme ở đây là bộ điều khiển chế độ sáng/tối (toggle), không tô màu inline.
// theme-ok: chỉ đọc/ghi trạng thái theme, không tô màu
const { isDark, toggleTheme } = useTheme()
const themeLabel = computed(() => (isDark.value ? t('topbar.toLight') : t('topbar.toDark')))
</script>
