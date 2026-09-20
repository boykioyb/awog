<template>
  <!-- Mũi tên chiều sắp xếp. Chiếm chỗ ngay cả khi ẩn (`visibility`, không phải
       `v-if`) để tiêu đề cột không nhảy ngang mỗi lần đổi cột sắp xếp. -->
  <span class="sortcaret" :style="{ visibility: dir ? 'visible' : 'hidden' }" aria-hidden="true">
    {{ dir === 'asc' ? '▲' : '▼' }}
  </span>
</template>

<script setup lang="ts">
import type { SortDir } from '~/composables/useMonitorManager'

defineProps<{ dir: SortDir | null }>()
</script>

<style scoped>
.sortcaret {
  margin-left: 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--accent);
}
</style>
