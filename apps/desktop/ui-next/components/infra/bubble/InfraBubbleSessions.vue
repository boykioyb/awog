<template>
  <!-- "Trong màn agent sẽ có hiển thị toàn bộ session cả danh sách" — yêu cầu
       người dùng, nguyên văn. Đây là danh sách THU NHỎ của màn phiên: cùng
       `SessionListItem` (một định nghĩa cho "một hàng phiên"), chỉ khác bề rộng. -->
  <div class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
    <SessionListItem
      v-for="s in sessions"
      :key="s.id"
      :session="s"
      :active="s.id === activeId"
      :selecting="false"
      hide-project
      no-menu
      @click="$emit('pick', s.id)"
      @ctxmenu="noop"
    />
    <p v-if="!sessions.length" class="m-auto px-2 py-5 text-center text-xs text-faint">
      {{ t('infra.bubble.noSessions') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import SessionListItem from '~/components/session/SessionListItem.vue'
import type { Session } from '~/composables/useSessionsData'

defineProps<{ sessions: readonly Session[]; activeId: number | null }>()

defineEmits<{ (e: 'pick', id: number): void }>()

const { t } = useI18n()

/** Bong bóng không có menu chuột phải — chọn phiên là hành động duy nhất ở đây. */
function noop(): void {}
</script>
