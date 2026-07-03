<template>
  <!-- One app-lifetime host (mounted at the layout root) that renders one-shot
       action toasts (useActionToasts singleton). Mounting at the root keeps the
       fixed positioning viewport-relative. Bottom-centre, stacked upward. -->
  <div class="action-toasts">
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: actionToastColor(tt.kind) }"
      @click="dismissActionToast(tt.id)"
    >
      <Icon
        :name="tt.kind === 'success' ? 'check' : 'alert'"
        style="width: 15px; height: 15px; flex-shrink: 0"
        :style="{ color: actionToastColor(tt.kind) }"
      />
      <span>{{ tt.text }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  useActionToasts,
  dismissActionToast,
  actionToastColor,
} from '~/composables/useActionToasts'

const { toasts } = useActionToasts()
</script>

<style scoped>
/* Stack upward from bottom-centre so multiple toasts don't pile on one slot; each
   `.toast` keeps its own surface from prototype.css. Sits just above the quota
   toasts (z 140) so both remain legible if they ever co-show. */
.action-toasts {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column-reverse;
  gap: 10px;
  z-index: 141;
}
.action-toasts .toast {
  position: static;
  left: auto;
  bottom: auto;
  transform: none;
  cursor: pointer;
}
</style>
