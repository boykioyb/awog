<template>
  <div class="flex-1 flex flex-col items-center justify-center gap-3">
    <FolderGit2 :size="40" :stroke-width="1.5" :style="{ color: t.textFaint }" />
    <div class="text-sm" :style="{ color: t.textDim }">Workspace chưa init Git</div>
    <button
      class="text-xs px-3 py-1.5 rounded font-medium transition"
      :style="{ background: t.accent, color: t.accentText }"
      @click="emit('init')"
    >
      Initialize Git repository
    </button>
  </div>
</template>

<script setup lang="ts">
import { FolderGit2 } from 'lucide-vue-next'

const emit = defineEmits<{
  init: []
}>()

const { t } = useTheme()
</script>
