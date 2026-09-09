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
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  /* Ink token, not --bg: on the light scheme --bg is nearly white and would sit
     at 1.3:1 on the amber strip. */
  color: var(--on-warn);
  background: var(--warn);
}
.bar.ok {
  background: var(--accent);
  color: var(--on-accent);
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
/* The strip's colour + label already carry the state; the pulse is decoration. */
@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none;
  }
}
</style>
