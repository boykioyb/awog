<template>
  <!-- Info tab trong dock — reuse WorkspaceInfo của session workspace qua
       DockInfoSession (cấp provideFilePreview để bấm file mở được). Cần session
       active; vắng mặt thì để trống. -->
  <ScrollArea class="h-full min-h-0 px-2.5 py-1">
    <DockInfoSession v-if="session" :key="session.id" :session="session" />
    <div v-else class="h-full" />
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DockInfoSession from './DockInfoSession.vue'
import { useSessionsStore } from '~/stores/sessions'

const sessions = useSessionsStore()
const session = computed(() => sessions.active)
</script>
