<template>
  <!-- One app-lifetime host (mounted in the layout) that runs the quota guard
       (useQuotaGuard owns the watcher + actions) and renders its warning toasts.
       Reuses the prototype `.toast` surface; amber border = warning. Stacked in a
       fixed bottom-centre column so several warnings don't overlap. -->
  <div class="quota-toasts">
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: 'var(--amber)' }"
      @click="dismissQuotaToast(tt.id)"
    >
      <Icon name="alert" style="width: 15px; height: 15px; color: var(--amber)" />
      <span>{{ tt.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useQuotaGuard, dismissQuotaToast } from '~/composables/useQuotaGuard'

const { toasts } = useQuotaGuard()
</script>

<style scoped>
/* Stack toasts upward from the bottom-centre so multiple warnings don't pile on
   the same fixed slot. Each `.toast` keeps its own surface from prototype.css. */
.quota-toasts {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column-reverse;
  gap: 10px;
  z-index: 140;
}
.quota-toasts .toast {
  position: static;
  left: auto;
  bottom: auto;
  transform: none;
  cursor: pointer;
}
</style>
