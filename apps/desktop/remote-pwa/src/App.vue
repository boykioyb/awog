<script setup lang="ts">
import { computed } from 'vue'
import { gateway } from './gateway'
import { current, route } from './store'
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
  </div>
</template>
