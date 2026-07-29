<script setup lang="ts">
import { computed } from 'vue'
import { gateway } from '../gateway'

const label = computed(() => {
  switch (gateway.phase.value) {
    case 'ready':
      return 'Đã kết nối'
    case 'reconnecting':
      return 'Đang kết nối lại…'
    case 'connecting':
    case 'authing':
      return 'Đang kết nối…'
    default:
      return 'Ngoại tuyến'
  }
})

const ok = computed(() => gateway.phase.value === 'ready')
const reconnecting = computed(() => gateway.phase.value !== 'ready')
</script>

<template>
  <div v-if="reconnecting" class="bar" :class="{ ok }">
    <span class="dot" />
    <span>{{ label }}</span>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--bg);
  background: var(--warn);
}
.bar.ok {
  background: var(--accent);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
</style>
