<template>
  <div
    class="flex flex-col min-h-0"
    :style="{ height: '240px', background: t.bg, borderTop: `1px solid ${t.border}` }"
  >
    <div
      class="flex items-center justify-between px-3 py-1 flex-shrink-0"
      :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
    >
      <span class="text-[12px] uppercase tracking-wide" :style="{ color: t.textDim }">
        Terminal
      </span>
      <button
        type="button"
        :title="'Close terminal'"
        :style="{ color: t.textDim }"
        @click="ctx.terminalOpen.value = false"
      >
        <X :size="13" />
      </button>
    </div>
    <div class="flex-1 min-h-0">
      <WorkspaceTerminalInstance
        :session-id="ctx.terminalKey.value"
        :workspace-root="ctx.workspaceRoot.value"
        :visible="true"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from 'lucide-vue-next'
import WorkspaceTerminalInstance from '~/components/session/workspace/WorkspaceTerminalInstance.vue'
import { useProjectWorkspaceContext } from '~/composables/useProjectWorkspace'

const { t } = useTheme()
const ctx = useProjectWorkspaceContext()
</script>
