<template>
  <!-- Cost tab trong dock — reuse WorkspaceCost của session workspace. Cần
       session active; vắng mặt thì để trống thay vì empty state. -->
  <ScrollArea class="h-full min-h-0 px-2.5 py-1">
    <WorkspaceCost v-if="session" :session="session" compact />
    <div v-else class="h-full" />
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WorkspaceCost from '~/components/session/workspace/WorkspaceCost.vue'
import { useSessionsStore } from '~/stores/sessions'

const sessions = useSessionsStore()
const session = computed(() => sessions.active)
</script>
