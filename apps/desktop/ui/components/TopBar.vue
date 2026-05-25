<template>
  <div
    class="h-11 flex items-center px-4 gap-4 flex-shrink-0"
    :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
  >
    <div
      v-if="selectedTask && selectedProject && isTasksRoute"
      class="flex items-center gap-1.5 text-xs"
      :style="{ color: t.textDim }"
    >
      <FolderGit2 :size="12" />
      <span :style="{ color: t.text }">{{ selectedProject.name }}</span>
      <span :style="{ color: t.textFaint }">·</span>
      <GitBranch :size="11" />
      <span class="font-mono">{{ selectedProject.gitBranch }}</span>
      <span :style="{ color: t.textFaint }">·</span>
      <span class="font-mono text-[10px]">{{ selectedProject.path }}</span>
    </div>
    <div v-else class="flex items-center gap-1.5 text-xs" :style="{ color: t.textDim }">
      <FolderGit2 :size="12" />
      <span>{{ workspaceLabel }}</span>
    </div>
    <div class="ml-auto text-xs capitalize" :style="{ color: t.textDim }">
      {{ viewLabel }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { FolderGit2, GitBranch } from 'lucide-vue-next'

const { t } = useTheme()
const ws = useWorkspaceStore()
const settings = useSettingsStore()
const route = useRoute()

const isTasksRoute = computed(() => route.path.startsWith('/tasks'))

const selectedTask = computed(() => ws.selectedTask)
const selectedProject = computed(() =>
  selectedTask.value ? ws.projectById(selectedTask.value.projectId) : undefined,
)

const workspaceLabel = computed(() => settings.workspacePath.replace('~/workspaces/', ''))

const viewLabel = computed(() => {
  const seg = route.path.split('/')[1]
  return seg || 'tasks'
})
</script>
