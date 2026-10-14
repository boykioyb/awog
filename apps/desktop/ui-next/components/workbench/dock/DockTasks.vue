<template>
  <!-- Tasks của workbench dock — reuse WorkspaceTasks (danh sách task nền
       spawn từ phiên này, ADR 0055). Cần phiên active. -->
  <div class="h-full min-h-0">
    <WorkspaceTasks v-if="session" :session="session" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WorkspaceTasks from '~/components/session/workspace/WorkspaceTasks.vue'
import { useSessionsStore } from '~/stores/sessions'

const sessions = useSessionsStore()
const session = computed(() => sessions.active)
</script>
