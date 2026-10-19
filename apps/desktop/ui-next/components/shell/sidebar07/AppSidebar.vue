<template>
  <!-- Sidebar điều hướng của app theo mẫu shadcn-vue `sidebar-07`: thu về dạng icon
       (`collapsible="icon"`), state mở/thu do layout nối vào SidebarProvider.
       Attr ngoài (`class`, `data-tour`…) rơi xuống khung fixed của Sidebar stock. -->
  <Sidebar collapsible="icon" data-tour="nav-rail">
    <!-- Đèn giao thông macOS nằm trong khối title bar full-width (AppTopBar) phía
         trên; sidebar bắt đầu DƯỚI khối đó (layout đặt `top-11`), nên không cần dải
         trống riêng ở đầu sidebar nữa. -->
    <SidebarHeader>
      <NavBrand />
    </SidebarHeader>
    <!-- Thu về icon thì SidebarContent stock tắt cuộn (overflow-hidden): với 17 mục,
         cửa sổ thấp sẽ cắt mất mục cuối. Bật lại cuộn dọc, giấu thanh cuộn để rail
         icon không bị lệch tâm. -->
    <SidebarContent
      class="group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:[scrollbar-width:none]"
    >
      <NavMain />
    </SidebarContent>
    <SidebarFooter>
      <NavFooter />
    </SidebarFooter>
    <SidebarRail :title="t('nav.collapse')" />
  </Sidebar>
</template>

<script setup lang="ts">
import NavBrand from '~/components/shell/sidebar07/NavBrand.vue'
import NavFooter from '~/components/shell/sidebar07/NavFooter.vue'
import NavMain from '~/components/shell/sidebar07/NavMain.vue'

const { t } = useI18n()
</script>
