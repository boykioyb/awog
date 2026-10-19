<template>
  <!-- Mũi tên chiều sắp xếp. Chiếm chỗ ngay cả khi ẩn (`visibility`, không phải
       `v-if`) để tiêu đề cột không nhảy ngang mỗi lần đổi cột sắp xếp. -->
  <span class="ml-1 text-xs text-primary" :class="dir ? 'visible' : 'invisible'" aria-hidden="true">
    {{ dir === 'asc' ? '▲' : '▼' }}
  </span>
</template>

<script setup lang="ts">
import type { SortDir } from '~/composables/useMonitorManager'

defineProps<{ dir: SortDir | null }>()
</script>
