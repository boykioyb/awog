<template>
  <SidebarGroup v-for="group in NAV_GROUPS" :key="group.title ?? 'top'">
    <SidebarGroupLabel v-if="group.title">{{ t(group.title) }}</SidebarGroupLabel>
    <SidebarMenu>
      <SidebarMenuItem v-for="item in group.items" :key="item.to">
        <!-- Mục mở modal thay vì đổi trang (Slack): là nút chứ không phải thẻ a, nên LinkOpenHost
             (chỉ bắt thẻ <a>) không đụng tới. -->
        <SidebarMenuButton
          v-if="item.modal"
          :is-active="slackModal.isOpen.value"
          :tooltip="t(item.label)"
          @click="slackModal.open()"
        >
          <Icon :name="item.icon" />
          <span>{{ t(item.label) }}</span>
        </SidebarMenuButton>
        <SidebarMenuButton
          v-else
          as-child
          :is-active="routeMatches(item.to, route.path)"
          :tooltip="t(item.label)"
        >
          <NuxtLink :to="item.to" :data-tour="item.tour">
            <Icon :name="item.icon" />
            <span>{{ t(item.label) }}</span>
          </NuxtLink>
        </SidebarMenuButton>
        <SidebarMenuBadge
          v-if="item.badge && sessionsAttention > 0"
          class="border border-warning/30 bg-warning/10 text-warning"
        >
          {{ sessionsAttention }}
        </SidebarMenuBadge>
        <SidebarMenuBadge v-else-if="item.dot">
          <span class="size-1.5 rounded-full bg-warning" />
        </SidebarMenuBadge>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { isBoardSession } from '~/composables/useSessionsData'
import { NAV_GROUPS, routeMatches } from '~/components/shell/sidebar07/nav-groups'

// Các nhóm điều hướng chính của sidebar (port từ NavRail cũ). Danh mục tĩnh ở
// nav-groups.ts; ở đây chỉ nối phần sống: mục đang chọn theo route, modal Slack,
// và huy hiệu phiên cần để ý.
const { t } = useI18n()
const route = useRoute()
const sessions = useSessionsStore()
// Slack threads là modal trong cửa sổ chính (docs/features/slack-threads.md).
const slackModal = useSlackModal()

// Sessions needing the user's attention: unread, or paused on a gate (awaiting a
// question / permission answer). 0 → no badge.
// Phiên board (member team / lone-agent do board item dispatch) ẩn khỏi list —
// unread/awaiting của chúng thuộc về board/Teams chứ không phải màn Sessions,
// nên không được đếm vào badge này (badge "1" mà list không thấy gì = báo ảo).
const sessionsAttention = computed(
  () =>
    sessions.sessions.filter((s) => !isBoardSession(s) && (s.unread || s.status === 'awaiting'))
      .length,
)
</script>
