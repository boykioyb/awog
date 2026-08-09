<script setup lang="ts">
import { computed } from 'vue'
import { gateway } from './gateway'
import { current, route, toast } from './store'
import ConnectionBar from './components/ConnectionBar.vue'
import PairView from './views/PairView.vue'
import SessionListView from './views/SessionListView.vue'
import SessionView from './views/SessionView.vue'

// Pairing / re-pair takes over the whole screen; otherwise the normal app shows
// behind a thin connection bar.
const showPair = computed(
  () =>
    gateway.revoked.value ||
    gateway.phase.value === 'need-pair' ||
    gateway.phase.value === 'pairing',
)
</script>

<template>
  <div class="app">
    <PairView v-if="showPair" />
    <template v-else>
      <ConnectionBar />
      <SessionView v-if="route === 'session' && current" />
      <SessionListView v-else />
    </template>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(84px + var(--sab, env(safe-area-inset-bottom)) + var(--kb, 0px));
  transform: translateX(-50%);
  z-index: 300;
  max-width: min(90vw, 420px);
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  text-align: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
