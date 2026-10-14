<template>
  <!-- Team của workbench dock — reuse WorkspaceTeam (roster + board + channel
       của run đa-agent). Chỉ được chọn khi `dockViews` chứa Team — guard phụ
       v-if để phòng render lạc khi session đổi giữa hai tick. -->
  <ScrollArea class="h-full min-h-0">
    <WorkspaceTeam v-if="session && isTeam" :session="session" />
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WorkspaceTeam from '~/components/session/workspace/WorkspaceTeam.vue'
import { useWorkbenchDock } from '~/composables/useWorkbenchDock'
import { useSessionsStore } from '~/stores/sessions'

const sessions = useSessionsStore()
const dock = useWorkbenchDock()
const session = computed(() => sessions.active)
const isTeam = computed(() => dock.dockViews.value.includes('Team'))
</script>
