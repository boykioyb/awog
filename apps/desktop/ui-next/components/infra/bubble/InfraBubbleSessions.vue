<template>
  <!-- "Trong màn agent sẽ có hiển thị toàn bộ session cả danh sách" — yêu cầu
       người dùng, nguyên văn. Đây là danh sách THU NHỎ của màn phiên: cùng
       `SessionListItem` (một định nghĩa cho "một hàng phiên"), chỉ khác bề rộng. -->
  <div class="ixbs">
    <SessionListItem
      v-for="s in sessions"
      :key="s.id"
      :session="s"
      :active="s.id === activeId"
      :selecting="false"
      hide-project
      @click="$emit('pick', s.id)"
      @ctxmenu="noop"
    />
    <p v-if="!sessions.length" class="ixbs-empty">{{ t('infra.bubble.noSessions') }}</p>
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

<style scoped>
.ixbs {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 8px;
}

.ixbs-empty {
  margin: auto;
  padding: 20px 10px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  text-align: center;
}
</style>
