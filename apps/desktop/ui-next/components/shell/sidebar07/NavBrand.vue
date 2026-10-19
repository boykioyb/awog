<template>
  <!-- Khối logo + tên app ở đầu sidebar (vị trí TeamSwitcher của mẫu sidebar-07).
       AWOG không có khái niệm "workspace/team" cấp app để chuyển — project được chọn
       theo từng phiên/trang — nên khối này chỉ hiển thị, không phải menu.
       Hình học bám SidebarMenuButton size="lg": thu về icon thì còn đúng ô logo. -->
  <div
    class="flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!"
  >
    <div
      class="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
    >
      <Icon name="home" class="size-4" />
    </div>
    <div class="grid flex-1 text-left">
      <span class="truncate font-semibold text-sidebar-foreground">AWOG</span>
      <span v-if="suffix" class="truncate text-xs text-muted-foreground">{{ suffix }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const { t } = useI18n()
const suffix = computed(() => t('nav.brandSuffix'))
</script>
